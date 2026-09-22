# Worktree

布局与 Electron 相同：

```text
{repoRoot}-worktrees/{sanitized-branch}
```

`/` `\\` `:` `*` `?` `"` `<` `>` `|` 空白 → `-`。

## UI

`piSwitch.worktrees.list/create/remove` → Rust `WorktreeService`。
create 成功后 `authorize_root(worktreePath)`。
不能删除 `isMain` worktree。

## Orchestration

`workspaceMode: 'worktree'` 时 sidecar `createGitWorktree` 执行
`git worktree add`（已有分支 / `-b` 新分支），并把路径写入
`authorized-roots.json`。不再回退到 shared cwd。
