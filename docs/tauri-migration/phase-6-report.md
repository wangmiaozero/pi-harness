# Pi-Harness Tauri Migration Phase 6

## Branch

`refactor/tauri-v2`（未改 `main`，未 merge，未删 Electron）

## Release Readiness

**NOT READY FOR MERGE**

依据是 production readiness，不是任务完成比例。
签名、公证、跨平台 CI 产物、干净机器安装、updater E2E、5-run GUI benchmark
均未过 Production Gate。Electron 必须继续作为 dual-shell 保留。

## Final Architecture

```text
Vue 3
  → Platform Bridge (src/platform/tauri.ts)
    → Tauri 2 / Rust Desktop Host
        ├── Window / Dialog / Single-instance
        ├── Filesystem Security / Authorized roots
        ├── Workspace / Git / Worktree
        ├── EnvironmentResolver + Process Supervisor
        ├── RuntimeSupervisor
        ├── Backup / Diagnostics
        ├── Updater (tauri-plugin-updater)
        └── migrate.rs（packaged 共用 Electron userData）
              │ JSONL RPC
              ▼
        Node sidecar（随包 Node + runtime/ + Pi SDK）
          ├── Session / Agent / Harness
          ├── Control Plane / Orchestration
          ├── Providers / Models / Config
          └── Skills / Packages / Capabilities
```

Vue 不直接 `invoke`。Pi 生态逻辑不进 Rust。

## Production Build

本机 `pnpm build:tauri` **PASS**（darwin arm64，2026-09-22）。

产物：

- `src-tauri/target/release/bundle/macos/Pi-Harness.app`
- `src-tauri/target/release/bundle/dmg/Pi-Harness_1.6.0_aarch64.dmg`
- `node scripts/verify-tauri-release.mjs` PASS（`1.6.0`）

代码签名为 **adhoc / linker-signed**，`TeamIdentifier=not set`。
不是 Signed Production Build。

## Runtime Packaging

`scripts/stage-tauri-runtime.mjs`（`beforeBuildCommand`）：

- `runtime/dist` → `Resources/runtime/`
- `npm install --omit=dev --ignore-scripts` 四个 `@earendil-works/pi-*`
- 官方 `nodejs.org/dist` 当前构建目标 Node 二进制 → `Resources/runtime-node/node`
- `resources/builtin-skills` → `Resources/builtin-skills/`

实测打进 `.app`：

| 路径 | 大小 |
| --- | ---: |
| `Contents/MacOS`（宿主二进制） | 44 MB |
| `Contents/Resources/runtime`（sidecar + Pi SDK） | 238 MB |
| `Contents/Resources/runtime-node/node` | 139 MB |
| `Contents/Resources/builtin-skills` | 732 KB |

无首启下载 Node。未做单文件 bundling。
staging 剥离 pnpm 注入的 `npm_config_*`，避免 Node 26 `EALLOWSCRIPTS`。

## Runtime Node Strategy

| 进程 | Node |
| --- | --- |
| Desktop Runtime sidecar | 随包二进制（env → bundled resources → login-shell PATH） |
| 用户 Pi CLI | 仍检测系统 Node / nvm / fnm / Volta / Homebrew |

`cargo test` / `dev:tauri` 继续用 PATH `node` + 仓库 `runtime/dist`。

## Tauri Updater

`piSwitch.updater.{state,check,download,install,openReleasePage}`
→ Rust `updater_*` → `tauri-plugin-updater`。

状态机保留 Electron 语义：`idle / checking / available / not-available /
downloading / downloaded / installing / manual-update / error`。

无签名 `latest.json` 时插件 check 失败，回落 GitHub Releases API，
状态 `manual-update`，用户走 `openReleasePage`。
下载失败不覆盖当前安装。`install` 后 `app.restart()`。

## Update Signing

`tauri.conf.json` 已写入 minisign **公钥**。
私钥约定只放 GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

仓库内 **没有** 私钥。当前公钥是本地生成的占位，**未** 配到 GitHub Secrets，
**未** 用于真实 Release 签名。在 Secret 配好并发布签名 `latest.json` 之前，
自动更新不能作为生产通道。

## Legacy Data Migration

`migrate.rs`，`schemaVersion = 1`（`tauri-migration.json`）。

- Packaged + 已有 Electron `Pi-Harness` 数据：共用该目录，备份
  `migration-backup-<unix>/`，不删除 Electron 文件。
- Packaged 全新安装：写 marker，用 Tauri `app_data_dir`。
- Dev：用自己的 `app_data_dir`，不抢 `Pi-Harness-dev`。
- `~/.pi/agent` 不复制。

单测：`fresh_install_writes_marker`、`packaged_share_is_idempotent`。

## Rollback Strategy

| 场景 | 做法 |
| --- | --- |
| 更新下载/校验失败 | 当前安装继续可用 |
| Tauri RC 不可用 | 重装最后 Electron Stable；userData 仍在 `Pi-Harness` |
| 迁移后 JSON 异常 | 从 `migration-backup-<timestamp>/` 拷回 |
| 需要回退架构 | 继续 dual-shell；本分支未删 Electron |

## macOS arm64

本机 `pnpm build:tauri` 产出 `.app` + `.dmg`。Unsigned / adhoc。

## macOS x64

未在本机构建。CI 矩阵写了 `macos-13` + `x86_64-apple-darwin`，未跑。

## macOS Signing

**FAIL**。adhoc only。无 Developer ID / `APPLE_CERTIFICATE` 实签。

## macOS Notarization

**FAIL**。未提交公证，未 staple。

## Windows x64

未构建。文档见 [windows-packaging.md](./windows-packaging.md)
（NSIS + WebView2 `downloadBootstrapper`）。CI 矩阵已写，未跑。

## Windows Signing

**FAIL**。Authenticode Secret 未接入。

## Linux

未构建。文档见 [linux-packaging.md](./linux-packaging.md)
（AppImage + WebKitGTK 4.1）。CI 矩阵已写，未跑。

## GitHub Actions

新增 `.github/workflows/release-tauri.yml`：

- trigger：`tauri-v*` tag 或 `workflow_dispatch`
- draft + prerelease
- 不替换 Electron `release.yml`（仍 `v*`）
- 质量门：`check:version` / typecheck / lint / test / clippy / cargo test
- 矩阵：macOS arm64 / macOS x64 / Windows x64 / Linux x64

`.github/workflows/ci.yml` 增加 `pnpm check:version`。Electron E2E 仍在。

**本轮未触发该 workflow，无 CI 产物。**

## GitHub Release

无 Tauri GitHub Release。未打 `tauri-v*` tag。Electron Stable Release 未动。

## Fresh Install

**FAIL**。未在干净机器安装 DMG。仅本地构建验证文件布局。

## Electron → Tauri Upgrade

**FAIL**。未做真实用户数据升级演练（只做了 `migrate.rs` 单测）。

## Updater Upgrade Test

**FAIL**。无签名 `latest.json`，无法 E2E 自动安装。GitHub fallback 代码存在，未对真实 Release 点过。

## Crash Recovery

RuntimeSupervisor 崩溃隔离与世代计数在前序阶段已测（`cargo test` 含
lifecycle + event forwarding）。本阶段 **没有** 新的生产安装包崩溃演练。

## Security Audit

本地静态审查，非正式第三方审计。

PASS（代码层）：

- CSP 已设（`script-src 'self'`，无 `unsafe-eval`）
- capabilities：`core:default` `dialog:default` `updater:default` `process:default`；
  **无** `fs:default` / `shell:default`
- 工作区路径过 authorized roots
- URL 打开仅 `https://github.com/` / `https://nodejs.org/`
- git / sidecar spawn 走 argv，不经 shell 拼接用户字符串
- login-shell `-c` 为常量 `printf %s "$PATH"`
- staging `npm install --ignore-scripts`
- 仓库无 updater 私钥；`.gitignore` 含 `*.key` / `*.pem` / `secrets.bin`
- 迁移不删除 Electron 数据
- 渲染层 `eval` / 生产 `innerHTML` 未新增

残留风险：

- 随包 Node 是完整 Node，sidecar 不是 OS sandbox
- adhoc 签名，Gatekeeper 会拦
- 公钥为占位，生产必须轮换
- `process:default` 覆盖 restart（updater 需要），权限大于「只重启」
- `runtime/compat/electron.js` 是移植 stub，不是 Electron Framework

## Feature Compatibility

见 [compatibility-matrix.md](./compatibility-matrix.md)。

已接线：`sessions.export` / `exportProject`、`updater.*`。
仍 pending：`agentAura`（入口未开放，非 release blocker）。
overlay / 深度链接：Electron 无自动打开 overlay、无自定义协议；Tauri 不新增。

## Benchmark Environment

- 机型：Apple Silicon darwin arm64
- 日期：2026-09-22
- Electron 对照：`/Applications/Pi-Harness.app` v1.6.0，`du -sh` = **502 MB**
- Tauri：本轮 `pnpm build:tauri` 产物
- **未** 做 5-run GUI 冷启动 / Idle RAM / Agent RAM（无交互验收窗口协议）

## Benchmark Results

### Installer Size

Electron: 未在本轮重打 `pnpm build:mac`；已安装 `.app` 502 MB（安装体积，非 DMG）
Tauri: **129 MB** DMG（`Pi-Harness_1.6.0_aarch64.dmg`）
Change: 安装包口径不可直接与 Electron DMG 比（本轮无 Electron DMG 实测）

### Installed Size

Electron: **502 MB**（`/Applications/Pi-Harness.app`）
Tauri: **425 MB**（`.app`）
Change: **-77 MB / -15%**（不是阶段 1 宣称的 -90%；阶段 1 的 45 MB **不含** 随包 Node + Pi SDK）

宿主二进制 44 MB；体积主体是 sidecar（238 MB）+ Node（139 MB）。

### Cold Start

Electron: 未测
Tauri: 未测
Change: n/a

### Idle RAM

Electron: 基线 ≈ 995 MB / 7 进程（[baseline.md](./baseline.md)，阶段 1）
Tauri: 阶段 1 空闲宿主 ≈ 95 MB（**当时 sidecar 未打进包、未启动**）
Change: 本轮 **未复测** 含 bundled Node 的 GUI RSS

### Runtime Running RAM

未测

### Agent Streaming RAM

未测

### Multi-Agent RAM

未测

### CPU

未测

## Benefits Observed

- 生产包自带 Node + Pi SDK，不再依赖用户先装 Node 22。
- updater 状态机与 Electron UI 对齐；无签名时降级 `manual-update`。
- packaged userData 与 Electron 共用，dual-shell 回滚路径保留。
- 单实例插件就位；CI 与 Electron Release 分流（`tauri-v*` vs `v*`）。
- 本机 `.app` 比已装 Electron 小 15%；进程模型仍是 1 宿主 + 按需 sidecar。
- `sessions.export` 不再 pending。

## Regressions Observed

- 安装体积从阶段 1 的 45 MB 升到 425 MB（预期：打进 SDK + Node）。
- adhoc 签名，不能当生产分发。
- `pnpm lint` 仍有既有 `prepare-mac-repair-app.mjs` console warning（2）。
- 包内存在 `runtime/compat/electron.js` 文件名（stub，非 Electron 运行时）。

## Known Differences

- Dev Tauri 不共用 `Pi-Harness-dev`。
- `system.info().versions.electron/chrome` 空串；`packaged` 用 `!debug_assertions`。
- overlay / agentAura 未实现。
- GitHub PR git action `available: false`（前序阶段已记录）。
- 非 macOS secret 为 AES-GCM vault，不再用 Electron `safeStorage`。
- updater 公钥是占位，自动更新通道未启用。

## Release Blockers

1. macOS Developer ID 签名 + 公证 **FAIL**
2. Windows Authenticode **FAIL**
3. `release-tauri.yml` 未实跑，无 GitHub 产物 **FAIL**
4. 干净机器安装 / 升级演练 **FAIL**
5. 签名 updater E2E（`latest.json` + 下载安装）**FAIL**
6. 5-run GUI benchmark（冷启动 / RAM / CPU）**FAIL**
7. 生产 minisign 私钥未进 Secrets，公钥需轮换 **FAIL**

## Non-Blocking Issues

- `agentAura` / overlay 仍 pending
- Node 26 staging 需 `--ignore-scripts` + 清理 pnpm `npm_config_*`
- release profile 必须 `[profile.release.build-override] strip = false`，否则
  `futures-macro` E0463
- WebView2 离线机需 Evergreen Runtime（`downloadBootstrapper`）
- Linux 用户需 WebKitGTK 4.1

## Electron Retirement

**Not Completed**

任一关键 Production Gate FAIL → 保持 dual-shell。未删除 Electron。

## Removed Electron Files

无。`src/main/`、`src/preload/`、`electron-builder.yml`、
`.github/workflows/release.yml`、`pnpm build` / `dev:electron` 全部保留。

## Removed Electron Dependencies

无。`electron` / `electron-builder` / `electron-updater` / `electron-vite` 仍在。

## Tests

- `pnpm test`：167 files，**991 passed**，5 skipped
- `cargo test`：32 lib + 1 integration = **33 passed**
- clippy `-D warnings` 通过
- `pnpm check:version`：`1.6.0` ok（package.json / Cargo.toml / tauri.conf.json）

## Commands Verified

```text
pnpm check:version     PASS  1.6.0
pnpm typecheck         PASS
pnpm lint              PASS（2 个既有 console warn）
pnpm test              PASS  991 / 5 skipped
pnpm runtime:build     PASS
cargo fmt --check      PASS
cargo clippy -D warnings  PASS
cargo test             PASS  33
pnpm build:tauri       PASS  darwin-arm64 .app + .dmg
node scripts/verify:tauri-release  PASS
```

`pnpm dev:electron` / `pnpm dev:tauri` / 干净机器安装 / updater E2E / 5-run GUI
本轮未交互启动。

## CI Results

本轮仅本地。`release-tauri.yml` 未触发。`ci.yml` 未在 GitHub 上跑此提交。

## Release Artifacts

本地：

- `Pi-Harness.app` 425 MB
- `Pi-Harness_1.6.0_aarch64.dmg` 129 MB

未上传 GitHub。Electron Release 未覆盖。

## Documentation

- [runtime-packaging.md](./runtime-packaging.md)
- [updater.md](./updater.md)
- [legacy-migration.md](./legacy-migration.md)
- [rollback.md](./rollback.md)
- [windows-packaging.md](./windows-packaging.md)
- [linux-packaging.md](./linux-packaging.md)
- [architecture.md](./architecture.md)
- [compatibility-matrix.md](./compatibility-matrix.md)
- [migration-plan.md](./migration-plan.md) 阶段 7 🚧，未删 Electron

## Risks

- 占位 minisign 公钥若原样进生产，任何人无法（也不应）用仓库里不存在的私钥签名；
  必须在 Secrets 中生成并替换公钥后再发 RC。
- 425 MB `.app` 的收益叙事不能再用阶段 1 的「-90% 磁盘」。
- 共用 userData 意味着 Tauri bug 可能写坏 Electron 也能读的 JSON；
  备份目录是唯一本地回滚点。
- 随包 Node 139 MB 未 strip 调试符号以外的官方二进制；后续可评估精简。

## Final Recommendation

**NOT READY FOR MERGE**

下一步（仍在 `refactor/tauri-v2`，仍 dual-shell）：

1. 轮换生产 updater 密钥，写入 GitHub Secrets
2. 配置 Apple / Windows 签名并跑 `tauri-v*` draft RC
3. 干净机器安装 + Electron→Tauri 升级 + updater E2E
4. 5-run GUI benchmark 填真实 RAM / 冷启动
5. 全部 PASS 后再单独 commit 退役 Electron

在此之前禁止：merge `main`、删除 Electron、覆盖 Electron Stable Release、force-push。
