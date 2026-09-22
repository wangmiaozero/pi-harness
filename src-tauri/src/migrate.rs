//! Electron → Tauri userData migration.
//!
//! Packaged Tauri shares Electron's `Pi-Harness` userData directory so dual-shell
//! rollback keeps working. First launch writes `tauri-migration.json` and a
//! file-level backup; Electron files are never deleted.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::persist;

pub const DATA_SCHEMA_VERSION: u32 = 1;
const MARKER_NAME: &str = "tauri-migration.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub source: String,
    pub target: String,
    pub schema_version: u32,
    pub shared_user_data: bool,
    pub migrated_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub conflicts: Vec<String>,
    pub errors: Vec<String>,
    pub backup_dir: Option<String>,
    pub applied_at: u64,
}

pub struct UserDataPlan {
    pub user_data: PathBuf,
    pub report: Option<MigrationReport>,
}

/// Resolve the directory Tauri should use for `PI_HARNESS_USER_DATA`.
pub fn prepare_user_data(tauri_app_data: &Path, packaged: bool) -> AppResult<UserDataPlan> {
    fs::create_dir_all(tauri_app_data).map_err(AppError::from)?;
    let electron_dir = electron_user_data_dir(tauri_app_data, packaged);
    let shared = packaged && electron_dir.is_dir() && has_legacy_payload(&electron_dir);
    let user_data = if shared {
        electron_dir.clone()
    } else {
        tauri_app_data.to_path_buf()
    };
    fs::create_dir_all(&user_data).map_err(AppError::from)?;

    let marker = user_data.join(MARKER_NAME);
    if marker.is_file() {
        return Ok(UserDataPlan {
            user_data,
            report: persist::read_json(&marker).ok(),
        });
    }

    if !shared {
        let report = MigrationReport {
            source: "fresh".into(),
            target: path_text(&user_data),
            schema_version: DATA_SCHEMA_VERSION,
            shared_user_data: false,
            migrated_files: Vec::new(),
            skipped_files: Vec::new(),
            conflicts: Vec::new(),
            errors: Vec::new(),
            backup_dir: None,
            applied_at: now_secs(),
        };
        persist::write_json(&marker, &report)?;
        return Ok(UserDataPlan {
            user_data,
            report: Some(report),
        });
    }

    let report = migrate_shared(&electron_dir)?;
    persist::write_json(&marker, &report)?;
    Ok(UserDataPlan {
        user_data,
        report: Some(report),
    })
}

fn migrate_shared(electron_dir: &Path) -> AppResult<MigrationReport> {
    let stamp = now_secs();
    let backup_dir = electron_dir.join(format!("migration-backup-{stamp}"));
    fs::create_dir_all(&backup_dir).map_err(AppError::from)?;

    let mut migrated = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();
    for name in backup_names() {
        let src = electron_dir.join(name);
        if !src.exists() {
            skipped.push(name.to_string());
            continue;
        }
        let dest = backup_dir.join(name);
        match copy_entry(&src, &dest) {
            Ok(()) => migrated.push(name.to_string()),
            Err(error) => errors.push(format!("{name}: {error}")),
        }
    }

    Ok(MigrationReport {
        source: path_text(electron_dir),
        target: path_text(electron_dir),
        schema_version: DATA_SCHEMA_VERSION,
        shared_user_data: true,
        migrated_files: migrated,
        skipped_files: skipped,
        conflicts: Vec::new(),
        errors,
        backup_dir: Some(path_text(&backup_dir)),
        applied_at: stamp,
    })
}

fn electron_user_data_dir(tauri_app_data: &Path, packaged: bool) -> PathBuf {
    let parent = tauri_app_data.parent().unwrap_or(tauri_app_data);
    let name = if packaged {
        "Pi-Harness"
    } else {
        "Pi-Harness-dev"
    };
    parent.join(name)
}

fn has_legacy_payload(dir: &Path) -> bool {
    dir.join("settings.json").is_file()
        || dir.join("workspace-state.json").is_file()
        || dir.join("authorized-roots.json").is_file()
}

fn backup_names() -> &'static [&'static str] {
    &[
        "settings.json",
        "metadata.json",
        "ui-state.json",
        "authorized-roots.json",
        "workspace-state.json",
        "secrets.bin",
        "harness-policy.json",
        "harness-checkpoints.json",
        "harness-runs.json",
        "harness-traces.json",
        "harness-artifacts.json",
        "harness-evaluations.json",
        "harness-baselines.json",
        "harness-store-settings.json",
        "harness-orchestration.json",
    ]
}

fn copy_entry(src: &Path, dest: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        copy_dir(src, dest)
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dest).map(|_| ())
    }
}

fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let to = dest.join(entry.file_name());
        copy_entry(&entry.path(), &to)?;
    }
    Ok(())
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|item| item.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("pi-harness-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn fresh_install_writes_marker() {
        let root = temp_tree("fresh");
        let tauri_dir = root.join("dev.pi-harness.app");
        let plan = prepare_user_data(&tauri_dir, true).expect("fresh");
        assert_eq!(plan.user_data, tauri_dir);
        assert!(tauri_dir.join(MARKER_NAME).is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn packaged_share_is_idempotent() {
        let root = temp_tree("share");
        let electron = root.join("Pi-Harness");
        fs::create_dir_all(&electron).unwrap();
        fs::write(electron.join("settings.json"), "{\"language\":\"en\"}").unwrap();
        let tauri_dir = root.join("dev.pi-harness.app");
        let first = prepare_user_data(&tauri_dir, true).expect("first");
        assert_eq!(first.user_data, electron);
        let marker = electron.join(MARKER_NAME);
        let first_text = fs::read_to_string(&marker).unwrap();
        let second = prepare_user_data(&tauri_dir, true).expect("second");
        assert_eq!(second.user_data, electron);
        assert_eq!(fs::read_to_string(&marker).unwrap(), first_text);
        assert!(electron.join("settings.json").is_file());
        let _ = fs::remove_dir_all(&root);
    }
}
