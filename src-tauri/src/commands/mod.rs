//! Tauri command handlers. Thin: validate input, delegate to the platform
//! modules, and translate errors into the serialised `AppErrorPayload` shape.
//!
//! Command naming mirrors the Electron IPC contract
//! (`src/shared/ipc/channels.ts`): `system:info` -> `system_info`, etc.

pub mod runtime;
pub mod system;
pub mod window;
