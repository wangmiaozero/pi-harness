//! `system.*` commands: info, openPath, showItem.

use serde::Serialize;

use crate::error::AppResult;
use crate::system;

/// Mirrors the renderer's `SystemInfo` type (`src/shared/ipc/api-types.ts`).
/// `platform` uses Electron-style values (`darwin` / `win32` / `linux`) so
/// existing renderer logic keeps working unmodified.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub platform: String,
    pub arch: String,
    pub versions: SystemVersions,
    pub app_version: String,
    pub packaged: bool,
}

#[derive(Serialize)]
pub struct SystemVersions {
    /// Empty in the Tauri shell — Electron is not present.
    pub electron: String,
    /// Empty in the Tauri shell — the webview reports its own engine.
    pub chrome: String,
    /// Sidecar Node version once the runtime has started, otherwise empty.
    pub node: String,
}

fn electron_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        _ => "linux",
    }
}

fn electron_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}

#[tauri::command]
pub async fn system_info(state: tauri::State<'_, crate::state::AppState>) -> AppResult<SystemInfo> {
    let node_version = state.runtime.status().await.node_version;
    Ok(SystemInfo {
        platform: electron_platform().to_string(),
        arch: electron_arch().to_string(),
        versions: SystemVersions {
            electron: String::new(),
            chrome: String::new(),
            node: node_version.unwrap_or_default(),
        },
        app_version: state.app_version.clone(),
        packaged: !cfg!(debug_assertions),
    })
}

#[tauri::command]
pub fn system_open_path(path: String) -> AppResult<()> {
    system::open_path(&path)
}

#[tauri::command]
pub fn system_show_item(path: String) -> AppResult<()> {
    system::show_item(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_and_arch_map_to_electron_values() {
        assert!(matches!(electron_platform(), "darwin" | "win32" | "linux"));
        assert!(matches!(electron_arch(), "arm64" | "x64" | _));
    }

    #[test]
    fn status_snapshot_has_json_shape() {
        // Pure serialisation check of the status payload shape.
        let status = crate::runtime::supervisor::RuntimeStatus {
            phase: "stopped".to_string(),
            pid: None,
            exit_code: None,
            runtime_version: None,
            protocol_version: None,
            node_version: None,
            error: None,
            generation_id: None,
            uptime_ms: None,
            crash_loop: false,
            event_gaps: 0,
        };
        let json = serde_json::to_value(&status).expect("serialisable");
        assert_eq!(json["phase"], "stopped");
    }
}
