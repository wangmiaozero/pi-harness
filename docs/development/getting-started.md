# Getting started

```bash
pnpm install --frozen-lockfile
pnpm doctor
pnpm dev:tauri
```

需要 Node ≥ 22、pnpm 9.12.1、Rust stable、平台 WebView（macOS WKWebView / Windows WebView2 / Linux WebKitGTK 4.1）。

`pnpm doctor` 只检查工具链，不读取 Provider API Key。

Electron 开发仍是 `pnpm dev`。Electron 发布线是 `origin/main-electron`。
