//! Git CLI process runner: argv only, timeouts, sanitised errors.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, AppResult};

const SHORT_TIMEOUT: Duration = Duration::from_secs(10);
const LONG_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_STDOUT: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy)]
pub enum GitTimeout {
    Short,
    Long,
}

impl GitTimeout {
    fn duration(self) -> Duration {
        match self {
            GitTimeout::Short => SHORT_TIMEOUT,
            GitTimeout::Long => LONG_TIMEOUT,
        }
    }
}

pub async fn git_exec(cwd: &str, args: &[&str], timeout: GitTimeout) -> AppResult<String> {
    git_exec_with_limit(cwd, args, timeout, MAX_STDOUT).await
}

pub async fn git_exec_with_limit(
    cwd: &str,
    args: &[&str],
    timeout: GitTimeout,
    max_stdout: usize,
) -> AppResult<String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| AppError::git(format!("Git is not available: {error}")))?;
    let output = tokio::time::timeout(timeout.duration(), child.wait_with_output())
        .await
        .map_err(|_| AppError::git("The Git operation timed out. Check the network and retry."))?
        .map_err(|error| AppError::git(format!("Git process failed: {error}")))?;

    let stdout = decode_output(&output.stdout);
    let stderr = redact(&decode_output(&output.stderr));
    if stdout.len() > max_stdout {
        return Err(AppError::git("Git output exceeded the size limit."));
    }
    if output.status.success() {
        return Ok(stdout);
    }
    Err(map_git_failure(&stdout, &stderr, output.status.code()))
}

pub fn is_not_a_git_repository(error: &AppError) -> bool {
    error
        .parts()
        .1
        .to_lowercase()
        .contains("not a git repository")
        || error
            .parts()
            .1
            .contains("The selected folder is not a Git repository")
}

pub fn is_empty_history(error: &AppError) -> bool {
    let message = error.parts().1.to_lowercase();
    message.contains("does not have any commits") || message.contains("revision could not be found")
}

fn map_git_failure(stdout: &str, stderr: &str, code: Option<i32>) -> AppError {
    let output = format!("{stderr}\n{stdout}");
    let lower = output.to_lowercase();
    let message = if lower.contains("not a git repository") {
        "The selected folder is not a Git repository."
    } else if lower.contains("does not have any commits") || lower.contains("bad default revision")
    {
        "This repository does not have any commits yet."
    } else if lower.contains("unknown revision")
        || lower.contains("bad revision")
        || lower.contains("ambiguous argument")
    {
        "The selected Git revision could not be found."
    } else if lower.contains("permission denied (publickey)")
        || lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("access denied")
        || lower.contains("repository not found")
    {
        "Git authentication failed. Check the remote credentials and try again."
    } else if lower.contains("could not resolve host")
        || lower.contains("failed to connect")
        || lower.contains("network is unreachable")
        || lower.contains("could not read from remote repository")
    {
        "The remote repository could not be reached. Check the network and remote access."
    } else if lower.contains("no tracking information")
        || lower.contains("has no upstream branch")
        || lower.contains("does not point to a branch")
    {
        "No upstream branch is configured. Set an upstream branch before pulling."
    } else if lower.contains("would be overwritten")
        || lower.contains("commit your changes or stash")
        || lower.contains("uncommitted changes")
    {
        "Local changes prevent this operation. Commit or stash them, then retry."
    } else if lower.contains("not possible to fast-forward")
        || lower.contains("non-fast-forward")
        || lower.contains("diverging branches")
    {
        "The branch cannot be fast-forwarded. Review the history, then merge or rebase."
    } else if lower.contains("conflict") || lower.contains("automatic merge failed") {
        "Git found conflicts. Resolve them before retrying."
    } else {
        "Git operation failed. Please retry."
    };
    let _ = code;
    AppError::git(message)
}

fn decode_output(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => String::from_utf8_lossy(bytes).into_owned(),
    }
}

pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    if let Some(start) = out.find("https://") {
        if let Some(at) = out[start..].find('@') {
            let slice = &out[start..start + at];
            if slice.contains(':') {
                out.replace_range(start..start + at, "https://***");
            }
        }
    }
    if out.to_lowercase().contains("authorization") {
        out = out
            .lines()
            .filter(|line| !line.to_lowercase().contains("authorization"))
            .collect::<Vec<_>>()
            .join("\n");
    }
    out
}

pub fn assert_git_ref(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 512
        || trimmed.starts_with('-')
        || trimmed.contains('\0')
        || trimmed.contains('\n')
        || trimmed.contains('\r')
    {
        return Err(AppError::git("Invalid git reference."));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_embedded_basic_auth() {
        let raw = "fatal: could not read https://user:ghp_secret@github.com/org/repo";
        let cleaned = redact(raw);
        assert!(!cleaned.contains("ghp_secret"));
        assert!(cleaned.contains("https://***"));
    }

    #[test]
    fn rejects_option_like_refs() {
        assert!(assert_git_ref("--output=/tmp/x").is_err());
        assert!(assert_git_ref("main").is_ok());
    }
}
