# Performance final

## Electron legacy

见 [baseline.md](./tauri-migration/baseline.md)。已安装 `.app` 502MB，空闲 RSS 约 995MB / 7 进程。那是阶段 1 的 `ps`，不是本轮复测。

## Tauri Phase 6

见 [phase-6-report.md](./tauri-migration/phase-6-report.md)。`.app` 425MB，DMG 129MB。GUI RAM 未测。

## Tauri Phase 7

Sidecar time-to-ready：median **151ms**（20 次）。Phase 6 没有同口径 sidecar 数字，所以 **没有 before/after 百分比**。

GUI Cold Start / Idle RAM / Agent RAM / CPU：未测。不写改善百分比。

## 回归预算

性能变化超过 10% 必须解释。本轮没有可对比的 GUI 序列，不能宣称优化收益。
