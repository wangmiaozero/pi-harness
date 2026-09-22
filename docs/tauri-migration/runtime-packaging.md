# Runtime Packaging

生产包必须自带 sidecar，不要求用户先装 Node 22。

## 布局

```text
Pi-Harness.app/Contents/Resources/
  runtime/index.js          # sidecar 编译产物
  runtime/node_modules/     # Pi SDK（npm install --omit=dev）
  runtime-node/node         # 官方 Node 二进制（当前构建目标）
  builtin-skills/           # 内置 skill 包
```

`scripts/stage-tauri-runtime.mjs` 在 `pnpm build:tauri` 的 `beforeBuildCommand` 中运行。

## Node 策略

| 进程 | Node |
| --- | --- |
| Desktop Runtime sidecar | **随包二进制**（`PI_HARNESS_NODE` → bundled → login-shell PATH） |
| 用户 Pi CLI / 开发环境 | 仍检测系统 Node / nvm / Homebrew |

禁止默认从互联网下载 Runtime Node。CI 与本地 `stage` 在构建期拉取官方 `nodejs.org/dist`。

平台矩阵：`darwin-arm64` / `darwin-x64` / `windows-x64` / `linux-x64`。
不把 macOS arm64 Node 打进其他平台。

## 解析顺序

1. `PI_HARNESS_NODE` / `PI_HARNESS_RUNTIME_SCRIPT`
2. `PI_HARNESS_RESOURCES_DIR`
3. 开发：PATH 上的 `node` + 仓库 `runtime/dist/index.js`

动态 `import('@earendil-works/pi-coding-agent')` 依赖 `runtime/node_modules`。
staging 使用 `npm install --omit=dev --ignore-scripts`，并剥离 pnpm 注入的
`npm_config_*`，避免 Node 26+ 的 `EALLOWSCRIPTS` 失败。未做单文件 bundling。
