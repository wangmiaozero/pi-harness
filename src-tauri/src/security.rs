//! Authorized-root path security. All workspace/file/git paths must pass here.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::persist;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthorizedRootsState {
    #[serde(default)]
    pub roots: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct FolderGrant {
    pub resolved_path: String,
    pub readonly: bool,
    pub exists: bool,
}

#[derive(Clone)]
pub struct AccessService {
    inner: Arc<Mutex<AccessInner>>,
    store_path: PathBuf,
}

struct AccessInner {
    additional: HashSet<String>,
    persisted: HashSet<String>,
    folders: Vec<FolderGrant>,
    active_root: Option<String>,
    cache: Option<(HashSet<String>, Instant)>,
    disk_mtime: Option<SystemTime>,
}

impl AccessService {
    pub fn load(data_dir: &Path) -> AppResult<Self> {
        let store_path = data_dir.join("authorized-roots.json");
        let stored: AuthorizedRootsState = persist::read_json(&store_path)?;
        Ok(Self {
            inner: Arc::new(Mutex::new(AccessInner {
                additional: HashSet::new(),
                persisted: stored
                    .roots
                    .into_iter()
                    .filter(|root| !root.is_empty())
                    .collect(),
                folders: Vec::new(),
                active_root: None,
                cache: None,
                disk_mtime: None,
            })),
            store_path,
        })
    }

    pub fn allow_root(&self, root: &str) {
        if root.is_empty() {
            return;
        }
        let normalized = normalize_lexical(root);
        let mut inner = self.lock();
        inner.additional.insert(normalized);
        inner.cache = None;
    }

    pub fn set_workspace_folders(&self, folders: Vec<FolderGrant>) {
        let mut inner = self.lock();
        for folder in &folders {
            if folder.exists {
                inner
                    .additional
                    .insert(normalize_lexical(&folder.resolved_path));
            }
        }
        inner.folders = folders;
        inner.cache = None;
    }

    pub fn folders(&self) -> Vec<FolderGrant> {
        self.lock().folders.clone()
    }

    pub fn authorize_root(&self, root: &str) -> AppResult<String> {
        let resolved = assert_directory(root)?;
        self.allow_root(&resolved);
        {
            let mut inner = self.lock();
            inner.active_root = Some(resolved.clone());
            inner.persisted.insert(resolved.clone());
            inner.cache = None;
        }
        self.persist()?;
        Ok(resolved)
    }

    pub fn restore_root(&self, root: &str) -> AppResult<String> {
        let allowed = self.assert_allowed(root, true)?;
        let resolved = assert_directory(&allowed)?;
        self.lock().active_root = Some(resolved.clone());
        Ok(resolved)
    }

    pub fn assert_allowed(&self, target: &str, must_exist: bool) -> AppResult<String> {
        if target.trim().is_empty() {
            return Err(AppError::invalid_path("Path is required"));
        }
        let roots = self.allowed_roots();
        let lexical = normalize_lexical(target);
        if is_within_any(&lexical, &roots) && !must_exist {
            return Ok(target.to_string());
        }
        let real_roots = real_roots(&roots);
        if must_exist {
            let real_target = canonicalize_existing(target)?;
            if !is_within_any(&real_target, &real_roots) {
                return Err(AppError::invalid_path(
                    "Path is outside the allowed workspace roots",
                ));
            }
            return Ok(real_target);
        }
        if is_within_any(&lexical, &roots) || is_within_any(&lexical, &real_roots) {
            return Ok(target.to_string());
        }
        Err(AppError::invalid_path(
            "Path is outside the allowed workspace roots",
        ))
    }

    pub fn assert_writable(&self, target: &str, must_exist: bool) -> AppResult<String> {
        let allowed = self.assert_allowed(target, must_exist)?;
        let folders = self.folders();
        if folders.is_empty() {
            return Ok(allowed);
        }
        if is_writable_in_folders(&allowed, &folders) || is_writable_in_folders(target, &folders) {
            return Ok(allowed);
        }
        Err(AppError::invalid_path(
            "This path is outside the projects attached to the current session or is read-only.",
        ))
    }

    pub fn assert_writable_for_git(&self, target: &str, must_exist: bool) -> AppResult<String> {
        let allowed = self.assert_allowed(target, must_exist)?;
        let folders = self.folders();
        if folders.is_empty()
            || is_writable_in_folders(&allowed, &folders)
            || is_writable_in_folders(target, &folders)
        {
            return Ok(allowed);
        }
        // Git page can operate on any authorized project root.
        Ok(allowed)
    }

    fn allowed_roots(&self) -> HashSet<String> {
        let store_path = self.store_path.clone();
        let mut inner = self.lock();
        reload_persisted_if_changed(&store_path, &mut inner);
        if let Some((roots, expires)) = &inner.cache {
            if Instant::now() < *expires {
                return roots.clone();
            }
        }
        let mut roots = HashSet::new();
        roots.extend(inner.additional.iter().cloned());
        roots.extend(inner.persisted.iter().cloned());
        inner.cache = Some((roots.clone(), Instant::now() + Duration::from_secs(1)));
        roots
    }

    fn persist(&self) -> AppResult<()> {
        let roots = {
            let inner = self.lock();
            inner.persisted.iter().cloned().collect::<Vec<_>>()
        };
        persist::write_json(&self.store_path, &AuthorizedRootsState { roots })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, AccessInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn reload_persisted_if_changed(store_path: &std::path::Path, inner: &mut AccessInner) {
    let mtime = fs::metadata(store_path)
        .ok()
        .and_then(|meta| meta.modified().ok());
    if mtime == inner.disk_mtime {
        return;
    }
    inner.disk_mtime = mtime;
    if let Ok(stored) = persist::read_json::<AuthorizedRootsState>(store_path) {
        inner.persisted = stored
            .roots
            .into_iter()
            .filter(|root| !root.is_empty())
            .collect();
        inner.cache = None;
    }
}

pub fn canonicalize_existing(path: &str) -> AppResult<String> {
    let canonical = fs::canonicalize(path)
        .map_err(|_| AppError::invalid_path("Path does not exist or cannot be resolved"))?;
    Ok(strip_verbatim(canonical)
        .to_string_lossy()
        .replace('\\', "/"))
}

pub fn assert_directory(path: &str) -> AppResult<String> {
    let canonical = canonicalize_existing(path)?;
    let meta = fs::metadata(&canonical)?;
    if !meta.is_dir() {
        return Err(AppError::validation("Not a directory"));
    }
    Ok(canonical)
}

pub fn normalize_lexical(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced.trim_end_matches('/');
    if trimmed.is_empty() {
        replaced
    } else if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

pub fn is_path_within(target: &str, root: &str) -> bool {
    let target_n = normalize_lexical(target);
    let root_n = normalize_lexical(root);
    if target_n == root_n {
        return true;
    }
    let prefix = if root_n.ends_with('/') {
        root_n
    } else {
        format!("{root_n}/")
    };
    target_n.starts_with(&prefix)
}

pub fn is_within_any(target: &str, roots: &HashSet<String>) -> bool {
    roots.iter().any(|root| is_path_within(target, root))
}

fn real_roots(roots: &HashSet<String>) -> HashSet<String> {
    roots
        .iter()
        .filter_map(|root| canonicalize_existing(root).ok())
        .collect()
}

fn is_writable_in_folders(target: &str, folders: &[FolderGrant]) -> bool {
    folders.iter().any(|folder| {
        folder.exists && !folder.readonly && is_path_within(target, &folder.resolved_path)
    })
}

pub fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        if let Some(unc) = rest.strip_prefix(r"UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        return PathBuf::from(rest);
    }
    path
}

pub fn identity_key(path: &str) -> String {
    normalize_lexical(path)
}

pub fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}

pub fn join_normalized(dir: &str, name: &str) -> String {
    let mut base = dir.replace('\\', "/").trim_end_matches('/').to_string();
    base.push('/');
    base.push_str(name);
    base
}

pub fn relative_to(root: &str, target: &str) -> String {
    let root_n = normalize_lexical(root);
    let target_n = normalize_lexical(target);
    if let Some(rest) = target_n.strip_prefix(&format!("{root_n}/")) {
        rest.to_string()
    } else if target_n == root_n {
        String::new()
    } else {
        target.replace('\\', "/")
    }
}

pub fn has_parent_escape(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn lexical_containment_rejects_sibling_and_escape() {
        let roots = HashSet::from(["/Users/wangmiao/code/pi-harness".into()]);
        assert!(is_within_any(
            "/Users/wangmiao/code/pi-harness/src/App.vue",
            &roots
        ));
        assert!(!is_within_any("/etc/passwd", &roots));
        assert!(!is_within_any(
            "/Users/wangmiao/code/pi-harness-other/src",
            &roots
        ));
    }

    #[test]
    fn authorize_root_persists_and_blocks_outside() {
        let dir = std::env::temp_dir().join(format!("pi-access-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let access = AccessService::load(&dir).unwrap();
        let granted = access.authorize_root(dir.to_str().unwrap()).unwrap();
        let inside = dir.join("readme.md");
        fs::write(&inside, b"hi").unwrap();
        assert!(access
            .assert_allowed(inside.to_str().unwrap(), true)
            .is_ok());
        assert!(access.assert_allowed("/etc/passwd", true).is_err());
        let _ = granted;
        let _ = fs::remove_dir_all(dir);
    }
}
