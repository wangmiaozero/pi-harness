# Rollback

| 场景 | 做法 |
| --- | --- |
| Tauri 更新下载/校验失败 | 当前安装继续可用 |
| Tauri RC 不可用 | 重装最后 Electron Stable；userData 仍在 `Pi-Harness` |
| 迁移后数据异常 | 从 `migration-backup-<timestamp>/` 拷回 JSON |
| 新 schema 旧版本读不懂 | 见 `tauri-migration.json`；v1 与 Electron 文件布局相同 |

Electron 用户数据禁止 `rm -rf`。
