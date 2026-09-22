//! Workspace search matching Electron ignore rules.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};

use crate::error::AppResult;
use crate::security::{self, AccessService};
use crate::workspace::types::WorkspaceFolder;

const MAX_MATCHES: usize = 200;
const MAX_SCANNED: usize = 5_000;
const MAX_CONTENT: u64 = 256 * 1024;

const IGNORED: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    "target",
    "vendor",
    ".output",
    ".turbo",
    ".cache",
    "out",
    "__pycache__",
    ".venv",
    "venv",
    ".pi",
];

pub struct SearchEngine {
    generation: AtomicU64,
}

impl Default for SearchEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SearchEngine {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
        }
    }

    pub fn search(
        &self,
        access: &AccessService,
        query: &str,
        folders: &[WorkspaceFolder],
        scope: &str,
        folder_id: Option<&str>,
    ) -> AppResult<Vec<Value>> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let token = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let targets = select_folders(folders, scope, folder_id);
        let mut hits = Vec::new();
        let mut scanned = 0usize;
        for folder in targets {
            if !folder.exists {
                continue;
            }
            let root = access.assert_allowed(&folder.resolved_path, true)?;
            walk(
                &self.generation,
                token,
                Path::new(&root),
                folder,
                &query,
                &mut hits,
                &mut scanned,
            )?;
            if hits.len() >= MAX_MATCHES || scanned >= MAX_SCANNED {
                break;
            }
        }
        hits.truncate(MAX_MATCHES);
        Ok(hits)
    }
}

fn select_folders<'a>(
    folders: &'a [WorkspaceFolder],
    scope: &str,
    folder_id: Option<&str>,
) -> Vec<&'a WorkspaceFolder> {
    match scope {
        "main" => folders
            .iter()
            .find(|folder| folder.role == "main")
            .or_else(|| folders.first())
            .into_iter()
            .collect(),
        "folder" => folders
            .iter()
            .filter(|folder| Some(folder.id.as_str()) == folder_id)
            .collect(),
        _ => folders.iter().collect(),
    }
}

fn walk(
    generation: &AtomicU64,
    token: u64,
    directory: &Path,
    folder: &WorkspaceFolder,
    query: &str,
    hits: &mut Vec<Value>,
    scanned: &mut usize,
) -> AppResult<()> {
    if generation.load(Ordering::SeqCst) != token {
        return Ok(());
    }
    let entries = match fs::read_dir(directory) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        if generation.load(Ordering::SeqCst) != token
            || hits.len() >= MAX_MATCHES
            || *scanned >= MAX_SCANNED
        {
            return Ok(());
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if IGNORED.contains(&name.as_ref()) {
            continue;
        }
        let full = entry.path();
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        if is_dir {
            walk(generation, token, &full, folder, query, hits, scanned)?;
            continue;
        }
        *scanned += 1;
        let relative = security::relative_to(
            &folder.resolved_path,
            &full.to_string_lossy().replace('\\', "/"),
        );
        if relative.to_lowercase().contains(query) || name.to_lowercase().contains(query) {
            hits.push(json!({
                "workspaceFolderId": folder.id,
                "workspaceFolderName": folder.name,
                "relativePath": relative,
                "absolutePath": full.to_string_lossy().replace('\\', "/")
            }));
            continue;
        }
        if let Some((line, preview)) = match_content(&full, query) {
            hits.push(json!({
                "workspaceFolderId": folder.id,
                "workspaceFolderName": folder.name,
                "relativePath": relative,
                "absolutePath": full.to_string_lossy().replace('\\', "/"),
                "line": line,
                "preview": preview
            }));
        }
    }
    Ok(())
}

fn match_content(path: &Path, query: &str) -> Option<(usize, String)> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_CONTENT {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    if text.contains('\0') {
        return None;
    }
    text.lines().enumerate().find_map(|(index, line)| {
        line.to_lowercase()
            .contains(query)
            .then(|| (index + 1, line.chars().take(240).collect()))
    })
}
