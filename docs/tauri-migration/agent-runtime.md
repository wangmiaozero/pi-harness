# Agent Runtime（运行时侧架构）

第二阶段新增。描述 Node 运行时内部如何围绕 Pi Coding Agent SDK 组装
Session / Agent / Harness 三层能力。

## 目录

```text
runtime/src/
├── index.ts                 # 入口：JSONL 循环、并发 dispatch、优雅停机
├── services.ts              # 组合根：RuntimeServices（三服务 + 事件 sinks）
├── types.ts                 # AgentSession 结构类型（SDK 依赖的本地声明）
├── pi/
│   ├── sdk.ts               # 懒加载 + 缓存 + 测试缝（PI_HARNESS_TEST_PI_SDK）
│   ├── types.ts             # SDK 表面（SessionManager 等）
│   ├── environment.ts      # PI_CODING_AGENT_DIR 覆盖链
│   └── errors.ts           # RUNTIME_ERROR_CODES（域错误码权威）
├── session/service.ts       # SessionService：list/get/rename/remove/context
├── agent/
│   ├── wrapper.ts           # AgentSessionWrapper：单会话生命周期 + prompt 串行
│   ├── manager.ts           # AgentRuntimeManager：注册表 + 运行状态广播 + 事件扇出
│   └── events.ts            # 16ms 事件批处理（AgentEventBatcher）
├── harness/
│   ├── service.ts           # HarnessService：Electron HarnessRuntime 对等移植
│   ├── mappers.ts           # mapAgentEvent：Pi 原生事件 → Harness 事件
│   └── types.ts             # HarnessState / Tool / Stats / ForkResult…
├── support/                 # 自包含端口（provider-presets、thinking、错误…）
├── protocol/
│   ├── messages.ts          # JSONL 编解码 + RPC_ERROR_CODES
│   ├── emitter.ts           # RuntimeEventEmitter（单调 sequence + 时间戳）
│   ├── dispatch.ts          # 方法注册表 + runtime.* 基础方法
│   └── domain-methods.ts    # session.* / agent.* / harness.* 注册
└── transport/jsonl.ts        # 行读写（5 MiB 帧上限）
```

## 三个服务

- **SessionService**：只读为主，围绕 Pi `SessionManager`（listAll /
  打开会话文件、rename、删除文件、context 组装）。无 agent 依赖。
- **AgentRuntimeManager**：`agent.start` 进来才 `loadSdk()`（懒加载），
  构造 `AgentSessionWrapper`，维护注册表；观察运行状态变化（流式 /
  pending prompt / bash / compaction）驱动 `agent.running` 事件；
  事件经 `AgentEventBatcher`（16ms 批）扇出给 `agent.event`。
- **HarnessService**：Electron `HarnessRuntime` 的行为移植 ——
  `agent.*` RPC 全部经它（与 Electron workspace.agent = harness 对等），
  observe 映射原生事件为 Harness 事件流（session.started、prompt.started、
  model.changed、context.updated…），并承载 harness.* 直连方法。

## Prompt 串行与 steering

- 每个 wrapper 内部 prompt admission 队列：前一 turn 未落定（prompt_done
  / abort）前的新 prompt 抛 `AGENT_BUSY`（与 Electron 防乱序一致）。
- 流式中 `steer`、空闲时 `followUp` 直接透传 SDK 原生方法（§21），
  `agent.prompt` 的 `streamingBehavior: 'steer'|'followUp'` 走同一队列并
  发 `steering.queued` / `followUp.queued` Harness 事件。

## 能力降级（capabilities）

`harness.getState` 尽力收集 capabilities（thinking、compaction…），
单项能力查询失败即降级为 `supported: false`，不整体失败。

## 与 Electron 的行为对齐清单

- `agent.state(未知会话)` → `null`（非错误）。
- `session.delete` → 先 stopSession（容错）再删文件。
- `harness.setTools` 校验 `getAllTools()`，未知 → `TOOL_NOT_FOUND`。
- `harness.setThinkingLevel` 校验 `getAvailableThinkingLevels()`。
- `harness.compact` 结果含 `cancelled` 字段时映射 `compaction.skipped` 事件。
- timeline 上限 300 条，与 Electron 相同。
- 事件发射目录（session.started / prompt.started / runtime.aborted /
  model.changed / thinking.changed / tools.changed / context.updated…）
  与 Electron `HarnessRuntime` 逐一对齐。

## 零依赖约束

运行时不 import `src/shared`（NodeNext + 自包含），需要共享的逻辑以
「端口」形式在 `runtime/src/support/` 重新实现并保持行为一致
（provider-presets 生成 JSON、thinking 层级、runtime-error 语义）。
SDK 缺失的部署下：`agent.start` → `PI_SDK_LOAD_FAILED`
（`data.recoverable = false`），其余 session 列表照常。
