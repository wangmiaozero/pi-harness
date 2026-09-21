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
| `on`         | 11 个事件通道                                      | ✅ 平台层映射到同名 Tauri 事件（未接线的事件源仍待迁移，见下）                                                                              |
| `runtime` ➕ | `ping` `version` `status` `start` `stop` `restart` | ✅ `runtime_*` 命令                                                                                                                         |
| `runtime` ➕ | `onState` `onEvent` `onLog`                        | ✅ `pi-harness:runtime:*` 事件                                                                                                              |
| `sessions`  | `list` `get` `rename` `delete` `context` `viewFullHistory` | ✅ `runtime_request` → 运行时 `session.*`（第二阶段；Pi SDK 懒加载）                                                   |
| `agent`     | `start` `prompt` `abort` `state` `running` `command` | ✅ `runtime_request` → 运行时 `agent.*`（第二阶段；流式事件经 `pi-harness:agent:*` 通道）                                              |
| `harness`   | `state` `tools` `setTools` `setModel` `setThinkingLevel` `compact` `abortCompaction` `setAutoCompaction` `steer` `followUp` `fork` `navigateTree` `session` `stats` `timeline` | ✅ `runtime_request` → 运行时 `harness.*`（第二阶段） |
| `on`        | `agent-event` `agent-running` `harness-event`       | ✅ 实时转发（事件流，无轮询）                                                                                                               |

## 待迁移

以下方法在 Tauri 侧仍返回 `SHELL_METHOD_PENDING`
（拒绝的 Promise，`code: 'SHELL_METHOD_PENDING'`，`context: { namespace, method }`），
按计划阶段列出（详见 [migration-plan.md](./migration-plan.md)）：

| 命名空间                  | 方法数 | 计划阶段 | 迁移目标                                              |
| ------------------------- | -----: | -------- | ----------------------------------------------------- |
| `settings`                |      4 | 阶段 2   | 运行时（JSON 文件）                                   |
| `pi`（环境探测/安装）     |     13 | 阶段 2   | 运行时（Node 环境天然可用）                           |
| `config`                  |      7 | 阶段 2   | 运行时                                                |
| `logs`                    |      2 | 阶段 2   | 运行时                                                |
| `diagnostics`             |      3 | 阶段 2   | 运行时                                                |
| `providers`               |      9 | 阶段 3   | 运行时                                                |
| `models`                  |      6 | 阶段 3   | 运行时                                                |
| `backup`                  |      6 | 阶段 3   | 运行时                                                |
| `skills` / `capabilities` | 27 + 5 | 阶段 4   | 运行时                                                |
| `sessions`（剩余）        |      3 | 阶段 5   | `export` / `exportProject` / `contextMenu`（文件系统面） |
| `harness`（控制平面）     |     24 | 阶段 5   | Run/Checkpoint/Policy/Artifacts/Baseline（下一批）    |
| `orchestration`           |     25 | 阶段 6   | 运行时（Pi SDK）                                      |
| `files`                   |      4 | 阶段 5   | 运行时                                                |
| `git`                     |     12 | 阶段 6   | 运行时                                                |
| `worktrees`               |      3 | 阶段 6   | 运行时                                                |
| `workspace`               |     20 | 阶段 6   | 运行时 + 原生对话框（目录选择需要 Tauri dialog 插件） |
| `updater`                 |      5 | 阶段 7   | Tauri updater 插件（原生侧）                          |
| `agentAura`               |      1 | 阶段 7   | 悬浮窗恢复后一并处理                                  |

方法计数以 `src/shared/ipc/channels.ts` 为准（合计约 200 个 invoke 通道）。

## 行为差异说明

| 主题                     | Electron                     | Tauri（第一阶段）                                               |
| ------------------------ | ---------------------------- | --------------------------------------------------------------- |
| `system.info().platform` | `darwin` / `win32` / `linux` | 同样映射（渲染层无感）                                          |
| `system.info().versions` | electron/chrome/node 实值    | electron/chrome 空串；node = sidecar 版本（未启动时空串）       |
| `system.info().packaged` | `app.isPackaged`             | `!debug_assertions`（dev 构建恒 false）                         |
| 帧拖拽                   | `-webkit-app-region: drag`   | mousedown shim → `window_start_drag`（WKWebView 忽略 CSS 属性） |
| Agent 流式事件           | Pi SDK → webContents.send    | Pi SDK → 运行时 → JSONL → Rust → `pi-harness:agent:*` 事件（同 payload 形态） |
| 运行时崩溃恢复           | 不适用（进程内）              | `RuntimeStatusBanner` + `runtime.restart()`（Crashed 后可重启） |
| 悬浮窗（overlay）        | 第二 BrowserWindow           | 未实现（入口未开放，无影响）                            |
| 深度链接 / 单实例        | Electron 协议                | 阶段 7                                                          |
| 自动更新                 | electron-updater             | 阶段 7（Tauri updater 插件）                                    |

## `PiSwitchAPI` 之外的差异

- `window.piSwitchOverlay`（overlay 预载桥）在 Tauri 下不存在；
  overlay.html 不进入 Tauri 构建入口。
- `window.minimize / maximizeToggle / close`（TitleBar 兜底用的裸 window 函数）：
  Electron 下由 webContents 挂载；Tauri 下不存在 — TitleBar 实际调用
  `api.window.*`，兜底路径只在桥缺失时触发（与浏览器直开 Electron 构建
  的现状一致）。
