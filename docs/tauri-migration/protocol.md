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

`result` 与 `error` 互斥、必居其一。**`result: null` 是合法的成功响应**
（void 方法）；宿主按「键是否存在」判别，不能用 `Option<Value>` 反序列
化区分 `null` 与缺失。错误对象可带可选 `userMessage`（净化后的用户可读
文案，透传给渲染层的 `AppErrorPayload.userMessage`）。

## 事件（运行时 → 宿主，stdout，无对应请求）

```json
{
  "type": "event",
  "event": "runtime.ready",
  "payload": { "runtimeVersion": "0.1.0", "protocolVersion": 1, "pid": 123 },
  "sequence": 1,
  "timestamp": 1789970000000
}
```

| 字段        | 类型   | 说明                                                 |
| ----------- | ------ | ---------------------------------------------------- |
| `sequence`  | number | 单调递增事件序号（进程生命周期内从 1 起，不重置）    |
| `timestamp` | number | `Date.now()` 毫秒（事件构建时刻）                    |

`sequence`/`timestamp` 为协议 1.1 增补的可选字段：宿主忽略未知键，
旧宿主可继续工作。事件不占请求 ID 空间；宿主按 `event` 名扇出到渲染层。

### 域事件（phase 2）

| event           | payload                                            | 说明                                                   |
| --------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `agent.event`   | `{ sessionId, event }` 或其**数组**（16ms 批合并） | Pi 原生 agent 事件（wire 格式同 Electron `agent-event`）|
| `agent.running` | `{ ids: string[] }`                                 | 运行中会话列表变更（全量快照）                         |
| `harness.event` | `{ sessionId, event }`                              | Harness 映射事件（session.started / prompt.started / …）|

`agent.event` 的批处理：运行时以 16ms 窗口合并同会话事件以降低 IPC 开销，
单事件与批量两种 payload 形态渲染层都要接受（`normalizeAgentEventEnvelopes`）。

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

## 方法清单（协议 v1，phase 2 全量）

### runtime.*（基础平面）

| 方法               | 参数 | 结果                                                          | 说明                   |
| ------------------ | ---- | ------------------------------------------------------------- | ---------------------- |
| `runtime.ping`     | —    | `{ pong: true, timestamp }`                                   | 存活探活               |
| `runtime.version`  | —    | `{ runtimeVersion, protocolVersion, nodeVersion }`            | 身份/版本              |
| `runtime.status`   | —    | `{ running, pid, uptimeMs, runtimeVersion, protocolVersion, sdkLoaded, piSdkLoadMs, firstAgentStartMs }` | 运行时自身视角；`sdkLoaded` 为 SDK 是否已懒加载，`piSdkLoadMs`/`firstAgentStartMs` 为 §36 timing（未发生时为 null） |
| `runtime.shutdown` | —    | `{ stopping: true }`                                          | 优雅停机；先响应再退出 |

### session.*（会话平面）

| 方法                  | 参数                            | 结果             | 说明                                   |
| --------------------- | ------------------------------- | ---------------- | -------------------------------------- |
| `session.list`        | `force?: boolean`               | `{ sessions }`   | `SessionInfo[]`（Pi `SessionManager`） |
| `session.get`         | `sessionId, leafId?`           | `SessionDetail`  | 含 `context`                           |
| `session.rename`      | `sessionId, name`               | `null`           | 重命名                                 |
| `session.delete`      | `sessionId`                     | `null`           | 先停 agent（容错）再删                 |
| `session.context`     | `sessionId, leafId?`            | `SessionContext` | = `session.get(...).context`           |
| `session.viewFullHistory` | `sessionId`                 | `SessionDetail`  | 完整历史（不截断）                     |

### agent.*（Agent 平面，经 HarnessService 语义）

| 方法            | 参数                          | 结果                          | 说明                                          |
| --------------- | ----------------------------- | ----------------------------- | --------------------------------------------- |
| `agent.start`   | `StartAgentSessionInput`     | `{ sessionId, cwd }`          | 懒加载 SDK；observe 并发 `session.started`    |
| `agent.prompt`  | `sessionId, message, images?, streamingBehavior?` | unknown | `streamingBehavior: 'steer'\|'followUp'` 队列化 |
| `agent.abort`   | `sessionId`                  | `null`                        | 终止当前 turn + compaction                    |
| `agent.state`   | `sessionId`                  | `AgentStateSnapshot \| null`  | 未运行返回 `null`（Electron 对等）           |
| `agent.running` | —                             | `{ ids: string[] }`          | 与同名事件 payload 形态一致                   |
| `agent.command` | `sessionId, command`          | unknown                       | `set_model`/`set_tools`/`compact`/`steer`/…   |

### harness.*（Harness 平面）

| 方法                       | 参数                                  | 结果                     | 说明                                      |
| -------------------------- | ------------------------------------- | ------------------------ | ----------------------------------------- |
| `harness.getState`         | `sessionId`                          | `HarnessState \| null`  | capabilities + context + tools + stats    |
| `harness.getTools`         | `sessionId`                          | `HarnessTool[]`         |                                           |
| `harness.setTools`         | `sessionId, toolNames`               | `null`                   | 未知工具 → `TOOL_NOT_FOUND`               |
| `harness.setModel`         | `sessionId, provider, modelId`       | `null`                   | 经 Pi `AgentSession.setModel()`           |
| `harness.setThinkingLevel` | `sessionId, level`                   | `null`                   | 基于 `getAvailableThinkingLevels()` 校验  |
| `harness.compact`          | `sessionId, instructions?`           | `HarnessCompactionResult`|                                           |
| `harness.abortCompaction`  | `sessionId`                          | `null`                   | 不可压缩 → `COMPACTION_NOT_AVAILABLE`     |
| `harness.setAutoCompaction`| `sessionId, enabled`                | `null`                   |                                           |
| `harness.steer`            | `sessionId, message`                 | `null`                   | 流式中插话                                |
| `harness.followUp`         | `sessionId, message`                | `null`                   | 完成后追加                                |
| `harness.fork`             | `sessionId, entryId`                | `HarnessForkResult`      | 新会话分支                                |
| `harness.navigateTree`     | `sessionId, targetId`               | unknown                  | 树节点跳转                                |
| `harness.getSession`       | `sessionId`                          | `HarnessSessionInfo`    |                                           |
| `harness.getStats`         | `sessionId`                          | `HarnessStats`          |                                           |
| `harness.getTimeline`      | `sessionId`                          | `{ events }`             | 上限 300 条（对齐 Electron）              |

Run Control Plane / Evaluation / Checkpoint / Policy / Artifacts 等留待
phase 3（迁移计划 §38）。

未知方法 → `METHOD_NOT_FOUND`（带 `data.method`）。

## 错误码

运行时可回传（`runtime/src/pi/errors.ts` 权威清单）：

| code                       | 语义                                            |
| -------------------------- | ----------------------------------------------- |
| `INVALID_REQUEST`         | 行不是合法请求（解析失败 / id 缺失 / 超长行）   |
| `INVALID_INPUT`           | 域方法参数校验失败                              |
| `METHOD_NOT_FOUND`        | 方法未注册                                      |
| `INTERNAL_ERROR`          | 处理器抛错                                      |
| `SHUTDOWN`                | 运行时正在停机，无法服务新请求                  |
| `PI_SDK_LOAD_FAILED`      | Pi SDK 动态加载失败（data.recoverable=false）   |
| `SESSION_NOT_FOUND`       | 会话不存在或未启动且自动启动失败                |
| `SESSION_NOT_RUNNING`     | 会话未运行（需先 agent.start）                  |
| `AGENT_BUSY`              | 前一个 prompt 尚未落定（防乱序）                |
| `MODEL_NOT_FOUND`         | provider/model 未知（Pi modelRuntime 查询）     |
| `TOOL_NOT_FOUND`          | setTools 里的工具名不在 `getAllTools()`         |
| `COMPACTION_NOT_AVAILABLE`| 当前状态不可压缩/不可中断                       |
| `CAPABILITY_NOT_SUPPORTED`| 会话能力缺失（如 thinking 不受支持）            |

宿主侧（Rust）额外内部码：`RUNTIME_EXITED`（管道关闭 / 进程退出）、
`RUNTIME_TIMEOUT`（请求超时）、`PROTOCOL_MISMATCH`（握手版本不符）。

错误 `data` 附带语义：`{ recoverable: false }` 表示重试必然失败
（SDK 未装、协议不符等），UI 应提示修复而非重试。

## 宿主超时（Rust `request_timeout_for`）

默认 60s；`harness.compact` 与 `command.type === 'compact'` 为 **15min**。
超时回 `RUNTIME_TIMEOUT`，运行时进程不受影响（长压缩期间的请求继续排队）。

## Tauri 命令面（渲染层入口）

渲染层不直连 JSONL，一律经
`invoke('runtime_request', { method, params })`（`src/platform/tauri.ts`）：

- 该命令自动启动 runtime（Stopped/Crashed → 先 start；场景 B 的懒启动）。
- `runtime.*` 生命周期方法走专用命令（`runtime_start/stop/status/...`），
  转发器拒绝 `runtime.*` 前缀。
- 错误即 `RpcError` 序列化形态 `{ code, message, userMessage? }` ——
  与渲染层 `AppErrorPayload` 同构（`callApi` 直接消费）。
- 事件经 `pi-harness:agent:event` / `pi-harness:agent:running` /
  `pi-harness:harness:event` 通道直达（payload 原样透传），其余归入
  `pi-harness:runtime:event`。

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

## 测试缝（仅测试构建）

`PI_HARNESS_TEST_PI_SDK=<module path>`：运行时加载 mock SDK 模块而非真实
`@earendil-works/pi-coding-agent`（`resolveConfiguredSdkLoader`）。Rust 侧用
`RuntimeSupervisor::with_extra_env` 注入（`src-tauri/tests/` 集成测试）。

## 版本升级

`PROTOCOL_VERSION` 不匹配即拒绝握手，不做降级协商 —— 运行时与宿主
同仓库同版本发布，升级 = 两者一起换。事件信封的 `sequence`/`timestamp`
为向后兼容增补：旧宿主忽略未知键，新宿主容忍旧事件缺字段。
