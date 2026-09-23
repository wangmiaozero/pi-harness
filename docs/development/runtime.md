# Runtime

阶段：`stopped` `starting` `ready` `busy` `stopping` `crashed` `restarting` `failed`。

`ready` 表示 `runtime.handshake` 成功，不是业务初始化完成。

空闲关闭：默认 10 分钟无 agent、无进行中的 Pi 安装。`PI_HARNESS_RUNTIME_IDLE_MS=0` 关闭。下一次 domain RPC 会重新 `start()`。

崩溃环：5 分钟内意外退出 ≥ 3 次进入 `failed`，只能手动 `restart`。

未捕获异常和 unhandled rejection 会记 stderr 并走 graceful shutdown。
