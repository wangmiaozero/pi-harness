# 事件流（Runtime → Rust → 渲染层）

第二阶段新增。流式事件是本阶段最高优先级（迁移计划 §10），
本文描述全链路形态与顺序保证。

## 链路

```text
Pi SDK (AgentSession.subscribe)
  ↓ 同步回调
AgentSessionWrapper → AgentRuntimeManager
  ├─→ HarnessService observe（每会话一个，mapAgentEvent 即时映射）
  │      └→ harness.event { sessionId, event }          （不批处理）
  ├─→ AgentEventBatcher（16ms 窗口，按会话聚批）
  │      └→ agent.event { sessionId, event } | [envelope…] （批）
  └─→ 运行状态广播（isRunningStateEvent 触发，去重）
         └→ agent.running { ids: string[] }             （全量快照）
  ↓ RuntimeEventEmitter（单调 sequence + timestamp，stdout 单写者）
Rust RuntimeSupervisor（单 reader 任务按序解析）
  ↓ broadcast channel（容量 1024）
Tauri emit（forward_supervisor_events，按事件名路由）
  ├─ agent.event   → pi-harness:agent:event    （payload 原样透传）
  ├─ agent.running → pi-harness:agent:running
  ├─ harness.event → pi-harness:harness:event
  └─ 其他          → pi-harness:runtime:event  （{ event, payload }）
  ↓
Vue 平台桥（piSwitch.on('agent-event' | 'agent-running' | 'harness-event')）
  ↓ normalizeAgentEventEnvelopes（单/批统一）
stores（agent / harness / sessions）
```

## 顺序保证（§11）

1. **stdout 单写者**：运行时侧所有响应/事件经同一异步写队列串行输出，
   JSONL 天然全序。
2. **Rust 单 reader**：一个任务逐行解析 stdout，按到达顺序投递
   broadcast；broadcast 容量 1024，消费者 Lagged 时继续收新事件
   （修复了 `while let Ok` 遇 Lagged 退出的隐患）。
3. **Tauri emit** 在同一 forwarder 任务内顺序调用，WKWebView 侧按
   发射顺序派发。
4. **sequence 字段**：每个事件带单调递增序号，调试 / 回放 / 乱序检测用。

## Envelope（协议 1.1）

```json
{
  "type": "event",
  "event": "agent.event",
  "payload": { "sessionId": "s1", "event": { "type": "message_start", … } },
  "sequence": 1024,
  "timestamp": 1789970000000
}
```

`sequence` 自进程启动单调递增（1 起）；`timestamp` 为毫秒时间戳。
宿主忽略未知键，旧宿主可继续工作（向后兼容）。

## 批处理（agent.event）

16ms 窗口内同会话的多个 Pi 原生事件合并为数组一次发送；渲染层
`normalizeAgentEventEnvelopes` 统一单/批两种形态。首事件不等待窗口
立即 flush（低延迟），高频 message_delta 增量走批（吞吐）。

## harness.event 不批

Harness 事件（session.started、prompt.started、model.changed、
context.updated…）为低频状态事件，即时发送，保证 UI 状态切换不迟滞。

## 渲染层消费（与 Electron 对等）

| 通道                | payload                              | 消费方                |
| ------------------- | ------------------------------------ | --------------------- |
| `pi-harness:agent:event` | `{ sessionId, event }` 或数组   | agent store（流式渲染）|
| `pi-harness:agent:running` | `{ ids: string[] }`             | agent store（运行态）  |
| `pi-harness:harness:event` | `{ sessionId, event }`           | harness store（时间线）|

事件名与 Electron preload 的 IPC_EVENT 一致，Vue 层零改动（§23）。

## 断流语义

运行时崩溃时：事件流静默停止 + `runtime:state → crashed`。
恢复后由渲染层各 store 的主动刷新（`refresh()`）重建状态 ——
事件流不做补发（持久数据为准）。
