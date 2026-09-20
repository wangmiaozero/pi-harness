# JSONL RPC 协议（Rust ↔ Node）

版本：**1**（`PROTOCOL_VERSION`，TS 与 Rust 两侧镜像）

传输：Node sidecar 的 **stdin/stdout** 各为单向通道，UTF-8、按行分隔
（JSONL，`\n` 结尾）。**stderr 仅承载诊断日志**，协议解析器不读它。

双端实现位置：

- TypeScript：`runtime/src/protocol/messages.ts`（运行时侧权威）
- Rust：`src-tauri/src/runtime/protocol.rs`（宿主侧镜像）

## 请求（宿主 → 运行时，stdin）

```json
{ "id": "req_42", "method": "runtime.ping", "params": {} }
```

| 字段     | 类型    | 说明                                                |
| -------- | ------- | --------------------------------------------------- |
| `id`     | string  | 宿主生成的唯一 ID（`req_<自增>`）；响应必须原样回传 |
| `method` | string  | `域.动作` 命名，与 IPC 通道命名风格一致             |
| `params` | object? | 可选参数对象                                        |

## 响应（运行时 → 宿主，stdout）

```json
{ "id": "req_42", "result": { "pong": true, "timestamp": 1758000000000 } }
```

```json
{
  "id": "req_42",
  "error": {
    "code": "METHOD_NOT_FOUND",
    "message": "Unknown method: nope.nope",
    "data": { "method": "nope.nope" }
  }
}
```

`result` 与 `error` 互斥、必居其一。

## 事件（运行时 → 宿主，stdout，无对应请求）

```json
{
  "type": "event",
  "event": "runtime.ready",
  "payload": { "runtimeVersion": "0.1.0", "protocolVersion": 1, "pid": 123 }
}
```

事件不占请求 ID 空间；宿主按 `event` 名扇出到渲染层。

## 启动握手

宿主 spawn 后首个请求必须是 `runtime.version`：

```json
{ "id": "req_1", "method": "runtime.version", "params": {} }
```

```json
{
  "id": "req_1",
  "result": { "runtimeVersion": "0.1.0", "protocolVersion": 1, "nodeVersion": "v26.7.0" }
}
```

宿主校验 `protocolVersion === 1`，不匹配即判 `Crashed`
（`RUNTIME_TIMEOUT` 载荷），进程随即被回收。

## 方法清单（协议 v1）

| 方法               | 参数 | 结果                                                          | 说明                   |
| ------------------ | ---- | ------------------------------------------------------------- | ---------------------- |
| `runtime.ping`     | —    | `{ pong: true, timestamp }`                                   | 存活探活               |
| `runtime.version`  | —    | `{ runtimeVersion, protocolVersion, nodeVersion }`            | 身份/版本              |
| `runtime.status`   | —    | `{ running, pid, uptimeMs, runtimeVersion, protocolVersion }` | 运行时自身视角         |
| `runtime.shutdown` | —    | `{ stopping: true }`                                          | 优雅停机；先响应再退出 |

未知方法 → `METHOD_NOT_FOUND`（带 `data.method`）。

## 错误码

| code               | 语义                                          |
| ------------------ | --------------------------------------------- |
| `INVALID_REQUEST`  | 行不是合法请求（解析失败 / id 缺失 / 超长行） |
| `METHOD_NOT_FOUND` | 方法未注册                                    |
| `INTERNAL_ERROR`   | 处理器抛错                                    |
| `SHUTDOWN`         | 运行时正在停机，无法服务新请求                |

宿主侧（Rust）额外内部码：`RUNTIME_EXITED`（管道关闭 / 进程退出）、
`RUNTIME_TIMEOUT`（超时 / 握手失败）。

## 停机语义

`runtime.shutdown` 的完整序列：

1. 运行时回 `{ stopping: true }` 并广播 `runtime.stopping` 事件。
2. 运行时 `process.exit(0)`（setImmediate 后，保证 stdout 已冲刷）。
3. 宿主等待退出（宽限 5s）；超时则关闭 stdin（运行时 stdin EOF 即退）、
   最终 `kill_on_drop` 兜底。
4. 停机中收到的新请求 → `SHUTDOWN` 错误响应（保序，不悬挂宿主 pending）。

## 帧约束

- 单行上限 **5 MiB**（TS 侧 `MAX_LINE_BYTES`）；超限丢弃该行并广播
  `runtime.protocol-violation` 事件，进程不退出。
- 空行忽略。
- 编码为 UTF-8 JSON，不允许嵌入裸换行（JSON 序列化天然满足）。

## 版本升级

`PROTOCOL_VERSION` 不匹配即拒绝握手，不做降级协商 —— 运行时与宿主
同仓库同版本发布，升级 = 两者一起换。
