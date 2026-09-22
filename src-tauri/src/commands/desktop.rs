//! Host-owned Phase 5 actions: clipboard, open URL, backup/logs folders,
//! diagnostics export dialog. Business data still comes from the sidecar.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{AppError, AppResult};
use crate::runtime::supervisor::RuntimeSupervisor;
use crate::system;

const NODE_DOWNLOAD_URL: &str = "https://nodejs.org/en/download";
const PI_INSTALL_COMMAND: &str = "npm install -g --ignore-scripts @earendil-works/pi-coding-agent";

fn user_data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("PI_HARNESS_USER_DATA") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn file_path_to_string(path: FilePath) -> String {
    path.into_path()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

pub fn write_clipboard(text: &str) -> AppResult<()> {
    let mut command = if cfg!(target_os = "macos") {
        Command::new("pbcopy")
    } else if cfg!(target_os = "windows") {
        Command::new("clip")
    } else if std::path::Path::new("/usr/bin/wl-copy").exists()
        || which_on_path("wl-copy").is_some()
    {
        Command::new("wl-copy")
    } else {
        let mut clip = Command::new("xclip");
        clip.args(["-selection", "clipboard"]);
        clip
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| AppError::io(format!("Clipboard is unavailable: {error}")))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| AppError::io(format!("Clipboard write failed: {error}")))?;
    }
    let status = child
        .wait()
        .map_err(|error| AppError::io(format!("Clipboard wait failed: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::io("Clipboard write failed"))
    }
}

pub fn open_https_url(url: &str) -> AppResult<()> {
    if !(url.starts_with("https://nodejs.org/") || url.starts_with("https://github.com/")) {
        return Err(AppError::invalid_path(format!(
            "Refused to open URL: {url}"
        )));
    }
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/c", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    }
    .map_err(|error| AppError::io(format!("Failed to open URL: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::io("Failed to open URL"))
    }
}

#[tauri::command]
pub fn environment_snapshot() -> crate::environment::EnvironmentSnapshot {
    crate::environment::snapshot()
}

#[tauri::command]
pub fn pi_copy_install_command() -> AppResult<String> {
    write_clipboard(PI_INSTALL_COMMAND)?;
    Ok(PI_INSTALL_COMMAND.to_string())
}

#[tauri::command]
pub fn pi_open_node_download() -> AppResult<()> {
    open_https_url(NODE_DOWNLOAD_URL)
}

#[tauri::command]
pub fn backup_open_folder(app: AppHandle) -> AppResult<String> {
    let folder = user_data_dir(&app).join("backups");
    std::fs::create_dir_all(&folder).map_err(AppError::from)?;
    let text = folder.to_string_lossy().replace('\\', "/");
    system::open_path(&text)?;
    Ok(text)
}

#[tauri::command]
pub fn logs_open_folder(app: AppHandle) -> AppResult<()> {
    let file = user_data_dir(&app).join("logs").join("main.log");
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::from)?;
    }
    if !file.exists() {
        std::fs::write(&file, "").map_err(AppError::from)?;
    }
    system::show_item(&file.to_string_lossy())
}

#[tauri::command]
pub async fn diagnostics_copy(state: State<'_, crate::state::AppState>) -> AppResult<String> {
    let text = request_text(&state.runtime, "diagnostics.copyText").await?;
    write_clipboard(&text)?;
    Ok(text)
}

#[tauri::command]
pub async fn diagnostics_export(
    app: AppHandle,
    state: State<'_, crate::state::AppState>,
) -> AppResult<String> {
    let text = request_text(&state.runtime, "diagnostics.copyText").await?;
    let picked = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name("diagnostics.json")
        .blocking_save_file();
    let Some(path) = picked else {
        return Err(AppError::validation("Diagnostics export was cancelled"));
    };
    let dest = file_path_to_string(path);
    std::fs::write(&dest, text).map_err(AppError::from)?;
    Ok(dest)
}

#[tauri::command]
pub async fn capabilities_open_homepage(
    state: State<'_, crate::state::AppState>,
    skill_id: String,
) -> AppResult<()> {
    let url = request_text_params(
        &state.runtime,
        "capabilities.homepageUrl",
        serde_json::json!({ "skillId": skill_id }),
    )
    .await?;
    open_https_url(&url)
}

#[tauri::command]
pub async fn sessions_export(
    app: AppHandle,
    state: State<'_, crate::state::AppState>,
    session_id: String,
    format: String,
) -> AppResult<Option<String>> {
    let payload = state
        .runtime
        .desktop_request(
            "session.renderExport",
            serde_json::json!({ "sessionId": session_id, "format": format }),
        )
        .await
        .map_err(|error| AppError::new(&error.code, error.message))?;
    save_export(&app, &payload, &format)
}

#[tauri::command]
pub async fn sessions_export_project(
    app: AppHandle,
    state: State<'_, crate::state::AppState>,
    name: String,
    session_ids: Vec<String>,
    format: String,
) -> AppResult<Option<String>> {
    let payload = state
        .runtime
        .desktop_request(
            "session.renderProjectExport",
            serde_json::json!({ "name": name, "sessionIds": session_ids, "format": format }),
        )
        .await
        .map_err(|error| AppError::new(&error.code, error.message))?;
    save_export(&app, &payload, &format)
}

fn save_export(app: &AppHandle, payload: &Value, format: &str) -> AppResult<Option<String>> {
    let body = payload
        .get("body")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::validation("Export body missing"))?;
    let default_name = payload
        .get("defaultName")
        .and_then(Value::as_str)
        .unwrap_or("session");
    let ext = if format == "html" { "html" } else { "md" };
    let dialog = app
        .dialog()
        .file()
        .set_file_name(format!("{default_name}.{ext}"));
    let dialog = if format == "html" {
        dialog.add_filter("HTML", &["html"])
    } else {
        dialog.add_filter("Markdown", &["md"])
    };
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let dest = file_path_to_string(path);
    std::fs::write(&dest, body).map_err(AppError::from)?;
    Ok(Some(dest))
}

async fn request_text(runtime: &RuntimeSupervisor, method: &str) -> AppResult<String> {
    request_text_params(runtime, method, serde_json::json!({})).await
}

async fn request_text_params(
    runtime: &RuntimeSupervisor,
    method: &str,
    params: Value,
) -> AppResult<String> {
    let result = runtime
        .desktop_request(method, params)
        .await
        .map_err(|error| AppError::new(&error.code, error.message))?;
    match result {
        Value::String(text) => Ok(text),
        other => Ok(other.to_string()),
    }
}

fn which_on_path(program: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_allowlisted_urls() {
        let error = open_https_url("https://example.com/").expect_err("blocked");
        assert_eq!(error.parts().0, "PATH_DENIED");
    }

    #[test]
    fn allows_nodejs_download() {
        // Do not actually open a browser in unit tests — only the allowlist.
        assert!(NODE_DOWNLOAD_URL.starts_with("https://nodejs.org/"));
        assert!(PI_INSTALL_COMMAND.contains("@earendil-works/pi-coding-agent"));
    }
}
