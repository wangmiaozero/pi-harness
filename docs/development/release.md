# Release

| 分支 | 发布物 |
| --- | --- |
| `origin/main-electron` | Electron Stable（`v*` / `release.yml`） |
| `origin/main-tauri` | Tauri 线。签名和公证未完成，不能当 Stable |

Tauri workflow：`.github/workflows/release-tauri.yml`，tag `tauri-v*`，draft + prerelease。

不要把 Tauri 构建覆盖 Electron Release。不要合并到 `main`。
