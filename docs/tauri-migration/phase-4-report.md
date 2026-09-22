# Pi-Harness Tauri Migration Phase 4

对应任务 `task/15-Pi 生态里最好用.md`。

## Branch

`refactor/tauri-v2`（未改 `main`，未删 Electron）

## Architecture

```text
Vue 3
  → Platform Bridge (src/platform/tauri.ts)
    → Tauri 2 / Rust Desktop Host
        ├── AuthorizedRootStore
        ├── Native Dialog
        ├── Files (atomic write)
        ├── Watcher (120ms debounce)
        ├── Search
        ├── Terminal (argv)
        ├── Git CLI (argv, 非 libgit2)
        └── Worktree (`{repo}-worktrees/{branch}`)
              │
              ▼ JSONL RPC
        Node sidecar
          ├── Session / Agent / Harness
          ├── git.generateCommitMessage（AI commit，不跑 git）
          └── Orchestration.createWorktree → git worktree add
```

Vue 不直接 `invoke`。路径安全、对话框、Git/Worktree 进程只在 Rust。
Agent / Harness / Orchestration / AI commit 仍在 sidecar。

本阶段执行时 **Phase 5（task 16）已提前落地**，sidecar desktop 服务 /
EnvironmentResolver 全部保留，未回滚。

## Workspace

`src-tauri/src/workspace/`：active workspace、recent、session binding。
数据文件 `workspace-state.json`，字段与 Electron 相同（camelCase）。

`listProjects` 在 Bridge 用 `session.list` + `groupSessionsByProject`。
`agent.start` 先 `workspace_assert_cwd`。

文件夹拖放：WKWebView `File` 无绝对路径。Rust `on_webview_event(DragDrop)`
对目录 `authorize_root`，发出 `pi-harness:event:native-folder-drop`；
Bridge 缓存 `tauri://drag-drop` 供 `getPathForFile({ name })` 匹配。
Sidebar 订阅该事件，与 HTML5 `onDrop` 去重。Electron 仍走
`webUtils.getPathForFile`。

## Filesystem

`src-tauri/src/files.rs`：list / preview / atomic write / upload。
写文件：tmp + rename；`expectedRevision` 冲突 → `FILE_CONFLICT`。

## Path Security

见 [path-authorization.md](./path-authorization.md)、[filesystem-security.md](./filesystem-security.md)。
canonical path；`pi-harness/` 与 `pi-harness-other/` 不能互相包含；
symlink escape deny。`startsWith` 仅在 canonicalize 后加 `/` 边界。

## File Watcher

单一 `RecommendedWatcher`，trailing debounce 120ms，事件
`pi-harness:event:workspace-changed`。

## Search

忽略 `node_modules/.git/dist/...`；generation 取消旧搜索；上限 200 hits / 5000 files。

## Terminal

macOS `open -a Terminal`；Windows `cmd /k cd /d`；Linux `$TERMINAL` 或
`x-terminal-emulator --working-directory`。无用户可控 shell 字符串。

## Git

见 [git.md](./git.md)。CLI argv + timeout；token 脱敏；GitHub PR
`available: false`。

## AI Commit Generation

Rust 收集 staged diff → sidecar `git.generateCommitMessage`（sidecar 不 exec git）。

## Worktree

见 [worktree.md](./worktree.md)。UI 走 Rust；Orchestration isolated agent
走 sidecar `git worktree add`，写入 `authorized-roots.json`。

## Agent Integration

绑定 cwd 必须在 authorized roots。Agent 改文件 → watcher → Git status。

## Multi-Agent Integration

`workspaceMode: worktree` 时 `createGitWorktree` 落到
`{repo}-worktrees/{branch}`，不再回退 shared cwd。

## Tests

- `src-tauri`：path containment、persist、git redact、runtime sidecar、environment
- `src/platform/tauri.test.ts`：workspace/files/git/worktrees 命令映射、`agent.start` cwd assert、`getPathForFile`
- `src/platform/dropped-path.test.ts`：WKWebView basename 匹配
- `runtime/src/orchestration/worktree.test.ts`：真实 `git worktree add`

## Security Tests

- sibling prefix `pi-harness` vs `pi-harness-other`
- authorize_root persist + `/etc/passwd` deny
- git ref 拒绝 `--` 前缀；https token 脱敏

## Performance

Git short 10s / long 120s；search 200 hits / 5000 files；watcher 120ms debounce。
未做专门 benchmark。

## Electron Compatibility

PASS（未改 Electron Git/Workspace 实现；preload `on('native-folder-drop')` 为空订阅；
`git-service.test` 仅隔离 `GIT_AUTHOR_*`）

## Tauri Status

PASS（Workspace / Files / Git / Worktree 已接线。Phase 5 已存在且保留。
未做 Updater / Release / overlay）

## Commands Verified

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS（既有 2 warning：`scripts/prepare-mac-repair-app.mjs` console，0 error） |
| `pnpm test` | PASS（167 files / 988 passed / 5 skipped） |
| `pnpm runtime:build` | PASS |
| `pnpm build:tauri` | 本会话未打包 |
| `cargo fmt --check` | PASS |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `cargo test` | PASS（31 tests：30 lib + 1 runtime forwarding） |
| `pnpm dev:electron` / `pnpm dev:tauri` | 本会话未开 GUI；交互式导入 workspace / 拖放 / Git / Worktree 需本地点 `dev:tauri` |

## Compatibility Matrix

见 [compatibility-matrix.md](./compatibility-matrix.md)。`workspace` / `files` / `git` / `worktrees` 已实现。

## Known Issues

- `pickWorkspaceSources`：Tauri dialog 不能单次混选文件+目录；多选文件夹，
  并附带目录内顶层 `*.code-workspace`。单独 `.code-workspace` 仍走 `pickWorkspaceFile`。
- GitHub Pull Requests 未接（与已知 Electron 问题一致，overview 返回 `available: false`）。
- macOS 原生菜单 dismiss 无 OS 回调；超时 120s 或下一次菜单弹出取消。
- `sessions.export` / `exportProject` 仍 pending（原计划阶段 5 会话导出，非本阶段）。
- 原生文件夹 drop 是 webview 级（非仅 sidebar 命中区）；与 HTML5 drop 1s 去重。

## Risks

- sidecar 写 `authorized-roots.json` 与 Rust in-memory 集合靠 mtime 同步（1s 缓存）。
- 交互式 workspace / Git / Worktree / 拖放流程未在本会话 GUI 跑通。

## Files Added

本阶段缺口补齐：

- `src/platform/dropped-path.ts`
- `src/platform/dropped-path.test.ts`

既有 Phase 4 实现（先前会话）：`src-tauri/src/{workspace,files,git,worktree,security,host,persist}.rs`、
`runtime/src/orchestration/worktree.ts`、docs `workspace.md` / `git.md` / `worktree.md` /
`path-authorization.md` / `filesystem-security.md`。

Phase 5 文件（`runtime/src/desktop/**`、`environment/`、`commands/desktop.rs` 等）**保留，不属本阶段回滚范围**。

## Files Modified

- `src/platform/tauri.ts` / `tauri.test.ts`：`getPathForFile` 解析 + native drop 缓存
- `src-tauri/src/lib.rs` / `commands/workspace.rs`：DragDrop 授权并发 `native-folder-drop`
- `src/renderer/src/components/workspace/WorkspaceSidebar.vue`：订阅原生 drop（非 UI 重写）
- `src/shared/ipc/api-types.ts` / `channels.ts` / `src/preload/index.ts`：事件契约
- `docs/tauri-migration/{workspace,path-authorization,compatibility-matrix}.md`

## Stopped Before

Updater / Release / overlay / 深度链接 / 单实例（Phase 6）。
**未撤销**已提前完成的 Phase 5（Skills / Providers / Models / Backup / Environment）。
未改 `main`。

## Next Phase Recommendation

Phase 5 已在同分支完成。下一阶段是 task 17 / Phase 6（Updater / Release / overlay），
**不要在本阶段开始**。
