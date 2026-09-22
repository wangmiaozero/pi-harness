//! Active workspace, recents, session bindings. Same JSON as Electron.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::persist;
use crate::security::{self, AccessService, FolderGrant};

use super::search::SearchEngine;
use super::types::{
    AgentWorkspace, FolderSnapshot, PersistedActive, PersistedFolder, RecentWorkspace,
    SessionBinding, SyncFolder, SyncInput, WorkspaceFolder, WorkspaceStateRecord,
};
use super::watcher::WatcherHub;

const MAX_RECENT: usize = 20;

pub struct WorkspaceService {
    access: AccessService,
    store_path: std::path::PathBuf,
    searcher: SearchEngine,
    watcher: WatcherHub,
    active: Option<AgentWorkspace>,
    bindings: serde_json::Map<String, Value>,
}

impl WorkspaceService {
    pub fn load(data_dir: &Path, access: AccessService, watcher: WatcherHub) -> AppResult<Self> {
        let store_path = data_dir.join("workspace-state.json");
        let record: WorkspaceStateRecord = persist::read_json(&store_path)?;
        let mut service = Self {
            access,
            store_path,
            searcher: SearchEngine::new(),
            watcher,
            active: None,
            bindings: record.session_bindings,
        };
        if let Some(active) = record.active {
            if !active.folders.is_empty() {
                service.active = Some(service.hydrate(active)?);
                service.apply_access();
            }
        }
        Ok(service)
    }

    pub fn get_active(&self) -> Option<AgentWorkspace> {
        self.active.clone()
    }

    pub fn list_recent(&self) -> AppResult<Vec<RecentWorkspace>> {
        let record: WorkspaceStateRecord = persist::read_json(&self.store_path)?;
        Ok(record.recent)
    }

    pub fn bind_session(
        &mut self,
        session_id: &str,
        workspace_id: &str,
        folders: Vec<FolderSnapshot>,
        main_folder_id: Option<String>,
    ) -> AppResult<()> {
        let binding = SessionBinding {
            workspace_id: workspace_id.to_string(),
            main_folder_id,
            folders,
        };
        self.bindings.insert(
            session_id.to_string(),
            serde_json::to_value(binding).unwrap_or(Value::Null),
        );
        self.persist_bindings()
    }

    pub fn get_session_binding(&self, session_id: &str) -> Option<Value> {
        self.bindings.get(session_id).cloned()
    }

    pub fn list_session_bindings(&self) -> Value {
        Value::Object(self.bindings.clone())
    }

    pub fn sync(&mut self, input: SyncInput) -> AppResult<AgentWorkspace> {
        let now = now_ms();
        let folders = self.resolve_folders(input.workspace_file.as_deref(), &input.folders)?;
        let settings = input.settings.unwrap_or_else(|| {
            self.active
                .as_ref()
                .map(|workspace| workspace.settings.clone())
                .unwrap_or_else(|| serde_json::json!({}))
        });
        let created_at = self
            .active
            .as_ref()
            .map(|workspace| workspace.created_at)
            .unwrap_or(now);
        let workspace = self.to_workspace(input.workspace_file, folders, settings, created_at, now);
        self.active = Some(workspace.clone());
        self.apply_access();
        self.persist_active(&workspace)?;
        Ok(workspace)
    }

    pub fn open_workspace_file(&mut self, file_path: &str) -> AppResult<AgentWorkspace> {
        let resolved = security::canonicalize_existing(file_path)
            .unwrap_or_else(|_| file_path.replace('\\', "/"));
        let text = fs::read_to_string(&resolved)
            .map_err(|_| AppError::validation("Unable to read workspace file"))?;
        let document: Value = serde_json::from_str(&text)
            .map_err(|_| AppError::validation("Unable to read workspace file"))?;
        let folders_json = document
            .get("folders")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut folders = Vec::new();
        for (index, folder) in folders_json.iter().enumerate() {
            let path = folder
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let parent = Path::new(&resolved)
                .parent()
                .map(|path| path.to_string_lossy().into_owned());
            let resolved_path = if Path::new(path).is_absolute() {
                path.to_string()
            } else if let Some(parent) = parent {
                security::join_normalized(&parent.replace('\\', "/"), path)
            } else {
                path.to_string()
            };
            let exists = Path::new(&resolved_path).is_dir();
            if exists {
                let _ = self.access.authorize_root(&resolved_path);
            }
            folders.push(SyncFolder {
                path: path.to_string(),
                resolved_path: Some(resolved_path),
                name: folder
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                role: Some(if index == 0 {
                    "main".into()
                } else {
                    "reference".into()
                }),
                readonly: Some(false),
            });
        }
        self.sync(SyncInput {
            workspace_file: Some(resolved),
            folders,
            settings: document.get("settings").cloned(),
        })
    }

    pub fn save(&mut self, input: SyncInput) -> AppResult<AgentWorkspace> {
        let dest = input.workspace_file.clone();
        let workspace = self.sync(input)?;
        if let Some(path) = dest {
            if path.ends_with(".code-workspace") {
                let payload = serde_json::json!({
                    "folders": workspace.folders.iter().map(|folder| {
                        serde_json::json!({ "path": folder.resolved_path, "name": folder.name })
                    }).collect::<Vec<_>>(),
                    "settings": workspace.settings
                });
                let bytes = serde_json::to_vec_pretty(&payload)
                    .map_err(|error| AppError::fs(error.to_string()))?;
                crate::persist::atomic_write(Path::new(&path), &bytes)?;
            }
        }
        Ok(workspace)
    }

    pub fn search(
        &self,
        query: &str,
        scope: Option<&str>,
        folder_id: Option<&str>,
    ) -> AppResult<Vec<Value>> {
        let Some(active) = &self.active else {
            return Ok(Vec::new());
        };
        self.searcher.search(
            &self.access,
            query,
            &active.folders,
            scope.unwrap_or("workspace"),
            folder_id,
        )
    }

    pub fn open_terminal(&self, directory: &str) -> AppResult<()> {
        let real = self.access.assert_allowed(directory, true)?;
        super::terminal::open_directory(&real)
    }

    pub fn relocate_folder(
        &mut self,
        folder_id: &str,
        next_path: &str,
    ) -> AppResult<AgentWorkspace> {
        let Some(active) = self.active.clone() else {
            return Err(AppError::validation("No active workspace"));
        };
        let resolved = self.access.authorize_root(next_path)?;
        let folders = active
            .folders
            .into_iter()
            .map(|folder| {
                if folder.id == folder_id {
                    SyncFolder {
                        path: resolved.clone(),
                        resolved_path: Some(resolved.clone()),
                        name: Some(security::display_name(&resolved)),
                        role: Some(folder.role),
                        readonly: Some(folder.readonly),
                    }
                } else {
                    SyncFolder {
                        path: folder.path,
                        resolved_path: Some(folder.resolved_path),
                        name: Some(folder.name),
                        role: Some(folder.role),
                        readonly: Some(folder.readonly),
                    }
                }
            })
            .collect();
        self.sync(SyncInput {
            workspace_file: active.workspace_file,
            folders,
            settings: Some(active.settings),
        })
    }

    fn hydrate(&self, record: PersistedActive) -> AppResult<AgentWorkspace> {
        let folders: Vec<SyncFolder> = record
            .folders
            .into_iter()
            .map(|folder| SyncFolder {
                path: folder.path,
                resolved_path: Some(folder.resolved_path),
                name: folder.name,
                role: Some(folder.role),
                readonly: Some(folder.readonly),
            })
            .collect();
        let resolved = self.resolve_folders(record.workspace_file.as_deref(), &folders)?;
        Ok(self.to_workspace(
            record.workspace_file,
            resolved,
            record.settings,
            record.created_at,
            record.updated_at,
        ))
    }

    fn resolve_folders(
        &self,
        _workspace_file: Option<&str>,
        folders: &[SyncFolder],
    ) -> AppResult<Vec<WorkspaceFolder>> {
        let mut unique: Vec<WorkspaceFolder> = Vec::new();
        for (index, folder) in folders.iter().enumerate() {
            let resolved_path = folder
                .resolved_path
                .clone()
                .unwrap_or_else(|| folder.path.replace('\\', "/"));
            let exists = Path::new(&resolved_path).is_dir();
            let canonical = if exists {
                security::canonicalize_existing(&resolved_path).unwrap_or(resolved_path.clone())
            } else {
                resolved_path.clone()
            };
            let item = WorkspaceFolder {
                id: security::identity_key(&canonical),
                name: folder
                    .name
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| security::display_name(&canonical)),
                path: folder.path.clone(),
                resolved_path: canonical,
                role: folder.role.clone().unwrap_or_else(|| {
                    if index == 0 {
                        "main".into()
                    } else {
                        "reference".into()
                    }
                }),
                readonly: folder.readonly.unwrap_or(false),
                exists,
            };
            if let Some(existing) = unique.iter_mut().find(|candidate| candidate.id == item.id) {
                existing.readonly |= item.readonly;
                if item.role == "main" {
                    existing.role = "main".into();
                }
            } else {
                unique.push(item);
            }
        }
        if let Some(main) = unique.iter().position(|folder| folder.role == "main") {
            for (index, folder) in unique.iter_mut().enumerate() {
                if index != main && folder.role == "main" {
                    folder.role = "reference".into();
                }
            }
        } else if let Some(first) = unique.first_mut() {
            first.role = "main".into();
        }
        Ok(unique)
    }

    fn to_workspace(
        &self,
        workspace_file: Option<String>,
        folders: Vec<WorkspaceFolder>,
        settings: Value,
        created_at: i64,
        updated_at: i64,
    ) -> AgentWorkspace {
        let id = workspace_file.clone().unwrap_or_else(|| {
            folders
                .first()
                .map(|folder| folder.id.clone())
                .unwrap_or_else(|| "workspace".into())
        });
        let name = folders
            .first()
            .map(|folder| folder.name.clone())
            .unwrap_or_else(|| "Workspace".into());
        AgentWorkspace {
            id,
            name,
            workspace_file,
            folders,
            settings,
            created_at,
            updated_at,
        }
    }

    fn apply_access(&self) {
        let grants = self
            .active
            .as_ref()
            .map(|workspace| {
                workspace
                    .folders
                    .iter()
                    .map(|folder| FolderGrant {
                        resolved_path: folder.resolved_path.clone(),
                        readonly: folder.readonly,
                        exists: folder.exists,
                    })
                    .collect()
            })
            .unwrap_or_default();
        self.access.set_workspace_folders(grants);
        let roots: Vec<String> = self
            .active
            .as_ref()
            .map(|workspace| {
                workspace
                    .folders
                    .iter()
                    .filter(|folder| folder.exists)
                    .map(|folder| folder.resolved_path.clone())
                    .collect()
            })
            .unwrap_or_default();
        self.watcher.sync(&roots);
    }

    fn persist_active(&self, workspace: &AgentWorkspace) -> AppResult<()> {
        let mut record: WorkspaceStateRecord = persist::read_json(&self.store_path)?;
        record.active = Some(PersistedActive {
            workspace_file: workspace.workspace_file.clone(),
            folders: workspace
                .folders
                .iter()
                .map(|folder| PersistedFolder {
                    path: folder.path.clone(),
                    resolved_path: folder.resolved_path.clone(),
                    name: Some(folder.name.clone()),
                    role: folder.role.clone(),
                    readonly: folder.readonly,
                })
                .collect(),
            settings: workspace.settings.clone(),
            created_at: workspace.created_at,
            updated_at: workspace.updated_at,
        });
        record.session_bindings = self.bindings.clone();
        let recent = RecentWorkspace {
            id: workspace.id.clone(),
            name: workspace.name.clone(),
            workspace_file: workspace.workspace_file.clone(),
            folder_paths: workspace
                .folders
                .iter()
                .map(|folder| folder.resolved_path.clone())
                .collect(),
            last_opened_at: workspace.updated_at,
        };
        record.recent.retain(|item| item.id != recent.id);
        record.recent.insert(0, recent);
        record.recent.truncate(MAX_RECENT);
        persist::write_json(&self.store_path, &record)
    }

    fn persist_bindings(&self) -> AppResult<()> {
        let mut record: WorkspaceStateRecord = persist::read_json(&self.store_path)?;
        record.session_bindings = self.bindings.clone();
        persist::write_json(&self.store_path, &record)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}
