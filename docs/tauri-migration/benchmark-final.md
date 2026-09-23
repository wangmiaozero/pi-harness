# Benchmark final

日期：2026-09-23。机器：Apple Silicon。方法：`pnpm test:stress`（sidecar `runtime.ready`）、Phase 6 `du`。

## Sidecar startup（本轮）

20 次 spawn `runtime/dist/index.js`，读到 `runtime.ready` 即 SIGTERM。

|  | ms |
| --- | ---: |
| min | 141 |
| median | 151 |
| mean | 151 |
| max | 163 |

无 zombie 检查以外的进程表。20 次全部在 15s 超时内返回。

## 未测

Cold Start、Warm Start、Idle RAM、Runtime Running RAM、Agent Streaming RAM、Multi-Agent RAM、Idle CPU、Streaming CPU、Workspace Open、Git Status、Installer Size（本轮未重打安装包）。

Phase 6 体积见 [phase-6-report.md](./phase-6-report.md)。不要把 151ms 当成 GUI 冷启动。
