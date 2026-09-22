# Windows Packaging

目标：Windows x64 NSIS（`tauri.conf.json` bundle.targets = all，CI 用 `--target x86_64-pc-windows-msvc`）。

## WebView2

`webviewInstallMode: downloadBootstrapper`：安装包保持较小；离线机需自备 Evergreen Runtime。
若要完全离线，改为 `embedBootstrapper`（体积上升），在 CI 矩阵单独评估。

## Sidecar

`Program Files` 带空格路径：Node 与 `runtime/index.js` 以 argv 传递，不经 shell。

## 签名

CI 预留 Authenticode Secret 位。未配置时产出 **Unsigned Development / Community Build**。
Signed Production Build 需要 `WINDOWS_CERTIFICATE` 类 Secret（尚未接入）。

## Uninstall

默认保留 userData（`%APPDATA%\Pi-Harness`）。不要随卸载删除工作区/设置。
