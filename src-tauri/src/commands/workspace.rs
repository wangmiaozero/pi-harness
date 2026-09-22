//! Workspace / files / git / worktree command handlers.

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{AppError, AppResult};
use crate::git::service::GitActionRequest;
use crate::host::DesktopHost;
use crate::workspace::types::{FolderSnapshot, SyncInput};

fn host(app: &AppHandle) -> AppResult<tauri::State<'_, DesktopHost>> {
    app.try_state::<DesktopHost>()
        .ok_or_else(|| AppError::runtime("Workspace host is not ready"))
}

/// Authorize dropped directories and notify the renderer.
/// WKWebView HTML5 `File` has no filesystem path; this is the Tauri drop path.
pub fn handle_native_folder_drop(app: &AppHandle, paths: &[std::path::PathBuf]) {
    let Ok(host) = host(app) else {
        return;
    };
    let mut dirs = Vec::new();
    for path in paths {
        if !path.is_dir() {
            continue;
        }
        let raw = path.to_string_lossy().replace('\\', "/");
        if let Ok(authorized) = host.access.authorize_root(&raw) {
            dirs.push(authorized);
        }
    }
    if dirs.is_empty() {
        return;
    }
    let _ = app.emit(
        "pi-harness:event:native-folder-drop",
        serde_json::json!({ "paths": dirs }),
    );
}

#[tauri::command]
pub fn workspace_pick_directory(app: AppHandle) -> AppResult<Option<String>> {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(path) = picked else {
        return Ok(None);
    };
    let text = file_path_to_string(path);
    let granted = host(&app)?.access.authorize_root(&text)?;
    Ok(Some(granted))
}

#[tauri::command]
pub fn workspace_pick_workspace_sources(app: AppHandle) -> AppResult<Vec<String>> {
    let picked = app
        .dialog()
        .file()
        .set_can_create_directories(true)
        .blocking_pick_folders();
    let Some(paths) = picked else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for path in paths {
        let text = file_path_to_string(path);
        let granted = host(&app)?.access.authorize_root(&text)?;
        out.push(granted.clone());
        if let Ok(entries) = std::fs::read_dir(&granted) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.ends_with(".code-workspace") {
                    out.push(entry.path().to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn workspace_pick_workspace_file(app: AppHandle) -> AppResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Workspace", &["code-workspace"])
        .blocking_pick_file();
    Ok(picked.map(file_path_to_string))
}

#[tauri::command]
pub fn workspace_save_workspace_file(app: AppHandle) -> AppResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Workspace", &["code-workspace"])
        .set_file_name("workspace.code-workspace")
        .blocking_save_file();
    Ok(picked.map(file_path_to_string))
}

#[tauri::command]
pub fn workspace_allow_root(app: AppHandle, root: String) -> AppResult<()> {
    host(&app)?.access.restore_root(&root)?;
    Ok(())
}

#[tauri::command]
pub fn workspace_authorize_dropped_root(app: AppHandle, root: String) -> AppResult<String> {
    host(&app)?.access.authorize_root(&root)
}

#[tauri::command]
pub fn workspace_get_path_for_file(app: AppHandle, file: Value) -> AppResult<String> {
    let path = file
        .as_str()
        .map(ToString::to_string)
        .or_else(|| {
            file.get("path")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .ok_or_else(|| AppError::validation("Dropped file path is unavailable"))?;
    host(&app)?.access.authorize_root(&path)
}

#[tauri::command]
pub fn workspace_get_active(app: AppHandle) -> AppResult<Option<Value>> {
    let workspace = host(&app)?.workspace().get_active();
    Ok(workspace.map(|item| serde_json::to_value(item).unwrap_or(Value::Null)))
}

#[tauri::command]
pub fn workspace_sync(app: AppHandle, input: SyncInput) -> AppResult<Value> {
    let workspace = host(&app)?.workspace().sync(input)?;
    Ok(serde_json::to_value(workspace).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn workspace_open_file(app: AppHandle, path: String) -> AppResult<Value> {
    let workspace = host(&app)?.workspace().open_workspace_file(&path)?;
    Ok(serde_json::to_value(workspace).unwrap_or(Value::Null))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    pub path: Option<String>,
    pub workspace_file: Option<String>,
    pub folders: Vec<crate::workspace::types::SyncFolder>,
    pub settings: Option<Value>,
}

#[tauri::command]
pub fn workspace_save(app: AppHandle, input: SaveInput) -> AppResult<Value> {
    let dest = input.path.or(input.workspace_file);
    let workspace = host(&app)?.workspace().save(SyncInput {
        workspace_file: dest,
        folders: input.folders,
        settings: input.settings,
    })?;
    Ok(serde_json::to_value(workspace).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn workspace_search(
    app: AppHandle,
    query: String,
    scope: Option<String>,
    folder_id: Option<String>,
) -> AppResult<Vec<Value>> {
    host(&app)?
        .workspace()
        .search(&query, scope.as_deref(), folder_id.as_deref())
}

#[tauri::command]
pub fn workspace_open_terminal(app: AppHandle, directory: String) -> AppResult<()> {
    host(&app)?.workspace().open_terminal(&directory)
}

#[tauri::command]
pub fn workspace_relocate_folder(
    app: AppHandle,
    folder_id: String,
    path: String,
) -> AppResult<Value> {
    let workspace = host(&app)?.workspace().relocate_folder(&folder_id, &path)?;
    Ok(serde_json::to_value(workspace).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn workspace_list_recent(app: AppHandle) -> AppResult<Vec<Value>> {
    let recent = host(&app)?.workspace().list_recent()?;
    Ok(recent
        .into_iter()
        .map(|item| serde_json::to_value(item).unwrap_or(Value::Null))
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindInput {
    pub session_id: String,
    pub workspace_id: String,
    pub folders: Vec<FolderSnapshot>,
    pub main_folder_id: Option<String>,
}

#[tauri::command]
pub fn workspace_bind_session(app: AppHandle, input: BindInput) -> AppResult<()> {
    host(&app)?.workspace().bind_session(
        &input.session_id,
        &input.workspace_id,
        input.folders,
        input.main_folder_id,
    )
}

#[tauri::command]
pub fn workspace_get_session_binding(
    app: AppHandle,
    session_id: String,
) -> AppResult<Option<Value>> {
    Ok(host(&app)?.workspace().get_session_binding(&session_id))
}

#[tauri::command]
pub fn workspace_list_session_bindings(app: AppHandle) -> AppResult<Value> {
    Ok(host(&app)?.workspace().list_session_bindings())
}

#[tauri::command]
pub fn workspace_assert_cwd(app: AppHandle, cwd: String) -> AppResult<String> {
    host(&app)?.access.assert_allowed(&cwd, true)
}

#[tauri::command]
pub fn files_list(app: AppHandle, directory: String) -> AppResult<Vec<Value>> {
    host(&app)?.files.list(&directory)
}

#[tauri::command]
pub fn files_read(app: AppHandle, path: String) -> AppResult<Value> {
    host(&app)?.files.read_preview(&path)
}

#[tauri::command]
pub fn files_write(
    app: AppHandle,
    path: String,
    text: String,
    expected_revision: String,
    overwrite: Option<bool>,
) -> AppResult<Value> {
    host(&app)?
        .files
        .write_text(&path, &text, &expected_revision, overwrite.unwrap_or(false))
}

#[tauri::command]
pub fn files_upload(
    app: AppHandle,
    directory: String,
    file_name: String,
    data_base64: String,
    overwrite: Option<bool>,
) -> AppResult<Value> {
    host(&app)?.files.upload(
        &directory,
        &file_name,
        &data_base64,
        overwrite.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn git_status(app: AppHandle, cwd: String) -> AppResult<Value> {
    host(&app)?.git.status(&cwd).await
}

#[tauri::command]
pub async fn git_status_many(app: AppHandle, cwds: Vec<String>) -> AppResult<Vec<Value>> {
    host(&app)?.git.status_many(&cwds).await
}

#[tauri::command]
pub async fn git_diff(app: AppHandle, cwd: String, file_path: String) -> AppResult<Value> {
    host(&app)?.git.diff(&cwd, &file_path).await
}

#[tauri::command]
pub async fn git_stage(app: AppHandle, cwd: String, file_paths: Vec<String>) -> AppResult<()> {
    host(&app)?.git.stage(&cwd, &file_paths).await
}

#[tauri::command]
pub async fn git_unstage(app: AppHandle, cwd: String, file_paths: Vec<String>) -> AppResult<()> {
    host(&app)?.git.unstage(&cwd, &file_paths).await
}

#[tauri::command]
pub async fn git_commit(app: AppHandle, cwd: String, message: String) -> AppResult<Value> {
    host(&app)?.git.commit(&cwd, &message).await
}

#[tauri::command]
pub async fn git_generate_commit_message(
    app: AppHandle,
    state: State<'_, crate::state::AppState>,
    cwd: String,
    draft: Option<String>,
    model: Option<Value>,
) -> AppResult<Value> {
    let context = host(&app)?
        .git
        .commit_message_context(&cwd, draft.as_deref().unwrap_or(""))
        .await?;
    let mut params = context;
    if let Some(model) = model {
        params["model"] = model;
    }
    state
        .runtime
        .desktop_request("git.generateCommitMessage", params)
        .await
        .map_err(|error| AppError::runtime(error.message))
}

#[tauri::command]
pub async fn git_history(app: AppHandle, cwd: String, limit: Option<u32>) -> AppResult<Vec<Value>> {
    host(&app)?.git.history(&cwd, limit.unwrap_or(100)).await
}

#[tauri::command]
pub async fn git_overview(app: AppHandle, cwd: String) -> AppResult<Value> {
    host(&app)?.git.overview(&cwd).await
}

#[tauri::command]
pub async fn git_commit_details(app: AppHandle, cwd: String, hash: String) -> AppResult<Value> {
    host(&app)?.git.commit_details(&cwd, &hash).await
}

#[tauri::command]
pub async fn git_commit_diff(
    app: AppHandle,
    cwd: String,
    hash: String,
    file_path: String,
) -> AppResult<Value> {
    host(&app)?.git.commit_diff(&cwd, &hash, &file_path).await
}

#[tauri::command]
pub async fn git_action(app: AppHandle, input: GitActionRequest) -> AppResult<Value> {
    host(&app)?.git.action(input).await
}

#[tauri::command]
pub async fn git_file_history(
    app: AppHandle,
    cwd: String,
    file_path: String,
    limit: Option<u32>,
) -> AppResult<Vec<Value>> {
    host(&app)?
        .git
        .file_history(&cwd, &file_path, limit.unwrap_or(50))
        .await
}

#[tauri::command]
pub async fn worktrees_list(app: AppHandle, cwd: String) -> AppResult<Vec<Value>> {
    host(&app)?.worktrees.list(&cwd).await
}

#[tauri::command]
pub async fn worktrees_create(app: AppHandle, cwd: String, branch: String) -> AppResult<Value> {
    host(&app)?.worktrees.create(&cwd, &branch).await
}

#[tauri::command]
pub async fn worktrees_remove(
    app: AppHandle,
    cwd: String,
    worktree_path: String,
    force: Option<bool>,
) -> AppResult<()> {
    host(&app)?
        .worktrees
        .remove(&cwd, &worktree_path, force.unwrap_or(false))
        .await
}

fn file_path_to_string(path: FilePath) -> String {
    path.into_path()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}
