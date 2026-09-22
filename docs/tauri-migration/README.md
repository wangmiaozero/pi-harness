# Tauri 2 迁移（第六阶段进行中）

> 状态：第六阶段（Production Release）— **未达 READY FOR MERGE**，Electron 未退役
> 分支：`refactor/tauri-v2`

本目录记录 Pi-Harness 从 Electron 迁移到 Tauri 2 的架构、协议与迁移计划。

- [architecture.md](./architecture.md) — 目标架构与模块职责
- [protocol.md](./protocol.md) — JSONL RPC 协议规范（Rust ↔ Node）
- [runtime.md](./runtime.md) — 运行时生命周期（懒启动 / 崩溃恢复 / 停机）
- [agent-runtime.md](./agent-runtime.md) — 运行时侧 Agent/Session/Harness 架构
- [events.md](./events.md) — 流式事件链路与顺序保证
- [migration-plan.md](./migration-plan.md) — 分阶段迁移计划与当前进度
- [compatibility-matrix.md](./compatibility-matrix.md) — `window.piSwitch` API 兼容性矩阵
- [phase-2-report.md](./phase-2-report.md) — 第二阶段交付报告与验收场景状态
- [phase-3-report.md](./phase-3-report.md) — 第三阶段交付报告
- [phase-4-report.md](./phase-4-report.md) — 第四阶段交付报告
- [phase-5-report.md](./phase-5-report.md) — 第五阶段交付报告
- [phase-6-report.md](./phase-6-report.md) — 第六阶段发布报告
- [workspace.md](./workspace.md) — Workspace / Dialog / Binding
- [filesystem-security.md](./filesystem-security.md) — 文件读写边界
- [path-authorization.md](./path-authorization.md) — Authorized roots
- [git.md](./git.md) — Git CLI / AI commit
- [worktree.md](./worktree.md) — Worktree 布局与 Orchestration
- [providers.md](./providers.md) — Providers / Models / Config / Skills
- [environment.md](./environment.md) — PATH / Node / Pi install
- [runtime-packaging.md](./runtime-packaging.md) — 生产 sidecar / 内置 Node
- [updater.md](./updater.md) — Tauri updater
- [legacy-migration.md](./legacy-migration.md) — Electron userData 迁移
- [rollback.md](./rollback.md) — 回滚策略
- [windows-packaging.md](./windows-packaging.md) — NSIS / WebView2
- [linux-packaging.md](./linux-packaging.md) — AppImage / WebKitGTK
- [control-plane.md](./control-plane.md) — Runs / Policy / Checkpoint / Evaluation
- [orchestration.md](./orchestration.md) — Multi-Agent 状态机
- [scheduler.md](./scheduler.md) — Task 调度与依赖
- [crash-recovery.md](./crash-recovery.md) — Runtime / Orchestration 崩溃恢复
- [runtime-data-model.md](./runtime-data-model.md) — Session / Run / Task 关系
- [baseline.md](./baseline.md) — Electron 基线指标（内存 / 体积 / 进程数）
- [benchmark.md](./benchmark.md) — Tauri 第一阶段实测与基线对比

## 核心原则

1. **UI 不重写**。Vue 渲染层（`src/renderer`）保持不动，只替换桌面外壳。
2. **单一平台桥接层**。渲染进程只依赖 `window.piSwitch` 抽象（`src/platform/`），
   任何页面/组件/store 不得直接调用 `invoke()` / `listen()`。
3. **Pi 生态保持 Node.js**。Pi SDK（`@earendil-works/pi-coding-agent`）等核心逻辑
   不迁移到 Rust，而是作为 Node sidecar 进程由 Rust 宿主管辖。
4. **崩溃隔离**。Node sidecar 崩溃只影响 `runtime` 命名空间，外壳与 UI 存活。
5. **懒启动**。运行时不随应用自启；首个依赖运行时的功能调用时才 spawn。

## 仓库布局（第一阶段新增）

```
src/platform/        # 平台桥接层（renderer 可见）
src-tauri/           # Rust 桌面宿主（Tauri 2）
runtime/             # Node.js 运行时 sidecar（独立包，零依赖）
vite.tauri.config.ts # Tauri 渲染层构建配置（Electron 用 electron.vite.config.ts）
docs/tauri-migration/  # 本目录
```

## 快速开始

```bash
pnpm install            # 安装 @tauri-apps/api + @tauri-apps/cli
pnpm dev:tauri          # 启动 Tauri 开发模式（自动先构建 runtime）
pnpm test               # 单测（含平台桥接层与 runtime 协议测试）
cargo test              # 在 src-tauri/ 下运行 Rust 测试（真实拉起 Node sidecar）
```
