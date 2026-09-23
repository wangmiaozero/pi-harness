# Protocol

`PROTOCOL_VERSION = 1`。宿主启动调用 `runtime.handshake`。版本不一致返回 `RUNTIME_PROTOCOL_MISMATCH`。

清单：`runtime/src/protocol/manifest.ts`。

方法表是 `createMethodRegistry`，不是巨型 switch。

事件带 `sequence`、`timestamp`、`generationId`。序号跳变只记 diagnostics，不 panic。

Agent token 在 sidecar 内按 16ms 合并（`AgentEventBatcher`）。
