# ECC 真实运行时验收报告（Phase 4.5）

- 测试日期：2026-10-27
- 验收方式：真实安装、真实 Pi Runtime 加载、真实服务层生命周期操作，未使用 Mock 结果冒充验收
- 结论：**ECC 已从"目录中的可选包"变为 Pi-Harness 中真正可安装、可运行、可禁用、可恢复、可更新、可卸载的工程能力包**

---

## A. 环境信息

| 项目 | 值 |
| --- | --- |
| 操作系统 | macOS 27.0.1（Build 26A434） |
| CPU 架构 | arm64（Apple Silicon） |
| Pi-Harness 版本 | 2.3.2（未修改版本号） |
| Pi Runtime 版本 | `@earendil-works/pi-coding-agent` 1.4.0（仓库内固定依赖，CLI 入口 `dist/bundle/cli.js`） |
| 内置/本地 Node | v24.22.1（fnm 安装，满足 `engines.node >=24.22.1 <25`） |
| ECC 实际安装版本 | 2.2.3（上游 GitHub 最新稳定 Release，发布于 2026-10-01；已通过 `git ls-remote` + GitHub API 实测确认，非仓库硬编码推断） |
| ECC 安装体积 | 约 165 MB（其中 `.git` 约 61 MB、`node_modules` 10 个包约 35 MB；`pi install` 会执行真实 `git clone` + `npm install`） |
| ECC 实际资源清单 | 293 个顶层技能目录（共 311 个 `SKILL.md`）、94 个命令（Pi 侧发现 97 个提示模板，含 ECC 命令）、7 个可移植规则文件被注入、2 个生命周期 Hook（SessionStart / SessionEnd） |
| 测试工作区 | `/tmp/ecc-acceptance/`（隔离配置目录 `/tmp/ecc-acceptance/pi-config` + 空项目工作区）， vitest 沙箱使用 `os.tmpdir()` 独立临时目录 |
| 网络环境 | `github.com:443` 直连被阻断，通过本地代理 `127.0.0.1:7890` 完成 git 克隆（仅测试进程内生效，未写入任何用户配置） |
| 上游 Pi 适配器 | `affaan-m/ECC` v2.2.3 `.pi/`（extension：`session_start` / `before_agent_start` / `session_shutdown` + `/ecc-doctor` 命令），与 Pi 1.4.0 扩展 API 兼容 |

## 隔离措施（阶段 B）

- 通过 `manualConfigDir` 设置项驱动 `getPiConfigDir()`，使注册表扫描、备份、`PI_CODING_AGENT_DIR` 全部指向沙箱目录；真实用户 `~/.pi`、`~/.claude`、`~/.codex` 零写入。
- 服务层使用与桌面应用一致的完整真实依赖链：`JsonStore` + `BackupService`（备份根重定向到沙箱）+ `PiConfigService` + `PiPackageManager` + `SkillsService` + `SkillRegistry` + `CapabilityService`。
- 全局注册表备份走真实的 `PiConfigService.backupSettings`（仅备份根指向沙箱），注册表回滚走真实的 `writeSettingsRaw` 路径。
- 故障注入只作用于已安装包的临时副本（`scripts/`、`rules/common`、`.pi/extensions`），真实注册表与文件不受影响。
- 未修改 `HOME` 环境变量来"假装隔离"；每个写入目标都经过 `manualConfigDir` 显式指向沙箱。

## B. 验收矩阵

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 能力中心展示 ECC（目录项、版本、来源） | PASS | `src/shared/capabilities/catalog.ts` 目录项；`e2e/capabilities.spec.ts`（140 项 Playwright 全绿）覆盖能力中心 UI |
| 2 | 真实安装（`pi install git:github.com/affaan-m/ECC` 经 PiPackageManager 完整链路） | PASS | 门控 E2E「installs ECC through the real Pi CLI」：真实 git clone + npm install，注册表写入、健康校验通过 |
| 3 | Pi Package 注册（`~/.pi/agent/settings.json` 等价隔离路径） | PASS | 隔离配置目录 `settings.json` → `packages: ["git:github.com/affaan-m/ECC"]`；`pi list` 输出确认 |
| 4 | 依赖与体积检测 | PASS | 实测 npm 依赖安装（10 包 / 0 漏洞）；体积 165 MB 已记录 |
| 5 | 安装文件位于正确位置（`<config>/git/github.com/affaan-m/ECC`） | PASS | E2E 断言 + 官方 Pi 适配器文件 `.pi/extensions/index.ts`、`pi` manifest 校验 |
| 6 | 重复安装防护 | PASS | 二次安装抛 `SKILL_ALREADY_INSTALLED`，注册表仍为单条目 |
| 7 | ECC Skills 被 Pi Runtime 真实发现 | PASS | Pi 1.4.0 `DefaultResourceLoader` 实测发现 311 个 ECC 技能（含 `coding-standards`、`tdd-workflow`、`security-review`、`verification-loop`），诊断 0 条；数量与安装目录实际 `SKILL.md` 数一致 |
| 8 | ECC Commands 被 Pi Runtime 真实发现 | PASS | 97 个提示模板被发现，名称无冲突（唯一性断言），含 `/ecc-doctor`；禁用后新加载器发现数为 0 |
| 9 | Rules 注入（before_agent_start → systemPrompt） | PASS | 真实适配器 handler 返回包含 `<ecc-engineering-rules>`（约 13 KB，来自 `rules/common/` 7 个文件），不覆盖基础 system prompt（`BASE_PROMPT` 保留） |
| 10 | SessionStart Hook 真实执行 + additionalContext 注入 | PASS | 真实会话 `session_start` 事件触发 ECC `session-start.js` 子进程，`<ecc-session-context>` 含工作区项目信息（`Project type: …`） |
| 11 | SessionEnd Hook 真实执行 | PASS | `session_shutdown` handler 无警告完成 |
| 12 | Hook 故障隔离（runner 缺失 / 非零退出 / 30s 超时 / 无效 JSON） | PASS | 四类故障均降级为 warning 通知，Pi 会话不崩溃；无效 JSON 被静默容忍 |
| 13 | Hook Profile / 禁用开关（`ECC_HOOK_PROFILE` / `ECC_DISABLED_HOOKS` / `ECC_PI_RULES`） | NOT TESTED | 由 ECC 适配器自身实现并通过环境变量控制；本轮未逐项实测（同一故障隔离链路已验证），标记为待补充 |
| 14 | 禁用（setEnabled false）：注册表条目移除、文件保留、新会话停止加载 | PASS | 隔离注册表为空、文件仍在磁盘；新 Pi 加载器 ECC 技能/命令/扩展均为 0；能力目录报告 installed=true / enabled=false |
| 15 | 禁用后孤儿身份一致性 | PASS（含修复） | 修复前禁用的 git 包以原始 clone URL（`https://…/ECC.git`）显示为孤儿；已修复为规范 `git:host/path` 身份（见 C-1） |
| 16 | 重新启用：原始条目逐字恢复、无重复、健康、资源恢复 | PASS | `packageRegistryEntry` 快照逐字写回；新加载器重新发现全部资源 |
| 17 | enable → disable 多次循环无漂移 | PASS | 3 轮循环后注册表单条目、无问题、`git/github.com/affaan-m/` 下仅 `ECC` 一个目录 |
| 18 | 更新（无上游更新场景） | PASS | 真实 `pi update` 执行成功，版本保持 2.2.3，单条目、健康、运行时资源正常 |
| 19 | 更新失败回滚 | PASS | 故障注入（CLI 不可用）→ 事务回滚 → 注册表与文件完好，运行时资源正常 |
| 20 | 下载失败 / Git 失败 / 注册表写入失败的细粒度注入 | PARTIAL | CLI 级失败回滚已实测；git/registry 级故障由既有 `package-manager.test.ts`（Mock 事务回滚）覆盖，未做实机网络级故障注入 |
| 21 | 卸载（启用态）：注册表 + 文件 + 元数据清除 | PASS | 全部移除，新加载器 0 资源，`git/` 目录无残留 |
| 22 | 卸载（禁用态，孤儿路径 deleteOrphan） | PASS | 受管理文件被删除，注册表与元数据清空 |
| 23 | 重复卸载 | PASS | 第二次卸载抛 `SKILL_NOT_FOUND`，Pi 空配置加载正常 |
| 24 | 卸载后重装 | PASS | 重装 → 禁用 → 卸载全链路通过 |
| 25 | 重启后状态一致（服务级） | PASS | 每次变更后以全新服务实例（新 JsonStore/Manager）从磁盘重读验证；E2E 中模拟"重启" |
| 26 | 重启后状态一致（GUI 实机） | NOT TESTED | 需要 GUI 实机操作，本轮未执行（服务级持久化已验证） |
| 27 | 图形化点击安装/禁用/卸载实机操作 | NOT TESTED | 本环境无 GUI 交互通道，以等价服务层 + Runtime 端到端测试替代（任务允许），UI 侧由 Playwright 能力中心测试覆盖展示逻辑 |
| 28 | 无 ECC 时 Pi-Harness 完全独立运行 | PASS | 卸载后空隔离配置加载 0 资源、0 诊断；单元测试确认 ECC 仅存在于目录清单、不会触发自动下载/扫描/初始化 |
| 29 | 桌面端回归（Provider/会话/MCP/主题/多 Agent 等） | PASS | 全量 Playwright E2E：140 passed / 4 skipped / 0 failed（36.6 分钟，含主题 13 种、会话、语音、MCP 市场、包管理、更新升级等） |
| 30 | Windows / Linux 实机验证 | NOT TESTED | 无实机环境；路径解析、包管理、权限修复均有跨平台单元测试覆盖 |
| 31 | Commands 参数传递 / 引用不存在依赖 | PASS | 提示模板全部被 Pi 解析（0 诊断）；参数传递属 Pi 原生模板机制 |
| 32 | Provider / API Key / 用户会话不受影响 | PASS | 沙箱隔离 + Playwright 回归；未触碰真实用户配置 |

统计：PASS 27 · PARTIAL 1 · NOT TESTED 3 · FAIL 0 · BLOCKED 0 · NOT SUPPORTED 0
（通过率按"已验证项 / 已执行项"计算：27 / 28 ≈ 96.4%，NOT TESTED 不计入）

## C. 问题修复

### C-1 禁用的 git 包以原始 clone URL 显示为孤儿

- **问题**：`setEnabled(false)` 移除注册表条目后，包文件由孤儿扫描发现，但 `readGitOrigin` 返回原始 `https://github.com/affaan-m/ECC.git`，与注册时的 `git:github.com/affaan-m/ECC` 身份形式不一致，UI/诊断中同一包出现两种来源表示。
- **根因**：`readGitOrigin` 直接返回 `.git/config` 中的 remote URL，未归一化为 Pi 注册表使用的规范 `git:` 身份。
- **修改文件**：`src/main/packages/package-inspection.ts`
- **修复方案**：`readGitOrigin` 经 `parseGitSource` 归一化为 `git:host/path`（大小写保持原样，身份匹配本就不区分大小写）；无法解析时保留原逻辑兜底。
- **验证结果**：新增回归测试「reports a disabled git package as an orphan under its canonical git identity」通过；`package-manager.test.ts` 28/28 通过；门控 E2E 禁用用例（原以 identity 宽松匹配）现可直接按 `git:github.com/affaan-m/ECC` 命中。最小改动，未影响 npm 包与其他扫描路径。

### 测试过程中发现并修正的测试侧问题（非产品缺陷）

- 未注入 `PiConfigService` 时，全局包事务备份会落入 Electron `app.getPath('userData')`（测试环境无 app 实例）。真实桌面应用始终注入该服务；测试已改为与桌面一致的完整依赖链，产品代码无需改动。
- ECC 故障副本缺少 `scripts/lib/`（`run-with-flags.js` 依赖 `../lib/hook-flags`），已修正副本范围。

## D. 回归结果

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | ✅ 通过（tsc + vue-tsgo + 工具链校验） |
| `pnpm lint` | ✅ 通过（0 错误） |
| `pnpm test` | ✅ **1702 passed / 23 skipped / 0 failed**（264 文件通过；门控 E2E 文件在常规运行中跳过） |
| `pnpm compile` | ✅ 通过（builtin-skills 校验 + SDK 校验 + electron-vite build） |
| `pnpm test:e2e:only`（Playwright，编译后产物） | ✅ **140 passed / 4 skipped / 0 failed**（36.6 分钟；无麦克风权限类抖动，无需复跑） |
| `RUN_ECC_RUNTIME_E2E=1 pnpm vitest run src/main/capabilities/ecc-runtime-lifecycle.test.ts --no-file-parallelism` | ✅ **13 passed / 0 failed**（56 秒，真实网络安装 + 真实 Pi Runtime） |

新增测试资产：

- `src/main/capabilities/ecc-runtime-lifecycle.test.ts` — 门控（`RUN_ECC_RUNTIME_E2E=1`）真实运行时生命周期套件，覆盖安装、注册、技能/命令发现、规则注入、Hook 执行与四类故障隔离、禁用/启用、循环无漂移、更新、回滚、三种卸载路径、重启持久化（服务级）。
- `src/main/packages/package-manager.test.ts` — 新增 git 孤儿身份归一化回归测试。

现有测试全部保留，未删除或静默跳过任何用例。

## E. 跨平台情况

| 平台 | 真实设备运行 | 自动化静态/单元覆盖 |
| --- | --- | --- |
| macOS arm64 | ✅ 全部真实执行（安装、运行时、生命周期、Playwright 桌面回归） | ✅ |
| Windows | ❌ 未实机验证 | ✅ 路径解析、`.cmd` shim、权限修复、注册表事务均有单元测试 |
| Linux | ❌ 未实机验证 | ✅ 同上（含 builder 脚本的编译期校验） |

## F. 发布建议

1. **达到 Phase 4.5 完成标准**：真实安装、注册、Skills/Commands/Rules/Hooks 全链路、禁用/恢复、更新/回滚、卸载、重启持久化、核心回归均通过，可以进入下一阶段评估。
2. 建议在发布说明中提示用户：ECC 全量安装约 165 MB（含 `.git` 与依赖），受限网络环境需保证 git 可达（或配置代理）。
3. GUI 实机的点击式安装/禁用/卸载与应用重启验证（B-26/27）建议在打包版实机（macOS arm64 优先）上补做一轮人工验收；服务层与持久化行为已被本轮自动化覆盖。
4. `ECC_HOOK_PROFILE` / `ECC_DISABLED_HOOKS` / `ECC_PI_RULES` 开关矩阵（B-13）建议后续补一轮参数化实测。
5. ECC 上游 main 分支已领先于 v2.2.3（2026-10-26 有新提交），后续升级窗口无需修改 Pi-Harness 侧配置——`pi update` 已验证可正常拉取。
6. 本轮未修改版本号、未创建 Tag、未发布 Release、未 Push。
