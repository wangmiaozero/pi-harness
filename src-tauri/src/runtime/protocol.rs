//! JSONL RPC protocol types mirrored from `runtime/src/protocol/messages.ts`.
//! The wire contract is documented in `docs/tauri-migration/protocol.md`.
//!
//! stdout carries protocol messages only; the runtime logs diagnostics on
//! stderr. Unknown keys are ignored for forward compatibility.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Protocol version 1 (see `runtime/src/version.ts`). Must match the runtime.
pub const PROTOCOL_VERSION: u32 = 1;

/// Error codes shared with the runtime. Values must stay identical to the
/// TypeScript `RPC_ERROR_CODES` union.
pub const INVALID_REQUEST: &str = "INVALID_REQUEST";
pub const METHOD_NOT_FOUND: &str = "METHOD_NOT_FOUND";
pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
pub const HARNESS_ERROR: &str = "HARNESS_ERROR";
pub const SHUTDOWN: &str = "SHUTDOWN";
/// Host-side codes (never sent by the runtime).
pub const RUNTIME_EXITED: &str = "RUNTIME_EXITED";
pub const PROTOCOL_MISMATCH: &str = "PROTOCOL_MISMATCH";
pub const RUNTIME_TIMEOUT: &str = "RUNTIME_TIMEOUT";

/// One host -> runtime request (stdin).
#[derive(Debug, Clone, Serialize)]
pub struct RpcRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Typed runtime -> host error (inside a response, or resolving a request).
/// `user_message` carries the runtime's sanitized, user-facing phrasing so
/// the renderer can show it without re-deriving anything (mirrors
/// `AppErrorPayload.userMessage`).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// One runtime -> host message (stdout), discriminated by shape.
#[derive(Debug, Clone)]
pub enum RuntimeMessage {
    Response {
        id: String,
        outcome: Result<serde_json::Value, RpcError>,
    },
    Event {
        name: String,
        payload: serde_json::Value,
    },
}

#[derive(Deserialize)]
struct RawResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<RpcError>,
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    event: Option<String>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
}

impl RuntimeMessage {
    /// Parse one stdout line. Returns `None` on a protocol violation.
    pub fn parse(line: &str) -> Option<RuntimeMessage> {
        let value: serde_json::Value = serde_json::from_str(line).ok()?;
        let raw: RawResponse = serde_json::from_value(value.clone()).ok()?;

        if raw.kind.as_deref() == Some("event") {
            let name = raw.event?;
            let payload = raw.payload.unwrap_or(serde_json::Value::Null);
            return Some(RuntimeMessage::Event { name, payload });
        }

        let id = raw.id?;
        // Key-presence check: a success response may legitimately carry
        // `"result": null` (void domain methods); serde's Option cannot
        // distinguish that from a missing field.
        if value.get("result").is_some() {
            return Some(RuntimeMessage::Response {
                id,
                outcome: Ok(raw.result.unwrap_or(serde_json::Value::Null)),
            });
        }
        if let Some(error) = raw.error {
            return Some(RuntimeMessage::Response {
                id,
                outcome: Err(error),
            });
        }
        None
    }
}

impl fmt::Display for RpcRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.id, self.method)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_success_response() {
        let message = RuntimeMessage::parse(r#"{"id":"req_1","result":{"pong":true}}"#)
            .expect("valid response");
        match message {
            RuntimeMessage::Response { id, outcome } => {
                assert_eq!(id, "req_1");
                assert_eq!(outcome.expect("result"), serde_json::json!({"pong": true}));
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn parses_null_result_response() {
        // Void domain methods (agent.prompt, harness.setTools, …) respond
        // with an explicit `result: null`.
        let message = RuntimeMessage::parse(r#"{"id":"req_3","result":null}"#)
            .expect("valid response");
        match message {
            RuntimeMessage::Response { id, outcome } => {
                assert_eq!(id, "req_3");
                assert!(outcome.expect("result").is_null());
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn parses_error_response() {
        let message = RuntimeMessage::parse(
            r#"{"id":"req_1","error":{"code":"METHOD_NOT_FOUND","message":"Unknown method"}}"#,
        )
        .expect("valid response");
        match message {
            RuntimeMessage::Response { id, outcome } => {
                assert_eq!(id, "req_1");
                let error = outcome.expect_err("error");
                assert_eq!(error.code, "METHOD_NOT_FOUND");
                assert_eq!(error.message, "Unknown method");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn parses_event_envelope() {
        let message =
            RuntimeMessage::parse(r#"{"type":"event","event":"runtime.ready","payload":{"a":1}}"#)
                .expect("valid event");
        match message {
            RuntimeMessage::Event { name, payload } => {
                assert_eq!(name, "runtime.ready");
                assert_eq!(payload, serde_json::json!({"a": 1}));
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn parses_event_without_payload() {
        let message =
            RuntimeMessage::parse(r#"{"type":"event","event":"runtime.stopping"}"#).expect("valid");
        match message {
            RuntimeMessage::Event { name, payload } => {
                assert_eq!(name, "runtime.stopping");
                assert_eq!(payload, serde_json::Value::Null);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(RuntimeMessage::parse("garbage").is_none());
        assert!(RuntimeMessage::parse("42").is_none());
        // Both result and error present — invalid.
        assert!(RuntimeMessage::parse(r#"{"id":"x","result":{},"error":{}}"#).is_none());
        // Missing id.
        assert!(RuntimeMessage::parse(r#"{"result":{}}"#).is_none());
        // Event without name.
        assert!(RuntimeMessage::parse(r#"{"type":"event"}"#).is_none());
    }

    #[test]
    fn serialises_request_with_params() {
        let request = RpcRequest {
            id: "req_9".into(),
            method: "runtime.ping".into(),
            params: serde_json::json!({}),
        };
        let json = serde_json::to_string(&request).expect("serialisable");
        assert_eq!(
            json,
            r#"{"id":"req_9","method":"runtime.ping","params":{}}"#
        );
    }
}
