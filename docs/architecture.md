# Pi-Harness 生产架构

当前发布产品仍是 **Electron**。`refactor/tauri-v2` 上的 Tauri 外壳已具备同等控制面，但 Phase 6 生产门禁未过，**尚未替代 Electron**。

目标架构：

```text
Vue 3  Control UI
    │  window.piSwitch
    ▼
Platform Bridge
    ▼
Tauri 2 / Rust Desktop Host
  Window / Filesystem / Workspace / Git / Worktree
  Environment / Process + Runtime Supervisor / Updater
    │  JSONL RPC
    ▼
Pi-Harness Runtime (bundled Node sidecar)
  Session / Agent / Harness / Orchestration
  Providers / Models / Config / Skills
    ▼
Pi Coding Agent SDK
```

Electron Main / Preload / electron-builder 在门禁通过前保留，便于回滚。
