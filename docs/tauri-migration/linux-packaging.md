# Linux Packaging

当前选择与 Electron 一致的 **AppImage**（Tauri `targets: all` 在 Linux 默认含 AppImage）。
不额外维护 deb/rpm，避免双格式成本。

## 依赖

需要系统 WebKitGTK 4.1（CI：`libwebkit2gtk-4.1-dev`）。
用户机器需能加载 WebKitGTK；Release notes 写明。

## Sidecar

随包 Node + `runtime/`。不要依赖发行版 Node 主版本。
