//! Git worktree list/create/remove. Creates live under `{repo}-worktrees/`.

use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::git::runner::{git_exec, is_not_a_git_repository, GitTimeout};
use crate::security::AccessService;

#[derive(Clone)]
pub struct WorktreeService {
    access: AccessService,
}

impl WorktreeService {
    pub fn new(access: AccessService) -> Self {
        Self { access }
    }

    pub async fn list(&self, cwd: &str) -> AppResult<Vec<Value>> {
        self.access.assert_allowed(cwd, true)?;
        let output =
            match git_exec(cwd, &["worktree", "list", "--porcelain"], GitTimeout::Short).await {
                Ok(value) => value,
                Err(error) if is_not_a_git_repository(&error) => return Ok(Vec::new()),
                Err(error) => return Err(error),
            };
        let mut worktrees = Vec::new();
        let mut current_path: Option<String> = None;
        let mut current_branch: Option<String> = None;
        let mut prunable = false;
        let flush = |path: &mut Option<String>,
                     branch: &mut Option<String>,
                     prunable: &mut bool,
                     worktrees: &mut Vec<Value>| {
            if let Some(path) = path.take() {
                if !*prunable && Path::new(&path).exists() {
                    let is_main = worktrees.is_empty();
                    worktrees.push(json!({
                        "path": path,
                        "branch": branch.take(),
                        "isMain": is_main
                    }));
                }
            }
            *prunable = false;
            *branch = None;
        };
        for line in output.lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                flush(
                    &mut current_path,
                    &mut current_branch,
                    &mut prunable,
                    &mut worktrees,
                );
                current_path = Some(rest.trim().replace('\\', "/"));
            } else if let Some(rest) = line.strip_prefix("branch ") {
                current_branch = Some(rest.trim().trim_start_matches("refs/heads/").to_string());
            } else if line.starts_with("prunable") {
                prunable = true;
            } else if line.trim().is_empty() {
                flush(
                    &mut current_path,
                    &mut current_branch,
                    &mut prunable,
                    &mut worktrees,
                );
            }
        }
        flush(
            &mut current_path,
            &mut current_branch,
            &mut prunable,
            &mut worktrees,
        );
        Ok(worktrees)
    }

    pub async fn create(&self, cwd: &str, branch: &str) -> AppResult<Value> {
        self.access.assert_allowed(cwd, true)?;
        let trimmed = branch.trim();
        if trimmed.is_empty() {
            return Err(AppError::git("Branch name is required"));
        }
        let dir_name = sanitize_branch(trimmed);
        if dir_name.is_empty() {
            return Err(AppError::git(format!("Invalid branch name: {branch}")));
        }
        let repo_root = git_exec(
            cwd,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            GitTimeout::Short,
        )
        .await?;
        let repo_root = Path::new(repo_root.trim())
            .parent()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .ok_or_else(|| AppError::git("Unable to resolve repository root"))?;
        let base_dir = format!("{repo_root}-worktrees");
        let worktree_path = format!("{base_dir}/{dir_name}");
        if Path::new(&worktree_path).exists() {
            return Err(AppError::git(format!(
                "Directory already exists: {worktree_path}"
            )));
        }
        fs::create_dir_all(&base_dir)?;
        let exists = git_exec(
            &repo_root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{trimmed}"),
            ],
            GitTimeout::Short,
        )
        .await
        .is_ok();
        if exists {
            git_exec(
                &repo_root,
                &["worktree", "add", "--", &worktree_path, trimmed],
                GitTimeout::Long,
            )
            .await?;
        } else {
            git_exec(
                &repo_root,
                &["worktree", "add", "-b", trimmed, "--", &worktree_path],
                GitTimeout::Long,
            )
            .await?;
        }
        self.access.authorize_root(&worktree_path)?;
        Ok(json!({ "path": worktree_path, "branch": trimmed }))
    }

    pub async fn remove(&self, cwd: &str, worktree_path: &str, force: bool) -> AppResult<()> {
        let listed = self.list(cwd).await?;
        let target = listed.iter().find(|item| {
            item.get("path").and_then(Value::as_str)
                == Some(worktree_path.replace('\\', "/").as_str())
                || item.get("path").and_then(Value::as_str) == Some(worktree_path)
        });
        let Some(target) = target else {
            return Err(AppError::git(format!(
                "Not a worktree of this repository: {worktree_path}"
            )));
        };
        if target.get("isMain").and_then(Value::as_bool) == Some(true) {
            return Err(AppError::git("Cannot remove the main worktree"));
        }
        let path = target
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or(worktree_path);
        if force {
            git_exec(
                cwd,
                &["worktree", "remove", "--force", path],
                GitTimeout::Long,
            )
            .await?;
        } else {
            git_exec(cwd, &["worktree", "remove", path], GitTimeout::Long).await?;
        }
        Ok(())
    }
}

fn sanitize_branch(branch: &str) -> String {
    let replaced: String = branch
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | ' ' => '-',
            _ => ch,
        })
        .collect();
    replaced.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::sanitize_branch;

    #[test]
    fn sanitizes_branch_for_directory() {
        assert_eq!(sanitize_branch("agent/review"), "agent-review");
        assert_eq!(sanitize_branch("***"), "");
    }
}
