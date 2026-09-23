# Architecture

Vue 3 → `src/platform` → Tauri 2 / Rust → JSONL RPC → Node sidecar → Pi SDK。

边界见 [architecture-rules.md](../architecture-rules.md)。

事件分三类：

- Domain：`agent.*` `harness.*` `orchestration.*` `runtime.*`，来自 sidecar
- Desktop：workspace / git / updater / window，来自 Rust
- UI：modal、toast、sidebar，只在 renderer
