# Providers / Models / Config / Skills（Phase 5）

Pi 生态逻辑在 Node sidecar，不重写 SDK / Skills。

```text
Vue → Platform Bridge → runtime_request → sidecar
  providers / models / config / skills / packages / capabilities
  settings / backup / diagnostics / logs / pi.detect|install
```

宿主只做：clipboard、open URL（nodejs.org / github.com）、backup/logs 目录、
diagnostics 导出对话框、login-shell PATH。

## 数据

继续用现有文件，不造第二套：

- `~/.pi/agent/models.json` `settings.json`
- userData `settings.json` `metadata.json` `ui-state.json` `backups/`
- Secret：macOS Keychain `!command`；其它平台 AES-256-GCM vault（同路径 `secrets.bin`）

Provider 返回默认 mask。Active model 仍是 `provider + modelId`。

## Config

写路径：validate → backup → atomic write → reload。
chokidar watcher → `config.changed` → Rust → `pi-harness:event:config-changed`。
外部改文件走 conflict snapshot，不轮询。
