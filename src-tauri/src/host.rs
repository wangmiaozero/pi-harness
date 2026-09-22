//! Desktop host: authorized roots + workspace/files/git/worktree services.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::AppHandle;

use crate::error::AppResult;
use crate::files::FileService;
use crate::git::GitService;
use crate::security::AccessService;
use crate::workspace::{WatcherHub, WorkspaceService};
use crate::worktree::WorktreeService;

pub struct DesktopHost {
    pub access: AccessService,
    pub workspace: Mutex<WorkspaceService>,
    pub files: FileService,
    pub git: GitService,
    pub worktrees: WorktreeService,
}

impl DesktopHost {
    pub fn new(data_dir: PathBuf, app: AppHandle) -> AppResult<Self> {
        let access = AccessService::load(&data_dir)?;
        let watcher = WatcherHub::new(app);
        let workspace = WorkspaceService::load(&data_dir, access.clone(), watcher)?;
        Ok(Self {
            files: FileService::new(access.clone()),
            git: GitService::new(access.clone()),
            worktrees: WorktreeService::new(access.clone()),
            workspace: Mutex::new(workspace),
            access,
        })
    }

    pub fn workspace(&self) -> std::sync::MutexGuard<'_, WorkspaceService> {
        self.workspace
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
