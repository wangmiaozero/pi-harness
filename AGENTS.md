# AGENTS.md

本文件适用于所有在本仓库工作的 AI / Agent（Cursor、Claude、Codex、Copilot 等）。

维护者本地另有 `wangmiao-ai-docs/`（详细规则）和 `wangmiao-task/`（任务计划），两者都不提交到仓库。存在时必须在开始工作前完整阅读，从 `wangmiao-ai-docs/README.md` 开始；不存在时按本文件执行，不要自己编造内容。禁止 `git add -f` 这两个目录。

## 1. 项目
- Pi-Harness 是 Electron + Vue 3 桌面应用，是 Pi Coding Agent 的控制台和工作区。**Pi Coding Agent 是唯一的 Agent Runtime**，不实现第二套 Runtime 或 Agent Loop。
- 工具链：Node 24.22.1（`>=24.22.1 <25`）、pnpm 9.12.1。版本不对先换版本，不改代码、不放宽 `engines`。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## 2. 工作范围
- 只做当前要求的事，不扩大范围，不顺手重构无关代码。
- 开始前看 `git status`，保留与本次无关的未提交修改。
- 不删除已有功能，不破坏 Pi 的 Session、JSONL、Skills、Provider、Model 和现有配置兼容性；读写 Pi 配置时保留不认识的字段。
- 不替换技术栈：Electron、Vue、Pinia、Vitest、Playwright、electron-vite。

## 3. 架构
```text
Vue Renderer → typed preload API → validated IPC → Main service → Domain/Adapter → Pi SDK 或操作系统
```
- Renderer 不能直接使用 Node.js、文件系统、进程执行或 Pi SDK。
- 保持 `contextIsolation: true`、`nodeIntegration: false`。
- 新增 IPC 同时更新 `src/shared/ipc/channels.ts`、`src/shared/ipc/api-types.ts`、preload、Main handler 的运行时校验，并写正向和负向测试。
- 执行命令用 `spawn` / `execFile` 加参数数组，禁止把用户输入拼进 shell 命令。
- 密钥不返回 Renderer，日志要脱敏。禁止提交 `.env`、私钥、证书、API Key、Token。

## 4. 验证
只做与改动相称的验证：

| 改动 | 验证 |
|------|------|
| 纯文档 | 内容和链接正确即可 |
| 普通代码 | `pnpm typecheck` + 相关单元测试 |
| Main / Preload / IPC / UI 流程 | 再加相关 Electron E2E |
| 配置、安全、安装、更新 | `pnpm lint` + `pnpm test` + `pnpm compile` + 相关 E2E |

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

- 改了已有 UI 行为，要把受影响的旧测试断言一起改掉。
- 禁止用 sleep、retry、skip、调大超时让测试通过；等待真实的完成信号。
- 测试用隔离目录和 mock，不用真实凭证，不发真实模型请求。
- 没跑的检查写“未运行”，不能写成通过。

## 5. 作者与提交（不可违反）
- 作者只有 wangmiao `<tuziling84@gmail.com>`。
- 禁止任何 AI 出现在 Git author、committer、`Co-authored-by`、`Made-with`、README 贡献者、LICENSE、`package.json` 的 `author` 中。
- 推送前检查每个待推送提交：`git log origin/main..HEAD --format=fuller`。
- 外部贡献者的原始提交和署名必须保留。
- 提交标题简短，用 `feat:` / `fix:`，只写用户可见的变化。

## 6. 公开内容
README、CHANGELOG、GitHub Release、提交信息、界面文案只写已发布、用户能看到的新增和修复。不写内部实现、排查过程、未发布计划、本机路径或 AI/工具信息。不新建 `CONTRIBUTING.md`。

## 7. 发布
1. 更新 `package.json` 版本和 `CHANGELOG.md`（`## X.Y.Z — YYYY-MM-DD`，只用 `### Added` / `### Fixed`）。
2. 本地验证通过，且 `pnpm security:node --source-only --online --audit --release` 退出码 0、结果为 `PASS`。
3. **只推 main**，等这个提交的 CI 全部通过。
4. 再给这个已通过 CI 的提交打注释标签 `vX.Y.Z` 并推送。

禁止 main 和标签同时推送，禁止给 CI 未通过的提交打标签，禁止移动或覆盖已推送的标签和已公开的 Release；标签推送后发布失败，修复后发下一个补丁版本。
