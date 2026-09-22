//! Host-level integration test (task §34): the full event-forwarding chain
//!
//! ```text
//! Rust (supervisor)
//!   → Runtime sidecar (real runtime/dist/index.js)
//!     → mock Pi SDK (tests/fixtures/mock-pi-sdk.mjs)
//!       → deterministic agent events
//!         → back to Rust as RuntimeEvent broadcasts
//! ```
//!
//! No real SDK, no network, no API tokens. The mock SDK is injected through
//! `PI_HARNESS_TEST_PI_SDK` via the `with_extra_env` test seam.

use std::collections::HashMap;
use std::time::Duration;

use pi_harness_lib::runtime::supervisor::{RuntimeSupervisor, SupervisorEvent};

/// Background collector: prints sidecar stderr live and records the
/// deterministic turn events while requests run concurrently.
async fn collect(
    mut receiver: tokio::sync::broadcast::Receiver<SupervisorEvent>,
) -> (bool, bool, bool) {
    let mut saw_running = false;
    let mut saw_start = false;
    let mut saw_end = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if saw_running && saw_start && saw_end {
            break;
        }
        let event = match tokio::time::timeout_at(deadline, receiver.recv()).await {
            Ok(Ok(event)) => event,
            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                eprintln!("[test] collector lagged, skipped {n}");
                continue;
            }
            Err(_) => break,
        };
        match event {
            SupervisorEvent::Log { line } => eprintln!("[sidecar stderr] {line}"),
            SupervisorEvent::RuntimeEvent { name, payload } => match name.as_str() {
                "agent.running" => {
                    if payload["ids"]
                        .as_array()
                        .map(|ids| !ids.is_empty())
                        .unwrap_or(false)
                    {
                        saw_running = true;
                    }
                }
                "agent.event" => {
                    let envelopes = match payload.as_array() {
                        Some(batch) => batch.clone(),
                        None => vec![payload],
                    };
                    for envelope in envelopes {
                        let event_type = envelope["event"]["type"].as_str().unwrap_or("");
                        if event_type == "agent_start" {
                            saw_start = true;
                        }
                        if event_type == "agent_end" {
                            saw_end = true;
                        }
                    }
                }
                _ => {}
            },
            SupervisorEvent::PhaseChanged(phase) => {
                eprintln!("[test] runtime phase -> {phase:?}");
            }
        }
    }
    (saw_running, saw_start, saw_end)
}

#[tokio::test]
async fn runtime_forwards_agent_events_from_mock_sdk() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("mock-pi-sdk.mjs");
    assert!(fixture.is_file(), "mock SDK fixture must exist");

    let agent_dir = std::env::temp_dir().join(format!(
        "pi-harness-it-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(agent_dir.join("sessions")).expect("temp agent dir");

    let mut env = HashMap::new();
    env.insert(
        "PI_HARNESS_TEST_PI_SDK".to_string(),
        fixture.display().to_string(),
    );
    env.insert(
        "PI_HARNESS_PI_CONFIG_DIR".to_string(),
        agent_dir.display().to_string(),
    );

    let supervisor = RuntimeSupervisor::new().with_extra_env(env);
    let collector = tokio::spawn(collect(supervisor.subscribe()));

    supervisor
        .start()
        .await
        .expect("runtime starts with mock SDK");

    // Scenario B: a domain request is valid right after boot — the session
    // list arrives before any agent exists (lazy SDK load, empty list).
    let listed = supervisor
        .desktop_request("session.list", serde_json::json!({}))
        .await
        .expect("session.list works right after start");
    assert!(
        listed["sessions"].as_array().is_some(),
        "session.list returns sessions array"
    );

    // Domain errors cross the hop with typed codes: an unknown session id
    // must surface SESSION_NOT_FOUND, not a hang or generic error.
    let missing = supervisor
        .desktop_request(
            "agent.prompt",
            serde_json::json!({ "sessionId": "no-such-session", "message": "x" }),
        )
        .await
        .expect_err("prompt on unknown session must fail");
    assert_eq!(missing.code, "SESSION_NOT_FOUND");

    let started = supervisor
        .desktop_request("agent.start", serde_json::json!({ "cwd": agent_dir }))
        .await
        .expect("agent.start boots a session");
    let session_id = started["sessionId"]
        .as_str()
        .expect("agent.start returns a sessionId")
        .to_string();
    eprintln!("[test] session started: {session_id}");

    supervisor
        .desktop_request(
            "agent.prompt",
            serde_json::json!({ "sessionId": session_id, "message": "hello" }),
        )
        .await
        .expect("agent.prompt resolves");

    let (saw_running, saw_start, saw_end) = collector.await.expect("collector task");

    let _ = supervisor.stop().await;
    for _ in 0..100 {
        if supervisor.status().await.phase == "stopped" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let _ = std::fs::remove_dir_all(&agent_dir);

    assert!(saw_running, "agent.running with ids must be forwarded");
    assert!(saw_start, "agent_start must be forwarded as agent.event");
    assert!(saw_end, "agent_end must be forwarded as agent.event");
}
