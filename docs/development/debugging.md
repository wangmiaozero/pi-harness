# Debugging

- sidecar stderr：宿主转发为 `pi-harness:runtime:log`
- `runtime.status`：phase、generationId、uptimeMs、crashLoop、eventGaps
- `runtime.activity`：busy、reasons、`process.memoryUsage()`
- 崩溃横幅：`crashed` 和 `failed` 都提供 Restart
- 不做遥测上传
