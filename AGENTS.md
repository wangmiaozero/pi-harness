# Agent instructions

Before changing this repository, read `task/internal/agents/AGENTS.md` and `task/internal/agents/CONTRIBUTING.md` when they exist. They contain the maintainer's local instructions and are intentionally excluded from Git. Never add a public `CONTRIBUTING.md`.

## 分支

| 远程分支 | 用途 |
| --- | --- |
| `origin/main` | 不要把 Tauri 重构合并进去 |
| `origin/main-electron` | **Electron 正式线**。Electron 外壳、`electron-builder`、`electron-updater` 的稳定版本以这条分支为准 |
| `origin/main-tauri` | **Tauri 2 线**。Phase 7 及之后的桌面宿主改动合并到这里 |
| `origin/refactor/tauri-v2` | Tauri 迁移历史分支，不再作为合并目标 |

禁止：

```text
git checkout main && git merge <tauri-branch>
git push origin main
git push origin main-electron   # 除非用户明确要求发布 Electron
```

Electron 未退役。Tauri 生产门禁（签名、公证、干净机器安装、updater E2E）未通过之前，不要从 `main-tauri` 删除 Electron 源码来假装已经替换。用户安装 Electron 构建物时以 `origin/main-electron` 为准。

