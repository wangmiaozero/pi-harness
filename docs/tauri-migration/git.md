# Git（Tauri Desktop Host）

系统 `git` CLI，argv 直传（`git -C <cwd> …`），不用 libgit2，不经 shell。

## Timeouts

| 操作 | 预算 |
| --- | --- |
| status / diff / log / show | 10s |
| fetch / pull / push / worktree add|remove / commit | 120s |
| `git.generateCommitMessage` RPC | 90s |

stdout 上限 8MiB。

## 错误

stderr 脱敏：`https://user:token@host` → `https://***`；丢弃含 `Authorization` 的行。
对外映射为稳定中文/英文 `GIT_ERROR` 文案（不是 raw git）。

## API

`piSwitch.git.*` → `git_*` 命令。`action` 覆盖 checkout / merge / rebase / push / pull /
stash / discard 等，target/name/upstream 经 `assert_git_ref`（禁止 `--` 前缀）。

## GitHub PR

`overview.pullRequests.available = false`。不在本阶段接网络 PR。

## AI commit

1. Rust 收集 staged diff 摘要（截断、去 token）
2. `runtime_request("git.generateCommitMessage")`
3. sidecar 用 Pi `modelRuntime.completeSimple` 生成 Conventional Commit subject
4. sidecar **不** 调用 git；真正 `git commit` 仍在 Rust
