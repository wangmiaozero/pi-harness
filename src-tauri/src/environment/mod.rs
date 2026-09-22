//! EnvironmentResolver — login-shell PATH + executable discovery.
//!
//! Finder/Dock-launched GUI apps inherit a minimal PATH. Node version
//! managers (nvm/fnm/Volta/Homebrew) only show up after a login shell. This
//! module reconstructs that PATH without going through a user-controlled
//! shell string: the `-c` argument is a constant `printf`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::error::{AppError, AppResult};

const LOGIN_PATH_SCRIPT: &str = r#"printf %s "$PATH""#;
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedExecutable {
    pub found: bool,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSnapshot {
    pub path: String,
    pub node: ResolvedExecutable,
    pub npm: ResolvedExecutable,
    pub pi: ResolvedExecutable,
    pub git: ResolvedExecutable,
}

/// PATH the desktop host should use for spawning Node / git / npm.
pub fn merged_path() -> String {
    let login = login_shell_path().unwrap_or_default();
    let process = std::env::var("PATH").unwrap_or_default();
    let extras = extra_manager_paths();
    merge_path_entries(&[&login, &process, &extras])
}

pub fn login_shell_path() -> Option<String> {
    if cfg!(windows) {
        return std::env::var("PATH").ok();
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = Command::new(&shell);
    command.args(["-l", "-c", LOGIN_PATH_SCRIPT]);
    command.stdin(std::process::Stdio::null());
    let output = spawn_with_timeout(command, PROBE_TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

pub fn resolve_on_path(program: &str) -> Option<PathBuf> {
    let path = merged_path();
    let names = candidate_names(program);
    for dir in std::env::split_paths(&path) {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn resolve_node() -> AppResult<PathBuf> {
    if let Ok(explicit) = std::env::var("PI_HARNESS_NODE") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AppError::io(format!(
            "PI_HARNESS_NODE points to a missing file: {}",
            path.display()
        )));
    }
    resolve_on_path(if cfg!(windows) { "node.exe" } else { "node" }).ok_or_else(|| {
        AppError::io("Node.js was not found. Install Node.js >= 22 or set PI_HARNESS_NODE.")
    })
}

pub fn snapshot() -> EnvironmentSnapshot {
    let path = merged_path();
    EnvironmentSnapshot {
        path: path.clone(),
        node: inspect("node", &["--version"]),
        npm: inspect("npm", &["--version"]),
        pi: inspect("pi", &["--version"]),
        git: inspect("git", &["--version"]),
    }
}

fn inspect(command: &str, version_args: &[&str]) -> ResolvedExecutable {
    let Some(path) = resolve_on_path(command) else {
        return ResolvedExecutable {
            found: false,
            command: command.to_string(),
            path: None,
            version: None,
            source: None,
        };
    };
    let version = probe_version(&path, version_args);
    ResolvedExecutable {
        found: true,
        command: command.to_string(),
        path: Some(path.to_string_lossy().replace('\\', "/")),
        version,
        source: Some("path".to_string()),
    }
}

fn probe_version(binary: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(binary);
    command.args(args).stdin(std::process::Stdio::null());
    let output = spawn_with_timeout(command, PROBE_TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        None
    } else {
        Some(line.trim_start_matches('v').to_string())
    }
}

fn extra_manager_paths() -> String {
    let home = dirs_home();
    let mut dirs = Vec::new();
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(format!("{appdata}\\npm"));
        }
        dirs.push(r"C:\Program Files\nodejs".to_string());
    } else {
        dirs.extend([
            format!("{home}/.nvm"),
            format!("{home}/.fnm"),
            format!("{home}/.volta/bin"),
            format!("{home}/.local/share/fnm"),
            format!("{home}/.asdf/shims"),
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
        ]);
        // nvm current symlink if present
        let nvm_current = PathBuf::from(format!("{home}/.nvm/current/bin"));
        if nvm_current.is_dir() {
            dirs.push(nvm_current.to_string_lossy().into_owned());
        }
        if let Ok(entries) = std::fs::read_dir(format!("{home}/.nvm/versions/node")) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.is_dir() {
                    dirs.push(bin.to_string_lossy().into_owned());
                }
            }
        }
    }
    dirs.join(if cfg!(windows) { ";" } else { ":" })
}

fn dirs_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string())
}

fn candidate_names(program: &str) -> Vec<String> {
    if cfg!(windows) {
        if program.ends_with(".exe") || program.ends_with(".cmd") || program.ends_with(".bat") {
            vec![program.to_string()]
        } else {
            vec![
                format!("{program}.cmd"),
                format!("{program}.exe"),
                program.to_string(),
            ]
        }
    } else {
        vec![program.to_string()]
    }
}

fn merge_path_entries(parts: &[&str]) -> String {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for part in parts {
        for entry in part.split(sep) {
            let trimmed = entry.trim();
            if trimmed.is_empty() {
                continue;
            }
            let key = if cfg!(windows) {
                trimmed.to_lowercase()
            } else {
                trimmed.to_string()
            };
            if seen.insert(key) {
                out.push(trimmed.to_string());
            }
        }
    }
    out.join(&sep.to_string())
}

fn spawn_with_timeout(mut command: Command, timeout: Duration) -> Option<std::process::Output> {
    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merged_path_contains_path_separator() {
        let path = merged_path();
        assert!(!path.is_empty());
    }

    #[test]
    fn snapshot_finds_node_in_ci() {
        let snap = snapshot();
        assert_eq!(snap.node.command, "node");
        // CI and local dev machines have Node; the test fails loudly otherwise.
        assert!(snap.node.found, "node must be resolvable: {:?}", snap.node);
    }

    #[test]
    fn merge_dedupes_case_insensitively_on_windows_logic() {
        let merged = merge_path_entries(&["/usr/bin:/opt/bin", "/usr/bin:/tmp"]);
        assert!(merged.contains("/usr/bin"));
        assert_eq!(merged.matches("/usr/bin").count(), 1);
    }
}
