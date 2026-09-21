//! `runtime.*` commands: the desktop bridge to the Node sidecar lifecycle.

use serde::Serialize;
use std::time::Duration;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::runtime::protocol::RpcError;
use crate::runtime::supervisor::RuntimeSupervisor;

const RUNTIME_RPC_TIMEOUT: Duration = Duration::from_secs(30);

fn supervisor_error(error: crate::runtime::protocol::RpcError) -> AppError {
    match error.code.as_str() {
        "RUNTIME_EXITED" => AppError::runtime_unavailable(error.message),
        "RUNTIME_TIMEOUT" => AppError::timeout(error.message),
        _ => AppError::runtime(format!("{} ({})", error.message, error.code)),
    }
}

/// Forward supervisor broadcasts to the webview as Tauri events. Event names
/// live in `src/shared/ipc/channels.ts` (IPC_EVENT) so the renderer keeps a
/// single source of truth.
async fn forward_supervisor_events(app: tauri::AppHandle, supervisor: RuntimeSupervisor) {
    use crate::runtime::supervisor::SupervisorEvent;
    use tauri::Emitter;

    let mut receiver = supervisor.subscribe();
    loop {
        let event = match receiver.recv().await {
            Ok(event) => event,
            // Slow consumer: the broadcast ring dropped events. Keep going —
            // session state transitions must never be lost to a UI hiccup.
            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                eprintln!("[pi-harness] runtime event forwarder skipped {skipped} events");
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        };
        let result: AppResult<()> = (|| {
            match event {
                SupervisorEvent::PhaseChanged(phase) => {
                    app.emit(
                        "pi-harness:runtime:state",
                        serde_json::json!({ "phase": phase.as_str() }),
                    )?;
                }
                SupervisorEvent::RuntimeEvent { name, payload } => {
                    // Domain events route to the renderer channels the
                    // Electron preload also uses (IPC_EVENT in
                    // src/shared/ipc/channels.ts); the payload shape is the
                    // RPC event payload, passed through verbatim.
                    match name.as_str() {
                        "agent.event" => {
                            app.emit("pi-harness:agent:event", payload)?;
                        }
                        "agent.running" => {
                            app.emit("pi-harness:agent:running", payload)?;
                        }
                        "harness.event" => {
                            app.emit("pi-harness:harness:event", payload)?;
                        }
                        _ => {
                            app.emit(
                                "pi-harness:runtime:event",
                                serde_json::json!({
                                    "event": name,
                                    "payload": payload,
                                }),
                            )?;
                        }
                    }
                }
                SupervisorEvent::Log { line } => {
                    app.emit(
                        "pi-harness:runtime:log",
                        serde_json::json!({ "line": line }),
                    )?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("[pi-harness] failed to emit runtime event: {error}");
        }
    }
}

/// Called once from `lib.rs` setup.
pub fn install_event_forwarder(app: &tauri::AppHandle, supervisor: &RuntimeSupervisor) {
    tauri::async_runtime::spawn(forward_supervisor_events(app.clone(), supervisor.clone()));
}

#[derive(Serialize)]
pub struct RuntimePingResult {
    pub pong: bool,
    pub timestamp: i64,
}

#[tauri::command]
pub async fn runtime_ping(
    state: State<'_, crate::state::AppState>,
) -> AppResult<RuntimePingResult> {
    let result = state
        .runtime
        .request("runtime.ping", serde_json::json!({}), RUNTIME_RPC_TIMEOUT)
        .await
        .map_err(supervisor_error)?;
    let pong = result
        .get("pong")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let timestamp = result
        .get("timestamp")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    Ok(RuntimePingResult { pong, timestamp })
}

#[derive(Serialize)]
pub struct RuntimeVersionResult {
    #[serde(rename = "runtimeVersion")]
    pub runtime_version: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "nodeVersion")]
    pub node_version: String,
}

#[tauri::command]
pub async fn runtime_version(
    state: State<'_, crate::state::AppState>,
) -> AppResult<RuntimeVersionResult> {
    let result = state
        .runtime
        .request(
            "runtime.version",
            serde_json::json!({}),
            RUNTIME_RPC_TIMEOUT,
        )
        .await
        .map_err(supervisor_error)?;
    let text = |key: &str| {
        result
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let protocol_version = result
        .get("protocolVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default() as u32;
    Ok(RuntimeVersionResult {
        runtime_version: text("runtimeVersion"),
        protocol_version,
        node_version: text("nodeVersion"),
    })
}

#[tauri::command]
pub async fn runtime_status(
    state: State<'_, crate::state::AppState>,
) -> AppResult<crate::runtime::supervisor::RuntimeStatus> {
    Ok(state.runtime.status().await)
}

#[tauri::command]
pub async fn runtime_start(
    state: State<'_, crate::state::AppState>,
) -> AppResult<crate::runtime::supervisor::RuntimeStatus> {
    state.runtime.start().await
}

#[tauri::command]
pub async fn runtime_stop(
    state: State<'_, crate::state::AppState>,
) -> AppResult<crate::runtime::supervisor::RuntimeStatus> {
    state.runtime.stop().await
}

#[tauri::command]
pub async fn runtime_restart(
    state: State<'_, crate::state::AppState>,
) -> AppResult<crate::runtime::supervisor::RuntimeStatus> {
    state.runtime.restart().await
}

/// Lifecycle methods (`runtime.*`) go through their dedicated commands
/// (start/stop/status/...), never the generic domain forwarder.
fn ensure_domain_method(method: &str) -> Result<(), RpcError> {
    if method.starts_with("runtime.") {
        return Err(RpcError {
            code: "INVALID_REQUEST".to_string(),
            message: format!("Method '{method}' must use its dedicated command"),
            user_message: None,
            data: None,
        });
    }
    Ok(())
}

/// Generic domain RPC forwarder: `runtime_request(method, params)` → the
/// matching `session.*` / `agent.*` / `harness.*` method on the runtime.
/// Errors are the runtime's `RpcError` payloads verbatim (code + message +
/// sanitized userMessage), so the renderer sees the exact shape the Electron
/// preload would have thrown (`AppErrorPayload`).
#[tauri::command]
pub async fn runtime_request(
    state: State<'_, crate::state::AppState>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, RpcError> {
    ensure_domain_method(&method)?;
    state.runtime.desktop_request(&method, params).await
}

#[cfg(test)]
mod tests {
    use super::ensure_domain_method;

    #[test]
    fn rejects_lifecycle_methods_but_allows_domain() {
        let err = ensure_domain_method("runtime.shutdown").expect_err("guarded");
        assert_eq!(err.code, "INVALID_REQUEST");
        assert!(err.message.contains("runtime.shutdown"));

        for method in ["session.list", "agent.start", "harness.compact"] {
            ensure_domain_method(method).expect("domain methods pass");
        }
    }
}
