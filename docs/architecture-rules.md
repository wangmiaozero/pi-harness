# 架构边界

`origin/main-electron` 是 Electron 产品线。`origin/main-tauri` 是 Tauri 2 产品线。不要把 Tauri 分支合并进 `main` 或 `main-electron`。

## 各层能做什么

| 层 | 可以 | 不可以 |
| --- | --- | --- |
| Vue | 渲染、Pinia、路由、调用 `window.piSwitch` | `invoke`、shell、保存 Agent 真状态 |
| Platform Bridge `src/platform/` | 把 `PiSwitchAPI` 映射到 Tauri command / Electron preload | 业务状态机 |
| Rust Host | 窗口、路径授权、Git/Worktree、进程监督、Updater、Diagnostics | 重写 Pi Agent |
| Runtime | Session / Agent / Harness / Orchestration / Providers / Skills | 窗口、任意桌面路径 |
| Pi SDK | 模型、工具、会话执行 | 桌面外壳 |

## 禁令

- Vue 直接 import `@tauri-apps/api`
- Vue 直接跑 shell
- Rust 重写 Pi Agent
- Runtime 管理窗口
- UI 把真实 Agent state 当持久源
- 绕过 Platform Bridge

## 新功能放哪

先判断属于 UI、Desktop、Runtime 还是 Pi SDK，再落代码。
