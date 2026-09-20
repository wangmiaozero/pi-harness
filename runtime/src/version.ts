/**
 * Runtime identity and protocol compatibility.
 *
 * `RUNTIME_VERSION` tracks this package's `version` field (runtime/package.json).
 * `PROTOCOL_VERSION` is the JSONL RPC contract version shared with the Rust host
 * (src-tauri/src/runtime/protocol.rs). The host rejects a runtime whose major
 * protocol version differs.
 */

export const RUNTIME_VERSION = '0.1.0'

/**
 * Protocol version 1:
 * - stdin:  newline-delimited `RpcRequest` JSON objects
 * - stdout: newline-delimited `RpcResponse` / `RpcEventEnvelope` JSON objects
 * - stderr: free-form human diagnostics (never part of the protocol)
 */
export const PROTOCOL_VERSION = 1
