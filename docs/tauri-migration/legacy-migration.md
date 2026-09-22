# Electron → Tauri 数据迁移

`dataSchemaVersion` 存在 `tauri-migration.json`（当前 `1`），与 App version 解耦。

## Packaged

若 `~/Library/Application Support/Pi-Harness`（Windows `%APPDATA%\Pi-Harness`，Linux 同级目录）已有 Electron 数据：

1. 备份关键 JSON 到 `migration-backup-<unix>/`
2. **直接共用该目录**（不删除、不改路径）
3. 写入 `tauri-migration.json`（idempotent）

这样 dual-shell 回滚：重装 Electron Stable 即可。

## Dev

Tauri debug 使用自己的 `app_data_dir`，不抢 Electron 的 `Pi-Harness-dev`。

## 不迁移的内容

`~/.pi/agent` 仍是 Pi 原生配置，两边共用，不复制。
