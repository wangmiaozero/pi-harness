# Phase 5：Providers + Models + Config + Skills + Environment

对应任务 `task/16-Pi 生态里最好用.md`。

## Branch

`refactor/tauri-v2`（未改 `main`，未删 Electron）

## Architecture

```text
Vue 3
  → Platform Bridge (src/platform/tauri.ts)
    → Tauri 2 / Rust
        ├── EnvironmentResolver（login-shell PATH）
        ├── Clipboard / open URL / dialog
        ├── Backup folder / logs folder
        └── RuntimeSupervisor
              │ JSONL RPC
              ▼
        Node sidecar
          ├── Providers / Models / Pi Config
          ├── Skills / Packages / Capabilities
          ├── Settings / Backup / Diagnostics / Logs
          └── EnvironmentManager（install / update / cancel）
```

Vue 不直接 `invoke`。Pi 生态逻辑不进 Rust。

## Providers

sidecar `ProviderService`（从 Electron 移植）。CRUD + testConnection + discoverModels。
返回值 mask。数据仍是 Pi `models.json` + userData `metadata.json`。

## Models

`provider + modelId` 组合。`setActive` 与 Agent / Harness / Git AI commit 同一数据源。

## Pi Config

validate → backup → atomic write → reload。chokidar → `config.changed`。
conflict snapshot 保留。不轮询。

## Skills

builtin / global / project / third-party。CRUD + market。

## Packages

npm/git argv，非 shell。与环境安装互斥锁。

## Capabilities

仅受信 catalog id。`openHomepage` 只打开 `https://github.com/`。

## Environment Detection

Rust 合并 login-shell PATH + nvm/fnm/Volta/Homebrew。
sidecar `pi.detect` 复用 Electron EnvironmentManager。

## Node / npm / Pi

Node ≥ 22。Windows `.cmd`。sidecar 启动注入合并 PATH。

## Install / Update Flow

`pi.install` / `bootstrap` / `installNode` / `reinstall` / `update` / `cancel`
在 sidecar；进度事件 `environment.install-task`。RPC 超时 10 分钟。

## Process Supervisor

RuntimeSupervisor `kill_on_drop`。安装取消走 AbortController。
宿主不经 shell 拼用户字符串。

## Backup

userData/backups，不进 `~/.pi`。`openFolder` 为 Rust。

## Diagnostics

sidecar 聚合 + redact。`copy` clipboard、`export` save dialog 在 Rust。

## Logs

sidecar 读 `logs/main.log`；`openFolder` 为 Rust。

## Secret Security

macOS Keychain `!command`。其它平台 AES-256-GCM vault（`secrets.bin`）。
不造第二套 secret store。日志 / diagnostics 脱敏。

## Agent Integration

Active model 与 Agent start / Harness setModel 同一 metadata。

## Multi-Agent Integration

Orchestration 仍走已有 sidecar；本阶段不改调度。

## Tests

- `pnpm test`：166 files，981 passed，5 skipped
- `cargo test`：31 passed（含 environment snapshot + runtime forwarding）
- clippy `-D warnings` 通过

## macOS Verification

本机 darwin：login-shell PATH、Keychain 路径、pbcopy、`open` URL allowlist。
未做完整 GUI 点击（无交互式 Tauri 窗口验收）。

## Windows Compatibility

`.cmd` 解析、clip、user PATH 合并已写。未在 Windows CI 实跑。

## Linux Compatibility

xdg-open / wl-copy|xclip / login shell。未在 Linux CI 实跑。

## Electron Compatibility

PASS。`pnpm test` 含 Electron 服务单测，未删 main 实现。

## Tauri Status

PASS（命令/桥/sidecar/Rust 单测）。`pnpm build:tauri` 见 Commands。

## Commands Verified

```text
pnpm typecheck     PASS
pnpm lint          PASS（2 个既有 console warn）
pnpm test          PASS  981 / 5 skipped
pnpm runtime:build PASS
cargo fmt --check  PASS
cargo clippy -D warnings  PASS
cargo test         PASS
```

`pnpm dev:electron` / `pnpm dev:tauri` / `pnpm build:tauri` 需本机 GUI，未在本轮交互启动。

## Compatibility Matrix

见 [compatibility-matrix.md](./compatibility-matrix.md)。Phase 5 命名空间已 ✅。
剩余：`sessions.export` / `updater` / `agentAura`。

## Performance Observations

`skills.list` / `diagnostics.get` 会跑真实 `pi --version` + login shell，单测需 30s timeout。
sidecar 比 Electron 主进程多一次 JSONL hop，业务路径未重写。

## Known Issues

- runtime `desktop/` + `vendor/shared` 是 Electron 移植副本（`// @ts-nocheck`），与 `src/main` 可能漂移；`runtime/scripts/port-desktop-services.mjs` 可再生成。
- 非 macOS vault 不再用 Electron `safeStorage`（DPAPI/libsecret），改 AES-GCM；macOS Keychain 不变。
- `sessions.export` / `exportProject` 仍 pending。

## Blockers

无。

## Risks

- 安装任务在 sidecar 内；若需 OS 级进程树 kill，后续可把 spawn 收到 Rust ProcessSupervisor。
- Finder PATH 依赖 login shell；异常 shell rc 可能拖慢 detect。

## Files Added

- `runtime/src/desktop/**` `runtime/src/vendor/shared/**` `runtime/src/compat/**`
- `runtime/src/desktop-host.ts` `runtime/src/protocol/domain-desktop-methods.ts`
- `src-tauri/src/environment/mod.rs` `src-tauri/src/commands/desktop.rs`
- `docs/tauri-migration/environment.md` `providers.md` `phase-5-report.md`

## Files Modified

- `src/platform/tauri.ts` 与测试
- `runtime/src/services.ts` `dispatch.ts` `index.ts` `domain-methods.ts`
- `src-tauri/src/lib.rs` `process/mod.rs` `runtime/supervisor.rs` 事件转发
- 兼容矩阵 / 迁移计划 / README

## Next Phase Recommendation

Phase 6：Updater / Installer / Signing / Release / Benchmark。不要删 Electron。
