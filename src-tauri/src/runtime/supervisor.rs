//! RuntimeSupervisor — owns the Node.js sidecar lifecycle.
//!
//! Responsibilities: start / stop / restart / status / health, request/response
//! correlation, event fan-out, crash containment. A runtime crash never takes
//! the desktop app down: the supervisor records `Crashed` and the UI can ask
//! for a restart.
//!
//! stdout is the protocol channel (JSONL), stderr is forwarded as log events.
//! The supervisor itself is tauri-free so it stays unit-testable; the tauri
//! layer subscribes to its broadcast channel and re-emits to the webview.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::time::timeout;

use crate::error::{AppError, AppResult};
use crate::process::{resolve_node, resolve_runtime_script};
use crate::runtime::protocol::{RpcError, RpcRequest, RuntimeMessage, PROTOCOL_VERSION};

/// Timeout for the start handshake (spawn -> protocol version exchange).
const START_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
/// Grace period after `runtime.shutdown` before the child is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);
/// Default per-request RPC timeout.
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout for full-roundtrip desktop requests (session scans, agent start).
const DESKTOP_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// Compaction runs a full LLM summarisation turn — it can legitimately take
/// minutes on large sessions.
const COMPACTION_REQUEST_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Timeout for a given `runtime_request` method. Multi-step LLM operations
/// (compaction) get the long budget; everything else is bounded at 60s.
pub fn request_timeout_for(method: &str, params: &serde_json::Value) -> Duration {
    let is_compact = match method {
        "harness.compact" => true,
        "agent.command" => params
            .get("command")
            .and_then(|command| command.get("type"))
            .and_then(serde_json::Value::as_str)
            == Some("compact"),
        _ => false,
    };
    if is_compact {
        COMPACTION_REQUEST_TIMEOUT
    } else {
        DESKTOP_REQUEST_TIMEOUT
    }
}

/// Supervisor lifecycle phase, mirrored to the UI as a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePhase {
    Stopped,
    Starting,
    Running,
    Stopping,
    Crashed,
}

impl RuntimePhase {
    pub fn as_str(self) -> &'static str {
        match self {
            RuntimePhase::Stopped => "stopped",
            RuntimePhase::Starting => "starting",
            RuntimePhase::Running => "running",
            RuntimePhase::Stopping => "stopping",
            RuntimePhase::Crashed => "crashed",
        }
    }
}

/// Snapshot returned by `status()`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Broadcast payload describing runtime state changes and events.
#[derive(Debug, Clone)]
pub enum SupervisorEvent {
    PhaseChanged(RuntimePhase),
    RuntimeEvent {
        name: String,
        payload: serde_json::Value,
    },
    Log {
        line: String,
    },
}

struct SharedState {
    phase: Mutex<RuntimePhase>,
    pid: Mutex<Option<u32>>,
    exit_code: Mutex<Option<i32>>,
    runtime_version: Mutex<Option<String>>,
    node_version: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
}

impl SharedState {
    async fn set_phase(&self, phase: RuntimePhase) {
        *self.phase.lock().await = phase;
    }

    async fn snapshot(&self) -> RuntimeStatus {
        RuntimeStatus {
            phase: (*self.phase.lock().await).as_str().to_string(),
            pid: *self.pid.lock().await,
            exit_code: *self.exit_code.lock().await,
            runtime_version: self.runtime_version.lock().await.clone(),
            protocol_version: Some(PROTOCOL_VERSION),
            node_version: self.node_version.lock().await.clone(),
            error: self.last_error.lock().await.clone(),
        }
    }
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, RpcError>>>>>;

/// Handle to the supervised runtime. Cloneable; `start`/`stop`/`restart` are
/// safe to call from any command.
#[derive(Clone)]
pub struct RuntimeSupervisor {
    state: Arc<SharedState>,
    pending: PendingMap,
    events: broadcast::Sender<SupervisorEvent>,
    child_stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    id_counter: Arc<AtomicU64>,
    /// Incremented on every spawn. Exit watchers compare their generation
    /// against the current one so a stale watcher (e.g. from a restart race)
    /// never clobbers a newer child's state.
    generation: Arc<AtomicU64>,
    start_lock: Arc<Mutex<()>>,
    /// Extra environment variables applied at spawn (test seam).
    extra_env: Arc<HashMap<String, String>>,
}

impl RuntimeSupervisor {
    pub fn new() -> Self {
        // Capacity must comfortably absorb a streamed agent turn: message
        // deltas arrive as one envelope each (16ms batches); a stuck
        // consumer must not drop session state transitions.
        let (events, _) = broadcast::channel(1024);
        RuntimeSupervisor {
            state: Arc::new(SharedState {
                phase: Mutex::new(RuntimePhase::Stopped),
                pid: Mutex::new(None),
                exit_code: Mutex::new(None),
                runtime_version: Mutex::new(None),
                node_version: Mutex::new(None),
                last_error: Mutex::new(None),
            }),
            pending: Arc::new(Mutex::new(HashMap::new())),
            events,
            child_stdin: Arc::new(Mutex::new(None)),
            id_counter: Arc::new(AtomicU64::new(1)),
            generation: Arc::new(AtomicU64::new(0)),
            start_lock: Arc::new(Mutex::new(())),
            extra_env: Arc::new(HashMap::new()),
        }
    }

    /// Test seam: additional environment variables for the sidecar process
    /// (e.g. `PI_HARNESS_TEST_PI_SDK` pointing at a mock SDK module).
    #[must_use]
    pub fn with_extra_env(mut self, env: HashMap<String, String>) -> Self {
        self.extra_env = Arc::new(env);
        self
    }

    /// Subscribe to phase changes, runtime events and stderr logs.
    pub fn subscribe(&self) -> broadcast::Receiver<SupervisorEvent> {
        self.events.subscribe()
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.state.snapshot().await
    }

    /// Spawn the runtime and handshake on protocol version. Idempotent when
    /// already running (returns current status).
    pub async fn start(&self) -> AppResult<RuntimeStatus> {
        let _guard = self.start_lock.lock().await;
        if *self.state.phase.lock().await == RuntimePhase::Running {
            return Ok(self.state.snapshot().await);
        }

        self.state.set_phase(RuntimePhase::Starting).await;
        self.publish(SupervisorEvent::PhaseChanged(RuntimePhase::Starting));

        match self.spawn_and_handshake().await {
            Ok(()) => {
                self.state.set_phase(RuntimePhase::Running).await;
                self.publish(SupervisorEvent::PhaseChanged(RuntimePhase::Running));
                Ok(self.state.snapshot().await)
            }
            Err(error) => {
                *self.state.last_error.lock().await = Some(error.parts().1);
                self.state.set_phase(RuntimePhase::Crashed).await;
                self.publish(SupervisorEvent::PhaseChanged(RuntimePhase::Crashed));
                Err(error)
            }
        }
    }

    async fn spawn_and_handshake(&self) -> AppResult<()> {
        let node = resolve_node()?;
        let script = resolve_runtime_script()?;

        let mut child: Child = Command::new(&node)
            .arg(&script)
            .envs(self.extra_env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                AppError::io(format!(
                    "Failed to start Pi Runtime ({} {}): {error}",
                    node.display(),
                    script.display()
                ))
            })?;

        let pid = child.id();
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        *self.state.pid.lock().await = pid;
        *self.state.exit_code.lock().await = None;
        *self.state.last_error.lock().await = None;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *self.child_stdin.lock().await = stdin;

        if let Some(stdout) = stdout {
            let supervisor = self.clone();
            tokio::spawn(async move { supervisor.read_stdout(stdout).await });
        }
        if let Some(stderr) = stderr {
            let supervisor = self.clone();
            tokio::spawn(async move { supervisor.read_stderr(stderr).await });
        }

        let watcher = self.clone();
        tokio::spawn(async move { watcher.watch_exit(generation, child).await });

        // Handshake: exchange protocol versions before declaring Running.
        let version = timeout(
            START_HANDSHAKE_TIMEOUT,
            self.request(
                "runtime.version",
                serde_json::json!({}),
                DEFAULT_REQUEST_TIMEOUT,
            ),
        )
        .await
        .map_err(|_| AppError::timeout("Pi Runtime did not answer the startup handshake"))?
        .map_err(|error| {
            AppError::runtime(format!(
                "Pi Runtime handshake failed: {} ({})",
                error.message, error.code
            ))
        })?;

        let version = version.as_object().ok_or_else(|| {
            AppError::runtime("Pi Runtime handshake returned a malformed payload")
        })?;
        let runtime_protocol = version
            .get("protocolVersion")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        if runtime_protocol != u64::from(PROTOCOL_VERSION) {
            return Err(AppError::new(
                crate::error::RUNTIME_TIMEOUT,
                format!(
                    "Pi Runtime protocol mismatch: host {PROTOCOL_VERSION}, runtime {runtime_protocol}"
                ),
            ));
        }

        if let Some(runtime_version) = version.get("runtimeVersion").and_then(|v| v.as_str()) {
            *self.state.runtime_version.lock().await = Some(runtime_version.to_string());
        }
        if let Some(node_version) = version.get("nodeVersion").and_then(|v| v.as_str()) {
            *self.state.node_version.lock().await = Some(node_version.to_string());
        }

        Ok(())
    }

    async fn read_stdout(self, stdout: tokio::process::ChildStdout) {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']);
                    if trimmed.is_empty() {
                        continue;
                    }
                    match RuntimeMessage::parse(trimmed) {
                        Some(RuntimeMessage::Response { id, outcome }) => {
                            self.resolve_pending(&id, outcome).await;
                        }
                        Some(RuntimeMessage::Event { name, payload }) => {
                            self.publish(SupervisorEvent::RuntimeEvent { name, payload });
                        }
                        None => {
                            self.publish(SupervisorEvent::Log {
                                line: format!("[protocol violation] {trimmed}"),
                            });
                        }
                    }
                }
            }
        }
    }

    async fn read_stderr(self, stderr: tokio::process::ChildStderr) {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']);
                    if !trimmed.is_empty() {
                        self.publish(SupervisorEvent::Log {
                            line: trimmed.to_string(),
                        });
                    }
                }
            }
        }
    }

    async fn watch_exit(self, generation: u64, mut child: Child) {
        let exit = child.wait().await;
        let (code, was_graceful) = match exit {
            Ok(status) => (status.code(), status.success()),
            Err(_) => (None, false),
        };
        let _ = was_graceful;

        // A newer child was spawned while this one exited (restart race):
        // do not touch shared state or pending requests.
        if self.generation.load(Ordering::Relaxed) != generation {
            return;
        }

        let previous_phase = *self.state.phase.lock().await;
        if previous_phase == RuntimePhase::Stopping {
            // Graceful stop completes the transition.
            self.state.set_phase(RuntimePhase::Stopped).await;
            self.publish(SupervisorEvent::PhaseChanged(RuntimePhase::Stopped));
        } else if previous_phase != RuntimePhase::Stopped {
            // Unexpected exit while Starting/Running.
            *self.state.last_error.lock().await = Some(match code {
                Some(code) => format!("Pi Runtime exited unexpectedly (code {code})"),
                None => "Pi Runtime exited unexpectedly".to_string(),
            });
            self.state.set_phase(RuntimePhase::Crashed).await;
            self.publish(SupervisorEvent::PhaseChanged(RuntimePhase::Crashed));
        }

        *self.state.pid.lock().await = None;
        *self.state.exit_code.lock().await = code;
        *self.child_stdin.lock().await = None;
        self.fail_all_pending(match code {
            Some(code) => format!("Pi Runtime exited (code {code})"),
            None => "Pi Runtime exited".to_string(),
        })
        .await;
    }

    /// Send an RPC request and await its response.
    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
        request_timeout: Duration,
    ) -> Result<serde_json::Value, RpcError> {
        // `Starting` is allowed: the handshake itself is a request issued
        // before the phase moves to `Running`.
        match *self.state.phase.lock().await {
            RuntimePhase::Running | RuntimePhase::Starting => {}
            _ => {
                return Err(RpcError {
                    code: crate::runtime::protocol::RUNTIME_EXITED.to_string(),
                    message: "Pi Runtime is not running".to_string(),
                    user_message: None,
                    data: None,
                })
            }
        }
        self.request_raw(method, params, request_timeout).await
    }

    /// Desktop-domain request with auto-start: boots the runtime on demand
    /// (scenario B — the workspace opens and asks for the session list), then
    /// routes the request with the method-appropriate timeout.
    pub async fn desktop_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        let phase = *self.state.phase.lock().await;
        if phase == RuntimePhase::Stopped || phase == RuntimePhase::Crashed {
            if let Err(error) = self.start().await {
                return Err(RpcError {
                    code: crate::error::RUNTIME_UNAVAILABLE.to_string(),
                    message: error.parts().1,
                    user_message: None,
                    data: None,
                });
            }
        }
        let timeout = request_timeout_for(method, &params);
        self.request(method, params, timeout).await
    }

    /// Send a request without the phase gate. Used by `stop` (phase is already
    /// Stopping) and the startup handshake.
    async fn request_raw(
        &self,
        method: &str,
        params: serde_json::Value,
        request_timeout: Duration,
    ) -> Result<serde_json::Value, RpcError> {
        let id = format!("req_{}", self.id_counter.fetch_add(1, Ordering::Relaxed));
        let request = RpcRequest {
            id: id.clone(),
            method: method.to_string(),
            params,
        };

        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);

        let mut stdin_guard = self.child_stdin.lock().await;
        let write_result = match stdin_guard.as_mut() {
            Some(stdin) => {
                let mut line = serde_json::to_string(&request).map_err(|error| RpcError {
                    code: crate::runtime::protocol::INTERNAL_ERROR.to_string(),
                    message: format!("Failed to encode request: {error}"),
                    user_message: None,
                    data: None,
                })?;
                line.push('\n');
                stdin
                    .write_all(line.as_bytes())
                    .await
                    .map_err(|error| RpcError {
                        code: crate::runtime::protocol::RUNTIME_EXITED.to_string(),
                        message: format!("Pi Runtime pipe closed: {error}"),
                        user_message: None,
                        data: None,
                    })
            }
            None => Err(RpcError {
                code: crate::runtime::protocol::RUNTIME_EXITED.to_string(),
                message: "Pi Runtime is not running".to_string(),
                user_message: None,
                data: None,
            }),
        };
        drop(stdin_guard);

        if let Err(error) = write_result {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }

        let outcome = match timeout(request_timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_cancelled)) => Err(RpcError {
                code: crate::runtime::protocol::RUNTIME_EXITED.to_string(),
                message: "Pi Runtime exited before answering".to_string(),
                user_message: None,
                data: None,
            }),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(RpcError {
                    code: crate::runtime::protocol::RUNTIME_TIMEOUT.to_string(),
                    message: format!("Pi Runtime request timed out after {request_timeout:?}"),
                    user_message: None,
                    data: None,
                })
            }
        };
        outcome
    }

    /// Graceful stop: notify the runtime, wait, then kill.
    pub async fn stop(&self) -> AppResult<RuntimeStatus> {
        let _guard = self.start_lock.lock().await;

        let phase = *self.state.phase.lock().await;
        match phase {
            RuntimePhase::Stopped | RuntimePhase::Crashed => {
                return Ok(self.state.snapshot().await);
            }
            RuntimePhase::Starting => {
                return Err(AppError::runtime_unavailable(
                    "Pi Runtime is still starting; try again in a moment",
                ));
            }
            RuntimePhase::Running | RuntimePhase::Stopping => {}
        }

        self.state.set_phase(RuntimePhase::Stopping).await;
        self.publish(SupervisorEvent::PhaseChanged(RuntimePhase::Stopping));

        // Best-effort shutdown notification; the watcher task finalises the
        // phase transition to Stopped when the child actually exits. Sent
        // through the raw path because the phase gate in `request` rejects
        // Stopping (by design, for ordinary traffic).
        let shutdown_result = timeout(
            STOP_GRACE,
            self.request_raw(
                "runtime.shutdown",
                serde_json::json!({}),
                Duration::from_secs(2),
            ),
        )
        .await;

        // If the runtime is still alive after the grace period, close stdin:
        // the runtime exits on stdin EOF. Dropping the handle also arms
        // `kill_on_drop` as a last resort.
        if shutdown_result.is_err() {
            *self.child_stdin.lock().await = None;
        }

        Ok(self.state.snapshot().await)
    }

    /// Stop then start again. Fails if the restart does not come back up.
    pub async fn restart(&self) -> AppResult<RuntimeStatus> {
        self.stop().await?;
        // Wait for the child to actually leave (watcher sets Stopped).
        for _ in 0..100 {
            if *self.state.phase.lock().await == RuntimePhase::Stopped {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        self.start().await
    }

    async fn resolve_pending(&self, id: &str, outcome: Result<serde_json::Value, RpcError>) {
        let mut pending = self.pending.lock().await;
        if let Some(sender) = pending.remove(id) {
            let _ = sender.send(outcome);
        }
    }

    async fn fail_all_pending(&self, message: String) {
        let mut pending = self.pending.lock().await;
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(RpcError {
                code: crate::runtime::protocol::RUNTIME_EXITED.to_string(),
                message: message.clone(),
                user_message: None,
                data: None,
            }));
        }
    }

    fn publish(&self, event: SupervisorEvent) {
        let _ = self.events.send(event);
    }
}

impl Default for RuntimeSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn start_ping_version_stop_restart_lifecycle() {
        let supervisor = RuntimeSupervisor::new();

        let status = supervisor.start().await.expect("runtime starts");
        assert_eq!(status.phase, "running");
        assert!(status.pid.is_some());
        assert_eq!(status.protocol_version, Some(PROTOCOL_VERSION));
        assert_eq!(status.runtime_version.as_deref(), Some("0.1.0"));
        assert!(status
            .node_version
            .as_deref()
            .unwrap_or("")
            .starts_with('v'));

        // RPC round trip through the real sidecar.
        let pong = supervisor
            .request(
                "runtime.ping",
                serde_json::json!({}),
                DEFAULT_REQUEST_TIMEOUT,
            )
            .await
            .expect("ping answers");
        assert_eq!(pong["pong"], serde_json::json!(true));

        let version = supervisor
            .request(
                "runtime.version",
                serde_json::json!({}),
                DEFAULT_REQUEST_TIMEOUT,
            )
            .await
            .expect("version answers");
        assert_eq!(
            version["protocolVersion"],
            serde_json::json!(PROTOCOL_VERSION)
        );

        // Unknown methods surface a typed RPC error, not a crash.
        let missing = supervisor
            .request("nope.nope", serde_json::json!({}), DEFAULT_REQUEST_TIMEOUT)
            .await;
        assert!(missing.is_err());

        // Restart keeps the protocol working.
        let status = supervisor.restart().await.expect("restart succeeds");
        assert_eq!(status.phase, "running");
        let pong = supervisor
            .request(
                "runtime.ping",
                serde_json::json!({}),
                DEFAULT_REQUEST_TIMEOUT,
            )
            .await
            .expect("ping answers after restart");
        assert_eq!(pong["pong"], serde_json::json!(true));

        supervisor.stop().await.expect("stop succeeds");
        for _ in 0..100 {
            if supervisor.status().await.phase == "stopped" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(supervisor.status().await.phase, "stopped");

        // Requests after stop fail with a typed error.
        let denied = supervisor
            .request(
                "runtime.ping",
                serde_json::json!({}),
                DEFAULT_REQUEST_TIMEOUT,
            )
            .await;
        assert!(denied.is_err());
    }

    #[tokio::test]
    async fn double_start_is_idempotent() {
        let supervisor = RuntimeSupervisor::new();
        supervisor.start().await.expect("first start");
        let again = supervisor.start().await.expect("second start is a no-op");
        assert_eq!(again.phase, "running");
        supervisor.stop().await.expect("stop");
        for _ in 0..100 {
            if supervisor.status().await.phase == "stopped" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}
