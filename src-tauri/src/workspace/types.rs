use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub resolved_path: String,
    pub role: String,
    pub readonly: bool,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspace {
    pub id: String,
    pub name: String,
    pub workspace_file: Option<String>,
    pub folders: Vec<WorkspaceFolder>,
    pub settings: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub id: String,
    pub name: String,
    pub workspace_file: Option<String>,
    pub folder_paths: Vec<String>,
    pub last_opened_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSnapshot {
    pub id: String,
    pub path: String,
    pub role: String,
    #[serde(default)]
    pub readonly: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBinding {
    pub workspace_id: String,
    pub main_folder_id: Option<String>,
    pub folders: Vec<FolderSnapshot>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStateRecord {
    pub active: Option<PersistedActive>,
    #[serde(default)]
    pub recent: Vec<RecentWorkspace>,
    #[serde(default)]
    pub session_bindings: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedActive {
    pub workspace_file: Option<String>,
    pub folders: Vec<PersistedFolder>,
    #[serde(default)]
    pub settings: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedFolder {
    pub path: String,
    pub resolved_path: String,
    pub name: Option<String>,
    pub role: String,
    pub readonly: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInput {
    pub workspace_file: Option<String>,
    pub folders: Vec<SyncFolder>,
    pub settings: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFolder {
    pub path: String,
    pub resolved_path: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
    pub readonly: Option<bool>,
}
