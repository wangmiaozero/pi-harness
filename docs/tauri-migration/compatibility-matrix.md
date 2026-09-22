# `window.piSwitch` 兼容性矩阵（含第二阶段）

渲染层依赖的 API 契约见 `src/shared/ipc/api-types.ts`（`PiSwitchAPI`）。
Electron 预载桥与 Tauri 平台层（`src/platform/tauri.ts`）实现同一契约；
矩阵描述 Tauri 侧的实现状态。

图例：

- ✅ 已实现（Rust 命令或平台层直接可用）
- 🕐 待迁移（返回 `SHELL_METHOD_PENDING` 结构化错误；渲染层错误管线照常展示）
- ➕ Tauri 独有扩展（Electron 契约之外，`window.piSwitch.runtime`）

## 已实现

| 命名空间     | 方法                                               | Tauri 实现                                                                                                                                  |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `system`     | `info()`                                           | ✅ `system_info`（平台值映射为 Electron 风格：darwin/win32/linux；`versions.electron/chrome` 为空串，`node` 在运行时启动后为 sidecar 版本） |
| `system`     | `openPath(path)`                                   | ✅ `system_open_path`（argv 直传，不经 shell）                                                                                              |
| `system`     | `showItem(path)`                                   | ✅ `system_show_item`（`open -R` / explorer / xdg-open 父目录）                                                                             |
| `window`     | `minimize()`                                       | ✅ `window_minimize`                                                                                                                        |
| `window`     | `maximizeToggle()`                                 | ✅ `window_maximize_toggle`                                                                                                                 |
| `window`     | `close()`                                          | ✅ `window_close`                                                                                                                           |
| `on`         | 12 个事件通道                                      | ✅ 平台层映射到同名 Tauri 事件（未接线的事件源仍待迁移，见下）                                                                              |
| `runtime` ➕ | `ping` `version` `status` `start` `stop` `restart` | ✅ `runtime_*` 命令                                                                                                                         |
| `runtime` ➕ | `onState` `onEvent` `onLog`                        | ✅ `pi-harness:runtime:*` 事件                                                                                                              |
| `sessions`  | `list` `get` `rename` `delete` `context` `viewFullHistory` `contextMenu` `export` `exportProject` | ✅ `session.*` RPC；export 为 Rust save dialog + sidecar render |
| `agent`     | `start` `prompt` `abort` `state` `running` `command` | ✅ `runtime_request` → 运行时 `agent.*`；`start` 先 `workspace_assert_cwd` |
| `harness`   | （第二/三阶段全部方法） | ✅ `runtime_request` |
| `orchestration` | （第三阶段全部方法） | ✅ `runtime_request`；worktree 模式走 sidecar `git worktree add` |
| `workspace` | `listProjects` `pickDirectory` `pickWorkspaceSources` `pickWorkspaceFile` `saveWorkspaceFile` `allowRoot` `projectContextMenu` `sessionFolderContextMenu` `getPathForFile` `getActive` `sync` `openWorkspaceFile` `save` `search` `openInTerminal` `relocateFolder` `listRecent` `bindSession` `getSessionBinding` `listSessionBindings` | ✅ Rust Desktop Host + 原生 dialog/菜单 |
| `files` | `list` `read` `write` `upload` | ✅ Rust；路径必须在 authorized roots |
| `git` | `status` `statusMany` `diff` `stage` `unstage` `generateCommitMessage` `commit` `history` `overview` `commitDetails` `commitDiff` `action` `fileHistory` `branchContextMenu` | ✅ Rust git CLI；AI commit 经 sidecar；GitHub PR `available: false` |
| `worktrees` | `list` `create` `remove` | ✅ Rust；`{repo}-worktrees/{branch}` |
| `settings` | `get` `set` `unlockMascot` `getUiState` `setUiState` | ✅ sidecar JSON store（userData `settings.json` / `ui-state.json`） |
| `pi` | `detect` `getVersion` `runHelp` `checkLatest` `install` `bootstrap` `installNode` `reinstall` `getInstallTask` `cancelInstall` `update` | ✅ sidecar EnvironmentManager；`copyInstallCommand` / `openNodeDownload` 为 Rust |
| `config` | `read` `readRaw` `writeRaw` `readSettings` `reload` `getStatus` `conflictSnapshot` | ✅ sidecar PiConfigService + chokidar |
| `providers` | `list` `get` `create` `update` `delete` `duplicate` `setEnabled` `testConnection` `discoverModels` | ✅ sidecar；secret mask |
| `models` | `list` `create` `update` `delete` `setActive` `getActive` | ✅ sidecar；`provider + modelId` |
| `skills` | （包注册表 / builtin / CRUD 全部方法） | ✅ sidecar |
| `capabilities` | `list` `installSkill` `updateSkill` `uninstallSkill` `setSkillEnabled` | ✅ sidecar 受信目录；`openHomepage` 为 Rust 打开 GitHub URL |
| `backup` | `list` `create` `restore` `delete` `pruneToRetention` | ✅ sidecar；`openFolder` 为 Rust |
| `diagnostics` | `get` | ✅ sidecar（redact）；`copy` / `export` 为 Rust clipboard / save dialog |
| `logs` | `read` | ✅ sidecar；`openFolder` 为 Rust |
| `updater` | `state` `check` `download` `install` `openReleasePage` | ✅ tauri-plugin-updater；无签名包时 `manual-update` |

## 待迁移

以下方法在 Tauri 侧仍返回 `SHELL_METHOD_PENDING`
（拒绝的 Promise，`code: 'SHELL_METHOD_PENDING'`，`context: { namespace, method }`），
按计划阶段列出（详见 [migration-plan.md](./migration-plan.md)）：

| 命名空间                  | 方法数 | 计划阶段 | 迁移目标                                              |
| ------------------------- | -----: | -------- | ----------------------------------------------------- |
| `agentAura`               |      1 | overlay  | 悬浮窗恢复后一并处理（入口未开放，非 release blocker） |

方法计数以 `src/shared/ipc/channels.ts` 为准（合计约 200 个 invoke 通道）。

## 行为差异说明

| 主题                     | Electron                     | Tauri（第一阶段）                                               |
| ------------------------ | ---------------------------- | --------------------------------------------------------------- |
| `system.info().platform` | `darwin` / `win32` / `linux` | 同样映射（渲染层无感）                                          |
| `system.info().versions` | electron/chrome/node 实值    | electron/chrome 空串；node = sidecar 版本（未启动时空串）       |
| `system.info().packaged` | `app.isPackaged`             | `!debug_assertions`（dev 构建恒 false）                         |
| 帧拖拽                   | `-webkit-app-region: drag`   | mousedown shim → `window_start_drag`（WKWebView 忽略 CSS 属性） |
| 文件夹拖放               | HTML5 File + `webUtils.getPathForFile` | 原生 `DragDrop` → `native-folder-drop`；`getPathForFile` 匹配 basename |
| Agent 流式事件           | Pi SDK → webContents.send    | Pi SDK → 运行时 → JSONL → Rust → `pi-harness:agent:*` 事件（同 payload 形态） |
| 运行时崩溃恢复           | 不适用（进程内）              | `RuntimeStatusBanner` + `runtime.restart()`（Crashed 后可重启） |
| 悬浮窗（overlay）        | 第二 BrowserWindow           | 未实现（入口未开放，无影响）                            |
| 深度链接 / 单实例        | 无自定义协议；`requestSingleInstanceLock` | 无深度链接（不新增）；`tauri-plugin-single-instance` |
| 自动更新                 | electron-updater             | `piSwitch.updater.*` → tauri-plugin-updater；无签名 metadata 时 `manual-update` |

## `PiSwitchAPI` 之外的差异

- `window.piSwitchOverlay`（overlay 预载桥）在 Tauri 下不存在；
  overlay.html 不进入 Tauri 构建入口。
- `window.minimize / maximizeToggle / close`（TitleBar 兜底用的裸 window 函数）：
  Electron 下由 webContents 挂载；Tauri 下不存在 — TitleBar 实际调用
  `api.window.*`，兜底路径只在桥缺失时触发（与浏览器直开 Electron 构建
  的现状一致）。
