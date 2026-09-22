# Tauri Updater

替换 `electron-updater`。Vue 只调 `piSwitch.updater.*`。

## API

`state` / `check` / `download` / `install` / `openReleasePage`

状态：`idle | checking | available | not-available | downloading | downloaded | installing | manual-update | error`

下载或校验失败时当前安装保持可运行。

## 签名

`src-tauri/tauri.conf.json` `plugins.updater.pubkey` 为 minisign 公钥。
私钥只放 GitHub Secret：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

仓库、artifact、App bundle 不得包含私钥。

当前仓库公钥没有配套已托管的生产私钥。在 Secret 配好并发布带 `latest.json` 签名包之前，`check` 失败会回落到 GitHub Releases API，状态为 `manual-update`，用户走 `openReleasePage`。

## Rollback

Tauri 官方 updater 不保证自动回滚到上一版本。策略：

1. 更新失败不覆盖当前安装。
2. userData 与 Electron 共享 `Pi-Harness` 目录；重装最后 Electron Stable 仍可读。
3. 首次 Tauri 启动把关键 JSON 拷到 `migration-backup-<timestamp>/`。
4. 数据 schema 用 `tauri-migration.json` 的 `schemaVersion`，不用单纯 App version。
