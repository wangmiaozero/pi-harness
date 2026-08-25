# 应用更新

Pi-Harness 的应用更新由 `electron-updater` 和 GitHub Releases 提供，仅在正式安装包中启用。开发模式使用 Vite HMR，不显示正式安装包更新区，也不会请求 Release 更新。

## 更新流程

1. 应用启动 10 秒后在后台检查新版本。
2. 发现新版本后自动下载，并通过主进程到渲染进程的只读 IPC 状态事件同步进度。
3. 下载完成后显示全局提示，设置页启用“安装并重启”。
4. 用户可以立即重启完成安装；如果暂不重启，更新会在应用正常退出时自动安装。

Electron 主程序、Preload 和原生依赖不能在进程内安全替换，因此应用更新仍需要一次重启。“热更新”在这里指后台检查、下载和就绪通知不打断当前工作，而不是绕过重启替换正在运行的程序。

## Release 产物

GitHub Release 必须同时包含 `electron-builder` 生成的更新元数据和对应平台载荷：

- macOS：DMG 用于手动安装，ZIP 用于自动更新，并包含 `latest-mac.yml`。
- Windows：NSIS 安装包、blockmap 和 `latest.yml`。
- Linux：AppImage、blockmap 和 `latest-linux.yml`。

推送 `v*` tag 会触发 `.github/workflows/release.yml`：macOS 同时构建 arm64/x64，Windows 和 Linux 构建 x64，随后统一创建 GitHub Release，并为所有产物生成 `SHA256SUMS`。

发布任务会在创建 Release 前校验三套 `latest*.yml`、平台更新载荷、blockmap，以及两种 macOS 架构的 DMG/ZIP；任何更新文件缺失都会直接终止发布。若历史 Release 缺少更新元数据，客户端会回退查询 GitHub 的稳定 Release API：当前版本与最新版本相同时显示“已是最新”，存在更高版本时明确提示手动安装，而不是误报为普通网络失败。

macOS 和 Windows 的正式发布产物应完成平台代码签名。更新器只消费 `electron-builder.yml` 中 `wangmiaozero/pi-harness` 的正式 Release，不在开发模式启用 `forceDevUpdateConfig`。

仓库不保存签名证书或私钥。当前工作流在没有 signing secret 时通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 明确跳过 macOS 自动签名发现；这使社区构建可重复执行，但无签名产物不能替代经过签名和公证的正式分发版本。

## 本地验证

```bash
pnpm typecheck
pnpm test:unit
pnpm compile
```

端到端更新需要从旧版本正式安装包启动，并在 GitHub Releases 发布版本号更高、架构匹配且已签名的产物。仅运行 `pnpm dev` 不能验证安装替换流程。
