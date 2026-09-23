# Pi-Harness Tauri Phase 7 Hardening Report

## Branch

`refactor/tauri-v2-hardening`，合并目标 `origin/main-tauri`。

未合并 `origin/main`。未改 `origin/main-electron`。

`origin/main-electron` 是 Electron 产品线，写在 `AGENTS.md`。

## Phase 6 Baseline

Phase 6 仍是 **NOT READY FOR MERGE**。签名、公证、跨平台 CI 产物、干净机器安装、updater E2E、5-run GUI benchmark 都没过。Phase 7 没有假装这些已经修好。

## Architecture Changes

生命周期收口、协议握手、空闲休眠、崩溃环、事件序号间隙。没有新 Agent / Provider / 主题。

版本对齐到 1.7.0（`package.json` 已是 1.7.0，Cargo.toml / tauri.conf.json 从 1.6.0 补齐）。

## Runtime Lifecycle

`stopped | starting | ready | busy | stopping | crashed | restarting | failed`

`ready` = handshake 成功。`busy` = `runtime.activity` 报告 agent 或 Pi 安装进行中。

## Runtime Idle Shutdown

默认 10 分钟。轮询 `runtime.activity`。agent 在跑或安装任务 `pending|running` 时不关。

`PI_HARNESS_RUNTIME_IDLE_MS=0` 关闭。`PI_HARNESS_RUNTIME_IDLE_POLL_MS` 改轮询间隔。

## Runtime Wake Up

`desktop_request` 在 `stopped` / `crashed` 时自动 `start()`。`failed` 不自动拉起。

## Crash Loop Protection

5 分钟内意外退出 ≥ 3 次 → `failed`。`restart()` 清计数。单测在 `lifecycle.rs`，没有用真实崩溃进程打满 3 次。

## Runtime Protocol

`runtime.handshake`。桌面协议 ≠ 1 时 `RUNTIME_PROTOCOL_MISMATCH`。清单在 `runtime/src/protocol/manifest.ts`。

## RPC Contract

已有 `createMethodRegistry`。本阶段加上 handshake / activity，没有再拆 `packages/runtime-protocol`。Rust 与 TS 的 `PROTOCOL_VERSION` 仍是两边各一份常量，靠启动握手和 `pnpm check:version` 卡住版本，不是代码生成。

## Event System

Domain 事件走 sidecar。Desktop 事件走 Rust。UI 事件留在 renderer。`generationId` 打在事件信封上。

## Event Backpressure

Agent token 仍是既有 16ms `AgentEventBatcher`。广播通道 1024；转发器 lagged 时打日志，不丢 critical 的保证没有新证明。序号空洞计数 `eventGaps`，不 panic。

## Streaming Performance

未做新的 renderer 优化，未测 token CPU。

## Large Session Performance

未引入虚拟列表。未测 100/500/1000 条消息的 DOM。

## Workspace Performance

未测 10k/50k 文件。Watcher 已有：根目录变化时 `unwatch` 旧根再 `watch` 新根（`workspace/watcher.rs`）。

## Git Performance

未测大仓库。Git 子进程是一次 `Command` 一次退出，没有长期残留句柄。未做进程表采样。

## Multi-Agent Stress

未跑 5 agent / 20 task。

## Memory Leak Audit

未做 100 次 GUI 循环。sidecar 重启 20 次只证明能起来，不证明 RSS 平坦。

## Process Leak Audit

退出仍是 `runtime.shutdown`，5s 后丢 stdin，`kill_on_drop`。未做 50 次宿主级重启的 `ps` 复查。Node `uncaughtException` / `unhandledRejection` 会 shutdown。

## Watcher Audit

代码路径会 unwatch 被移除的 workspace root。未做切换工作区的运行时计数。

## Diagnostics

`runtime.status` 增加 `generationId`、`uptimeMs`、`crashLoop`、`eventGaps`。`runtime.activity` 带 `process.memoryUsage()`。没有新的 Diagnostics 页面，没有遥测上传。

## Logging

沿用 stderr → 宿主日志事件。没有新的轮转实现。

## Security

capabilities 未放宽。没有新的 shell。URL allowlist 未改。

## Secret Audit

没有把私钥写进仓库。doctor 不读 API Key。

## Dependency Audit

未跑 `cargo audit` / `pnpm audit` 作为门禁。依赖没有为 Phase 7 升级。

## Bundle Analysis

未跑 rollup-plugin-visualizer。未重打安装包。

## Renderer Code Splitting

未改。既有 Vite chunk 警告还在。

## Runtime Bundle Size

未重打。Phase 6 口径：`Resources/runtime` 238MB，Node 139MB。

## Architecture Cleanup

新增 `docs/architecture-rules.md` 和 `docs/development/`。没有删 Electron 源码。`pnpm dev` 仍是 Electron；Tauri 是 `pnpm dev:tauri`。

## Electron Leftover Audit

**故意保留。** Electron 产品在 `origin/main-electron`。Tauri 树里的 `src/main`、`electron-builder`、`electron-updater` 还在，因为 Phase 6 生产门禁没过。

## Stress Tests

`pnpm test:stress`：20 次 sidecar 重启。

|  | ms |
| --- | ---: |
| min | 141 |
| median | 151 |
| max | 163 |
| mean | 151 |

## Soak Test

未做 30–60 分钟。

## Benchmark

### Cold Start

Before: 未测
After: 未测
Change: n/a

Sidecar time-to-ready median 151ms，不是 GUI 冷启动。

### Idle RAM

Before: 阶段 1 Electron ≈ 995MB（旧口径）
After: 未测
Change: n/a

### Runtime Running RAM

Before: 未测
After: 未测
Change: n/a

### Agent Streaming RAM

Before: 未测
After: 未测
Change: n/a

### Multi-Agent RAM

Before: 未测
After: 未测
Change: n/a

### CPU

Before: 未测
After: 未测
Change: n/a

### Runtime Startup

Before: Phase 6 无同口径数字
After: median 151ms / max 163ms（20 次）
Change: 无 before，不计算百分比

## Regressions

握手从 `runtime.version` 改成 `runtime.handshake`。旧的未重建 `runtime/dist` 会 `METHOD_NOT_FOUND`。发布包必须带新 sidecar。

## Known Issues

- GUI 性能仍无数据
- 大会话没有虚拟列表
- 协议类型没有生成到 Rust
- 崩溃环没有用真实三次崩溃做集成测试
- 安装包未在本轮重打

## Release Blockers

Phase 6 的签名、公证、CI 产物、干净机器、updater E2E 仍在。Phase 7 不能发 Stable。

## Non-blocking Issues

`pnpm lint` 仍有 `prepare-mac-repair-app.mjs` 的 2 个既有 console warning。

## Commands Verified

```text
pnpm check:version   PASS  1.7.0
pnpm doctor          PASS
pnpm typecheck       PASS
pnpm lint            PASS（2 个既有 warn）
pnpm test            PASS  1011 passed / 7 skipped
pnpm runtime:build   PASS
pnpm test:stress     PASS  20 cycles, median 151ms
cargo fmt --check    PASS（fmt 之后）
cargo clippy -D warnings  PASS
cargo test supervisor + forwarding + lifecycle  PASS
```

`pnpm build`（Electron 全平台）未跑。`pnpm build:tauri` 本轮未重打。

## Production Build

未产生新的 `.app` / `.dmg`。上一轮 Phase 6 产物是 1.6.0，不能代表 1.7.0 + handshake。

## Final Architecture Status

Desktop 可以在 runtime `failed` 时留在界面上。Runtime 可以手动重启，空闲可以关，下次 RPC 可以再开。这些是代码和单测，不是生产安装验证。

## Final Recommendation

**NEEDS MORE HARDENING**

不是 READY FOR LONG-TERM DEVELOPMENT。缺 GUI benchmark、安装包复验、签名公证、崩溃环的真实进程测试。
