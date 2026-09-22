//! Git operations via system git CLI. Matches Electron `GitService` contracts.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::security::{self, AccessService};

use super::parse::{classify, parse_porcelain_v1};
use super::runner::{
    assert_git_ref, git_exec, git_exec_with_limit, is_empty_history, is_not_a_git_repository,
    GitTimeout,
};

const TEXT_PREVIEW_MAX: usize = 256 * 1024;

#[derive(Clone)]
pub struct GitService {
    access: AccessService,
}

impl GitService {
    pub fn new(access: AccessService) -> Self {
        Self { access }
    }

    pub async fn status(&self, cwd: &str) -> AppResult<Value> {
        let real_cwd = self.access.assert_allowed(cwd, true)?;
        let repository_root = match git_exec(
            &real_cwd,
            &["rev-parse", "--show-toplevel"],
            GitTimeout::Short,
        )
        .await
        {
            Ok(value) => native_path(value.trim()),
            Err(_) => {
                return Ok(json!({
                    "isGitRepository": false,
                    "repositoryRoot": null,
                    "files": [],
                    "additions": 0,
                    "deletions": 0
                }))
            }
        };
        let porcelain = git_exec(
            &repository_root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            GitTimeout::Short,
        )
        .await;
        let porcelain = match porcelain {
            Ok(value) => value,
            Err(error) if is_not_a_git_repository(&error) => {
                return Ok(json!({
                    "isGitRepository": false,
                    "repositoryRoot": null,
                    "files": [],
                    "additions": 0,
                    "deletions": 0
                }))
            }
            Err(error) => return Err(error),
        };
        let numstat = git_exec(
            &repository_root,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--numstat",
                "HEAD",
                "--",
                ".",
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let branch = git_exec(
            &repository_root,
            &["rev-parse", "--abbrev-ref", "HEAD"],
            GitTimeout::Short,
        )
        .await
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

        let files: Vec<Value> = parse_porcelain_v1(&porcelain)
            .into_iter()
            .filter_map(|entry| {
                let file_path = Path::new(&repository_root).join(&entry.path);
                let file_path = file_path.to_string_lossy().replace('\\', "/");
                if !security::is_path_within(&file_path, &real_cwd)
                    && !security::is_path_within(&file_path, &repository_root)
                {
                    return None;
                }
                let (status, code) = classify(&entry);
                Some(json!({
                    "filePath": file_path,
                    "status": status,
                    "code": code,
                    "indexStatus": entry.index_status,
                    "worktreeStatus": entry.worktree_status
                }))
            })
            .collect();

        let mut additions = 0i64;
        let mut deletions = 0i64;
        for line in numstat.lines() {
            let mut parts = line.split('\t');
            if let (Some(added), Some(deleted)) = (parts.next(), parts.next()) {
                if let Ok(n) = added.parse::<i64>() {
                    additions += n;
                }
                if let Ok(n) = deleted.parse::<i64>() {
                    deletions += n;
                }
            }
        }

        Ok(json!({
            "isGitRepository": true,
            "repositoryRoot": repository_root,
            "files": files,
            "additions": additions,
            "deletions": deletions,
            "branch": branch
        }))
    }

    pub async fn status_many(&self, cwds: &[String]) -> AppResult<Vec<Value>> {
        let mut out = Vec::with_capacity(cwds.len());
        for chunk in cwds.chunks(4) {
            let mut handles = Vec::new();
            for cwd in chunk {
                let this = self.clone();
                let cwd = cwd.clone();
                handles.push(tokio::spawn(async move { this.status(&cwd).await }));
            }
            for handle in handles {
                out.push(
                    handle
                        .await
                        .map_err(|error| AppError::git(error.to_string()))??,
                );
            }
        }
        Ok(out)
    }

    pub async fn diff(&self, cwd: &str, file_path: &str) -> AppResult<Value> {
        let real_cwd = self.access.assert_allowed(cwd, true)?;
        let allowed_file = self.access.assert_allowed(file_path, false)?;
        let repository_root = match git_exec(
            &real_cwd,
            &["rev-parse", "--show-toplevel"],
            GitTimeout::Short,
        )
        .await
        {
            Ok(value) => native_path(value.trim()),
            Err(_) => return Ok(json!({ "supported": false })),
        };
        if !security::is_path_within(&allowed_file, &repository_root) {
            return Ok(json!({ "supported": false }));
        }
        let relative = security::relative_to(&repository_root, &allowed_file);
        let porcelain = git_exec(
            &repository_root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            GitTimeout::Short,
        )
        .await?;
        let entry = parse_porcelain_v1(&porcelain)
            .into_iter()
            .find(|item| item.path == relative);
        let Some(entry) = entry else {
            return Ok(json!({ "supported": false }));
        };
        let (status, _) = classify(&entry);
        if status == "untracked" {
            return Ok(json!({ "supported": true, "status": status, "patch": "" }));
        }
        let has_head = git_exec(
            &repository_root,
            &["rev-parse", "--verify", "HEAD"],
            GitTimeout::Short,
        )
        .await
        .is_ok();
        let args: Vec<&str> = if has_head {
            vec![
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--unified=3",
                "HEAD",
                "--",
                &relative,
            ]
        } else {
            vec![
                "diff",
                "--cached",
                "--no-color",
                "--no-ext-diff",
                "--unified=3",
                "--",
                &relative,
            ]
        };
        let patch = git_exec_with_limit(
            &repository_root,
            &args,
            GitTimeout::Short,
            TEXT_PREVIEW_MAX * 4,
        )
        .await
        .unwrap_or_default();
        Ok(json!({ "supported": true, "status": status, "patch": patch }))
    }

    pub async fn stage(&self, cwd: &str, file_paths: &[String]) -> AppResult<()> {
        let (root, relatives) = self.mutable_paths(cwd, file_paths).await?;
        let mut args = vec!["add", "--"];
        for path in &relatives {
            args.push(path);
        }
        git_exec(&root, &args, GitTimeout::Long).await?;
        Ok(())
    }

    pub async fn unstage(&self, cwd: &str, file_paths: &[String]) -> AppResult<()> {
        let (root, relatives) = self.mutable_paths(cwd, file_paths).await?;
        let has_head = git_exec(&root, &["rev-parse", "--verify", "HEAD"], GitTimeout::Short)
            .await
            .is_ok();
        let mut args = if has_head {
            vec!["restore", "--staged", "--"]
        } else {
            vec!["rm", "--cached", "--ignore-unmatch", "-r", "--"]
        };
        for path in &relatives {
            args.push(path);
        }
        git_exec(&root, &args, GitTimeout::Long).await?;
        Ok(())
    }

    pub async fn commit(&self, cwd: &str, message: &str) -> AppResult<Value> {
        let root = self.mutable_repository(cwd).await?;
        let staged = git_exec(
            &root,
            &["diff", "--cached", "--name-only"],
            GitTimeout::Short,
        )
        .await?;
        if staged.trim().is_empty() {
            return Err(AppError::git("Nothing is staged to commit."));
        }
        git_exec(&root, &["commit", "-m", message.trim()], GitTimeout::Long).await?;
        let hash = git_exec(&root, &["rev-parse", "HEAD"], GitTimeout::Short)
            .await?
            .trim()
            .to_string();
        Ok(json!({ "hash": hash }))
    }

    pub async fn commit_message_context(&self, cwd: &str, draft: &str) -> AppResult<Value> {
        let root = self.repository(cwd).await?;
        let stat = git_exec(
            &root,
            &[
                "diff",
                "--cached",
                "--no-color",
                "--no-ext-diff",
                "--stat=200",
            ],
            GitTimeout::Short,
        )
        .await?;
        let diff = git_exec_with_limit(
            &root,
            &[
                "diff",
                "--cached",
                "--no-color",
                "--no-ext-diff",
                "--unified=3",
            ],
            GitTimeout::Short,
            2 * 1024 * 1024,
        )
        .await?;
        if diff.trim().is_empty() {
            return Err(AppError::git("Nothing is staged to describe."));
        }
        let messages = git_exec(
            &root,
            &["log", "-n", "8", "--no-merges", "--format=%B%x00"],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let recent: Vec<String> = messages
            .split('\0')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect();
        Ok(json!({
            "repositoryRoot": root,
            "summary": summarize_staged_diff(&stat, &diff),
            "recentMessages": recent,
            "draft": draft.trim()
        }))
    }

    pub async fn history(&self, cwd: &str, limit: u32) -> AppResult<Vec<Value>> {
        let root = self.repository(cwd).await?;
        let max = format!("--max-count={limit}");
        let output = match git_exec(
            &root,
            &[
                "log",
                "--all",
                "--topo-order",
                "--decorate=short",
                &max,
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e",
            ],
            GitTimeout::Short,
        )
        .await
        {
            Ok(value) => value,
            Err(error) if is_empty_history(&error) => String::new(),
            Err(error) => return Err(error),
        };
        Ok(output
            .split('\u{1e}')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .filter_map(|record| {
                let mut parts = record.split('\u{1f}');
                let hash = parts.next()?.to_string();
                let parents = parts.next().unwrap_or_default();
                let author = parts.next().unwrap_or_default();
                let email = parts.next().unwrap_or_default();
                let authored_at = parts.next().unwrap_or_default();
                let refs = parts.next().unwrap_or_default();
                let subject = parts.next().unwrap_or_default();
                Some(json!({
                    "hash": hash,
                    "parents": parents.split_whitespace().collect::<Vec<_>>(),
                    "author": author,
                    "email": email,
                    "authoredAt": authored_at,
                    "refs": refs.split(',').map(str::trim).filter(|item| !item.is_empty()).collect::<Vec<_>>(),
                    "subject": subject
                }))
            })
            .collect())
    }

    pub async fn overview(&self, cwd: &str) -> AppResult<Value> {
        let root = self.repository(cwd).await?;
        let current_branch = git_exec(
            &root,
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            GitTimeout::Short,
        )
        .await
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
        let branch_text = git_exec(
            &root,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)",
                "refs/heads",
                "refs/remotes",
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let remote_names = git_exec(&root, &["remote"], GitTimeout::Short)
            .await
            .unwrap_or_default();
        let stash_text = git_exec(
            &root,
            &["stash", "list", "--format=%gd%09%at%09%P%09%gs"],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let tag_text = git_exec(
            &root,
            &[
                "for-each-ref",
                "--sort=-creatordate",
                "--format=%(refname:short)%09%(objectname)%09%(*objectname)",
                "refs/tags",
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let activity_text = git_exec(
            &root,
            &[
                "log",
                "--all",
                "--no-merges",
                "--since=182.days",
                "--format=%ad%x1f%an%x1f%ae",
                "--date=format:%Y-%m-%d",
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let submodule_text = git_exec(
            &root,
            &["submodule", "status", "--recursive"],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();

        let mut remotes = Vec::new();
        for name in remote_names
            .lines()
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            let key = format!("remote.{name}.url");
            let url = git_exec(&root, &["config", "--get", &key], GitTimeout::Short)
                .await
                .unwrap_or_default()
                .trim()
                .to_string();
            remotes.push(json!({ "name": name, "url": url }));
        }

        let stashes: Vec<Value> = stash_text
            .lines()
            .filter(|line| !line.is_empty())
            .filter_map(|line| {
                let mut parts = line.splitn(4, '\t');
                let git_ref = parts.next()?;
                let timestamp = parts
                    .next()
                    .and_then(|item| item.parse::<i64>().ok())
                    .unwrap_or(0);
                let parents = parts.next().unwrap_or_default();
                let message = parts.next().unwrap_or_default().replace("On ", "");
                Some(json!({
                    "ref": git_ref,
                    "message": message,
                    "timestamp": timestamp,
                    "baseHash": parents.split_whitespace().next().unwrap_or("")
                }))
            })
            .collect();

        let branches: Vec<Value> = branch_text
            .lines()
            .filter(|line| !line.is_empty())
            .filter_map(|line| {
                let mut parts = line.split('\0');
                let full_name = parts.next()?;
                let name = parts.next().unwrap_or_default();
                let tip = parts.next().unwrap_or_default();
                let upstream = parts.next().unwrap_or_default();
                let track = parts.next().unwrap_or_default();
                if full_name.is_empty() || name.is_empty() || full_name.ends_with("/HEAD") {
                    return None;
                }
                let kind = if full_name.starts_with("refs/heads/") {
                    "local"
                } else {
                    "remote"
                };
                Some(json!({
                    "name": name,
                    "fullName": full_name,
                    "type": kind,
                    "tipHash": tip,
                    "upstream": if upstream.is_empty() { Value::Null } else { json!(upstream) },
                    "ahead": capture_number(track, "ahead"),
                    "behind": capture_number(track, "behind"),
                    "current": kind == "local" && Some(name) == current_branch.as_deref()
                }))
            })
            .collect();

        let tags: Vec<Value> = tag_text
            .lines()
            .filter(|line| !line.is_empty())
            .filter_map(|line| {
                let mut parts = line.split('\t');
                let name = parts.next()?;
                let hash = parts.next().unwrap_or_default();
                Some(json!({ "name": name, "hash": hash }))
            })
            .collect();

        Ok(json!({
            "currentBranch": current_branch,
            "detached": current_branch.is_none(),
            "branches": branches,
            "remotes": remotes,
            "stashCount": stashes.len(),
            "stashes": stashes,
            "tags": tags,
            "activity": parse_activity(&activity_text),
            "pullRequests": {
                "provider": null,
                "available": false,
                "authenticated": false,
                "message": null,
                "items": []
            },
            "submodules": parse_submodules(&submodule_text)
        }))
    }

    pub async fn commit_details(&self, cwd: &str, hash: &str) -> AppResult<Value> {
        let root = self.repository(cwd).await?;
        let git_ref = assert_git_ref(hash)?;
        let metadata = git_exec(
            &root,
            &[
                "show",
                "--no-patch",
                "--decorate=short",
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1f%b%x1e",
                &git_ref,
            ],
            GitTimeout::Short,
        )
        .await?;
        let files = git_exec(
            &root,
            &[
                "diff-tree",
                "--root",
                "--diff-merges=first-parent",
                "--no-commit-id",
                "--name-status",
                "-r",
                &git_ref,
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        let record = metadata.split('\u{1e}').next().unwrap_or_default();
        let mut parts = record.split('\u{1f}');
        let hash = parts.next().unwrap_or_default();
        let parents = parts.next().unwrap_or_default();
        let author = parts.next().unwrap_or_default();
        let email = parts.next().unwrap_or_default();
        let authored_at = parts.next().unwrap_or_default();
        let refs = parts.next().unwrap_or_default();
        let subject = parts.next().unwrap_or_default();
        let body = parts.next().unwrap_or_default();
        Ok(json!({
            "hash": hash.trim(),
            "parents": parents.split_whitespace().collect::<Vec<_>>(),
            "author": author,
            "email": email,
            "authoredAt": authored_at,
            "refs": refs.split(',').map(str::trim).filter(|item| !item.is_empty()).collect::<Vec<_>>(),
            "subject": subject,
            "body": body.trim(),
            "files": parse_commit_files(&files)
        }))
    }

    pub async fn commit_diff(&self, cwd: &str, hash: &str, file_path: &str) -> AppResult<Value> {
        let root = self.repository(cwd).await?;
        let git_ref = assert_git_ref(hash)?;
        let relative = repository_relative(&root, file_path)?;
        let patch = git_exec_with_limit(
            &root,
            &[
                "show",
                "--no-color",
                "--no-ext-diff",
                "--unified=3",
                "--format=",
                &git_ref,
                "--",
                &relative,
            ],
            GitTimeout::Short,
            TEXT_PREVIEW_MAX * 4,
        )
        .await
        .unwrap_or_default();
        let truncated = patch.len() >= TEXT_PREVIEW_MAX * 4;
        Ok(json!({ "patch": patch, "truncated": truncated }))
    }

    pub async fn file_history(
        &self,
        cwd: &str,
        file_path: &str,
        limit: u32,
    ) -> AppResult<Vec<Value>> {
        let root = self.repository(cwd).await?;
        let relative = repository_relative(&root, file_path)?;
        let max = format!("--max-count={limit}");
        let output = git_exec(
            &root,
            &[
                "log",
                "--follow",
                "--decorate=short",
                &max,
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e",
                "--",
                &relative,
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        self.history_from_output(&output)
    }

    pub async fn action(&self, input: GitActionRequest) -> AppResult<Value> {
        let root = self.mutable_repository(&input.cwd).await?;
        let target = optional_ref(input.target.as_deref())?;
        let name = optional_ref(input.name.as_deref())?;
        let upstream = optional_ref(input.upstream.as_deref())?;
        let args: Vec<String> = match input.action.as_str() {
            "fetch" => vec!["fetch".into(), "--all".into(), "--prune".into()],
            "pull" => vec!["pull".into(), "--ff-only".into()],
            "pull-rebase" => vec!["pull".into(), "--rebase".into()],
            "pull-merge" => vec!["pull".into(), "--no-rebase".into()],
            "push" => self.push_args(&root, target.as_deref()).await?,
            "force-push" => {
                let branch = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch is required."))?;
                let upstream_text = git_exec(
                    &root,
                    &[
                        "for-each-ref",
                        "--format=%(upstream:short) %(upstream:objectname)",
                        &format!("refs/heads/{branch}"),
                    ],
                    GitTimeout::Short,
                )
                .await
                .unwrap_or_default();
                let mut bits = upstream_text.split_whitespace();
                let remote = bits.next().unwrap_or_default();
                if remote.is_empty() {
                    return Err(AppError::git(
                        "The branch has no upstream to force-push to.",
                    ));
                }
                let expected = bits.next().unwrap_or_default();
                let lease = if expected.is_empty() {
                    "--force-with-lease".to_string()
                } else {
                    format!("--force-with-lease=refs/heads/{branch}:{expected}")
                };
                vec!["push".into(), lease, remote.into(), branch]
            }
            "create-branch" => {
                let name = name
                    .clone()
                    .ok_or_else(|| AppError::git("Branch name is required."))?;
                vec![
                    "switch".into(),
                    "-c".into(),
                    name,
                    target.clone().unwrap_or_else(|| "HEAD".into()),
                ]
            }
            "checkout-branch" => {
                let branch = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch is required."))?;
                vec!["switch".into(), branch]
            }
            "checkout-remote" => {
                let remote_branch = target
                    .clone()
                    .ok_or_else(|| AppError::git("Remote branch is required."))?;
                let local = remote_branch
                    .split('/')
                    .skip(1)
                    .collect::<Vec<_>>()
                    .join("/");
                if local.is_empty() {
                    return Err(AppError::git("Remote branch is invalid."));
                }
                let exists = git_exec(
                    &root,
                    &[
                        "show-ref",
                        "--verify",
                        "--quiet",
                        &format!("refs/heads/{local}"),
                    ],
                    GitTimeout::Short,
                )
                .await
                .is_ok();
                if exists {
                    vec!["switch".into(), local]
                } else {
                    vec![
                        "switch".into(),
                        "--track".into(),
                        "-c".into(),
                        local,
                        remote_branch,
                    ]
                }
            }
            "checkout-tag" | "checkout-commit" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Revision is required."))?;
                vec!["checkout".into(), "--detach".into(), value]
            }
            "create-tag" => {
                let name = name
                    .clone()
                    .ok_or_else(|| AppError::git("Tag name is required."))?;
                vec![
                    "tag".into(),
                    name,
                    target.clone().unwrap_or_else(|| "HEAD".into()),
                ]
            }
            "delete-tag" => {
                let tag = target
                    .clone()
                    .ok_or_else(|| AppError::git("Tag is required."))?;
                vec!["tag".into(), "-d".into(), tag]
            }
            "push-tag" => {
                let tag = target
                    .clone()
                    .ok_or_else(|| AppError::git("Tag is required."))?;
                let remote = match name.clone() {
                    Some(value) => value,
                    None => git_exec(&root, &["remote"], GitTimeout::Short)
                        .await
                        .unwrap_or_default()
                        .lines()
                        .map(str::trim)
                        .find(|item| !item.is_empty())
                        .unwrap_or_default()
                        .to_string(),
                };
                if remote.is_empty() {
                    return Err(AppError::git(
                        "No remote is configured for this repository.",
                    ));
                }
                vec!["push".into(), remote, "tag".into(), tag]
            }
            "stash" => {
                let mut stash = vec!["stash".into(), "push".into(), "-u".into()];
                if let Some(message) = input
                    .message
                    .as_deref()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                {
                    stash.push("-m".into());
                    stash.push(message.to_string());
                }
                stash
            }
            "stash-pop" => {
                let mut stash = vec!["stash".into(), "pop".into()];
                if let Some(value) = target.clone() {
                    stash.push(value);
                }
                stash
            }
            "stash-apply" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Stash is required."))?;
                vec!["stash".into(), "apply".into(), value]
            }
            "stash-drop" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Stash is required."))?;
                vec!["stash".into(), "drop".into(), value]
            }
            "merge" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch to merge is required."))?;
                vec!["merge".into(), "--no-edit".into(), value]
            }
            "rebase" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Rebase target is required."))?;
                vec!["rebase".into(), value]
            }
            "fast-forward" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch is required."))?;
                vec!["merge".into(), "--ff-only".into(), value]
            }
            "rename-branch" => {
                let old = target
                    .clone()
                    .ok_or_else(|| AppError::git("Old and new branch names are required."))?;
                let new_name = name
                    .clone()
                    .ok_or_else(|| AppError::git("Old and new branch names are required."))?;
                vec!["branch".into(), "-m".into(), old, new_name]
            }
            "delete-branch" => {
                let value = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch is required."))?;
                vec!["branch".into(), "-d".into(), value]
            }
            "set-upstream" => {
                let branch = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch and upstream are required."))?;
                let up = upstream
                    .clone()
                    .ok_or_else(|| AppError::git("Branch and upstream are required."))?;
                vec!["branch".into(), format!("--set-upstream-to={up}"), branch]
            }
            "unset-upstream" => {
                let branch = target
                    .clone()
                    .ok_or_else(|| AppError::git("Branch is required."))?;
                vec!["branch".into(), "--unset-upstream".into(), branch]
            }
            "discard-file" => {
                let path = target
                    .clone()
                    .ok_or_else(|| AppError::git("File is required."))?;
                let relative = repository_relative(&root, &path)?;
                vec!["restore".into(), "--".into(), relative]
            }
            "discard-all" => {
                git_exec(&root, &["reset", "-q", "HEAD"], GitTimeout::Long).await?;
                git_exec(&root, &["restore", "--", "."], GitTimeout::Long).await?;
                vec!["clean".into(), "-fd".into()]
            }
            "amend-commit" => {
                let message = input
                    .message
                    .as_deref()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .ok_or_else(|| AppError::git("Commit message is required."))?;
                vec![
                    "commit".into(),
                    "--amend".into(),
                    "-m".into(),
                    message.to_string(),
                ]
            }
            other => return Err(AppError::git(format!("Unsupported git action: {other}"))),
        };
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let output = git_exec(&root, &arg_refs, GitTimeout::Long).await?;
        let hash = git_exec(&root, &["rev-parse", "--verify", "HEAD"], GitTimeout::Short)
            .await
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Ok(json!({ "hash": hash, "message": output.trim() }))
    }

    async fn push_args(&self, root: &str, requested: Option<&str>) -> AppResult<Vec<String>> {
        let branch = match requested {
            Some(value) => value.to_string(),
            None => git_exec(
                root,
                &["symbolic-ref", "--quiet", "--short", "HEAD"],
                GitTimeout::Short,
            )
            .await?
            .trim()
            .to_string(),
        };
        if branch.is_empty() {
            return Err(AppError::git("Cannot push while HEAD is detached."));
        }
        let upstream = git_exec(
            root,
            &[
                "for-each-ref",
                "--format=%(upstream:short)",
                &format!("refs/heads/{branch}"),
            ],
            GitTimeout::Short,
        )
        .await
        .unwrap_or_default();
        if let Some(remote) = upstream
            .trim()
            .split('/')
            .next()
            .filter(|item| !item.is_empty())
        {
            return Ok(vec!["push".into(), remote.into(), branch]);
        }
        let remote = git_exec(root, &["remote"], GitTimeout::Short)
            .await
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .find(|item| !item.is_empty())
            .unwrap_or_default()
            .to_string();
        if remote.is_empty() {
            return Err(AppError::git(
                "No remote is configured for this repository.",
            ));
        }
        Ok(vec!["push".into(), "--set-upstream".into(), remote, branch])
    }

    async fn repository(&self, cwd: &str) -> AppResult<String> {
        let real_cwd = self.access.assert_allowed(cwd, true)?;
        let root = git_exec(
            &real_cwd,
            &["rev-parse", "--show-toplevel"],
            GitTimeout::Short,
        )
        .await?;
        let root = native_path(root.trim());
        if root.is_empty() {
            return Err(AppError::git("Not a git repository."));
        }
        Ok(root)
    }

    async fn mutable_repository(&self, cwd: &str) -> AppResult<String> {
        let real_cwd = self.access.assert_writable_for_git(cwd, true)?;
        let root = git_exec(
            &real_cwd,
            &["rev-parse", "--show-toplevel"],
            GitTimeout::Short,
        )
        .await?;
        let root = native_path(root.trim());
        if root.is_empty() {
            return Err(AppError::git("Not a git repository."));
        }
        Ok(root)
    }

    async fn mutable_paths(
        &self,
        cwd: &str,
        file_paths: &[String],
    ) -> AppResult<(String, Vec<String>)> {
        let root = self.mutable_repository(cwd).await?;
        let mut relatives = Vec::new();
        for file_path in file_paths {
            let allowed = self.access.assert_allowed(file_path, false)?;
            relatives.push(repository_relative(&root, &allowed)?);
        }
        relatives.sort();
        relatives.dedup();
        Ok((root, relatives))
    }

    fn history_from_output(&self, output: &str) -> AppResult<Vec<Value>> {
        Ok(output
            .split('\u{1e}')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .filter_map(|record| {
                let mut parts = record.split('\u{1f}');
                let hash = parts.next()?.to_string();
                Some(json!({
                    "hash": hash,
                    "parents": parts.next().unwrap_or_default().split_whitespace().collect::<Vec<_>>(),
                    "author": parts.next().unwrap_or_default(),
                    "email": parts.next().unwrap_or_default(),
                    "authoredAt": parts.next().unwrap_or_default(),
                    "refs": parts.next().unwrap_or_default().split(',').map(str::trim).filter(|item| !item.is_empty()).collect::<Vec<_>>(),
                    "subject": parts.next().unwrap_or_default()
                }))
            })
            .collect())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionRequest {
    pub cwd: String,
    pub action: String,
    pub target: Option<String>,
    pub name: Option<String>,
    pub upstream: Option<String>,
    pub message: Option<String>,
}

fn native_path(value: &str) -> String {
    value.replace('\\', "/")
}

fn optional_ref(value: Option<&str>) -> AppResult<Option<String>> {
    match value {
        Some(raw) if !raw.trim().is_empty() => Ok(Some(assert_git_ref(raw)?)),
        _ => Ok(None),
    }
}

fn repository_relative(root: &str, value: &str) -> AppResult<String> {
    let normalized = value
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    if normalized.is_empty() || normalized.starts_with('-') {
        return Err(AppError::git(
            "Git path is outside the selected repository.",
        ));
    }
    let resolved = if Path::new(&normalized).is_absolute() {
        native_path(&normalized)
    } else {
        security::join_normalized(root, &normalized)
    };
    if !security::is_path_within(&resolved, root) {
        return Err(AppError::git(
            "Git path is outside the selected repository.",
        ));
    }
    Ok(security::relative_to(root, &resolved))
}

fn capture_number(track: &str, label: &str) -> i64 {
    let needle = format!("{label} ");
    track
        .find(&needle)
        .and_then(|index| {
            track[index + needle.len()..]
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse()
                .ok()
        })
        .unwrap_or(0)
}

fn parse_activity(output: &str) -> Vec<Value> {
    let mut counts = std::collections::BTreeMap::<String, i64>::new();
    for line in output.lines() {
        let date = line.split('\u{1f}').next().unwrap_or_default();
        if date.len() == 10 {
            *counts.entry(date.to_string()).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .map(|(date, commits)| json!({ "date": date, "commits": commits, "authors": [] }))
        .collect()
}

fn parse_submodules(output: &str) -> Vec<Value> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let trimmed = line.trim_start();
            let hash = trimmed.get(0..40)?;
            let path = trimmed.get(41..)?.split_whitespace().next()?;
            let state = if line.starts_with('-') {
                "uninitialized"
            } else if line.starts_with('U') {
                "conflict"
            } else if line.starts_with('+') {
                "modified"
            } else {
                "clean"
            };
            Some(json!({ "path": path, "hash": hash, "state": state }))
        })
        .collect()
}

fn parse_commit_files(output: &str) -> Vec<Value> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let raw = parts.next()?;
            let status = raw.chars().next()?.to_string();
            let first = parts.next()?;
            let second = parts.next();
            let (path, previous) = if matches!(status.as_str(), "R" | "C") {
                (second.unwrap_or_default(), Some(first))
            } else {
                (first, None)
            };
            Some(json!({ "path": path, "previousPath": previous, "status": status }))
        })
        .collect()
}

const NOISE: &[&str] = &[
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.lock",
    "go.sum",
];

fn summarize_staged_diff(stat: &str, diff: &str) -> String {
    let mut sections = vec![stat.trim().to_string()];
    let mut omitted = Vec::new();
    let mut spent = 0usize;
    for chunk in diff.split("diff --git ") {
        if chunk.trim().is_empty() {
            continue;
        }
        let text = format!("diff --git {chunk}");
        let path = chunk
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().last())
            .unwrap_or_default()
            .trim_start_matches("b/")
            .to_string();
        let name = path.rsplit('/').next().unwrap_or(&path);
        if NOISE.contains(&name) || name.ends_with(".lock") {
            omitted.push(format!("{path} (generated or locked file)"));
            continue;
        }
        if text.contains("GIT binary patch") || text.contains("Binary files ") {
            omitted.push(format!("{path} (binary)"));
            continue;
        }
        if spent + text.len() > 24_000 {
            omitted.push(format!("{path} (over the size budget)"));
            continue;
        }
        spent += text.len();
        sections.push(text);
    }
    if !omitted.is_empty() {
        sections.push(format!("Not shown in full: {}", omitted.join(", ")));
    }
    sections
        .into_iter()
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_skips_lockfiles() {
        let diff = "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\nindex 1..2\n";
        let summary = summarize_staged_diff("1 file changed", diff);
        assert!(summary.contains("generated or locked file"));
    }
}
