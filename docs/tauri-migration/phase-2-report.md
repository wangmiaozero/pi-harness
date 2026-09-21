# Phase 2 报告：Pi Runtime Core Migration

对应任务 `task/13-Pi 生态里最好用.md`。范围：Session + Agent + Harness
核心能力迁入 Node sidecar，Tauri 版可跑完整 Pi Coding Agent 会话。

## 交付内容

### Node 运行时（runtime/）

- **组合根** `services.ts`：SessionService + AgentRuntimeManager +
  HarnessService，事件 sinks（agent.event 批 / agent.running /
  harness.event 即时）。
- **Pi SDK 懒加载** `pi/sdk.ts`：首个 `agent.start` 才动态 import；
  `PI_HARNESS_TEST_PI_SDK` 测试缝。
- **AgentSessionWrapper / AgentRuntimeManager**：单会话生命周期、
  prompt 串行（AGENT_BUSY 防乱序）、steer/followUp 队列、abort、
  运行状态广播、16ms 事件批。
- **HarnessService**：Electron `HarnessRuntime` 的事件发射目录与域方法
  逐一对齐（observe、mapAgentEvent、capabilities 降级、timeline 300 上限、
  setTools 校验、thinking 校验、compaction 映射…）。
- **协议层**：`emitter.ts`（单调 sequence + timestamp）、
  `domain-methods.ts`（session.*/agent.*/harness.* 全量注册）、
  `dispatch.ts` 注册表重构、错误码全量域代码 + userMessage。
- **入口** `index.ts`：并发 dispatch（fire-and-forget，长压缩不阻塞
  后续请求）、优雅停机（2s watchdog）、stdin EOF 清理、EPIPE 静默。

### Rust 宿主（src-tauri/）

- `runtime_request(method, params)` 命令：域方法统一入口 + 自动启动
  （场景 B 懒启动）；错误以 `RpcError` 原样透传（渲染层 `AppErrorPayload`
  同构）。
- `request_timeout_for`：默认 60s；`harness.compact` / compact 命令 15min。
- 事件转发：`agent.event` / `agent.running` / `harness.event` 按（与
  preload 一致的）通道名路由，payload 原样透传；其余归入
  `pi-harness:runtime:event`。
- **修复**：broadcast Lagged 时继续消费（原 `while let Ok` 会退出循环）；
  `result: null` 响应被误判协议违规（serde `Option` 无法区分 null 与
  缺失，改为键存在性判别 + 回归测试）；广播容量 256 → 1024。
- `RuntimeSupervisor::with_extra_env` 测试缝。

### 渲染层

- `src/platform/tauri.ts`：`sessions` / `agent` / `harness` 三命名空间经
  `runtime_request` 实装（§23：Vue 调用形态不变）；控制面方法保持
  `SHELL_METHOD_PENDING` 拒绝桩。
- `getRuntimeApi()` 平台能力助手（§25：宿主判断集中在 platform/）。
- `RuntimeStatusBanner.vue`：运行时崩溃恢复 UI（§29），Crashed → 一键
  Restart；8 语言文案。

### 工具与文档

- `pnpm dev:runtime`（§32，stdin 可直接喂 JSONL）。
- `docs/tauri-migration/{protocol,runtime,agent-runtime,events}.md` 更新/新增；
  兼容矩阵更新（§40）。

## 测试

- 运行时：**49** 单测全绿（`vitest run runtime/src`）—— RPC 解析、
  恶意输入、ping、session 列表、agent start/state、事件信封 sequence、
  abort、harness state/model/thinking/tools/compaction、批处理时序。
- Rust：**16** 单测 + **1** 集成测试全绿（`cargo test`）—— 集成测试覆盖
  Rust → 运行时 → mock SDK → agent 事件 → Rust 广播全链路（§34）。
- 平台桥：13 测全绿；`vue-tsc` node+web 双工程零错误。
- `pnpm typecheck` 全绿（顺带修复 Phase 1 遗留的 aiMotion→agentAura
  漂移导致的类型错误，以及 `@tauri-apps/api` 未安装导致的解析错误）。

## 验收场景状态

| 场景 | 内容 | 状态 |
| ----- | ---- | ---- |
| A | 启动不触 runtime，普通页正常 | ✅ 未接线方法静默 pending；runtime 零启动 |
| B | 进 workspace → 懒启动 → SDK 懒加载 → 会话列表 | ✅ 集成链验证（自动启动 + mock SDK 列表路径）|
| C | start → prompt → 流式 → tool 事件 → complete | ✅ 集成测试覆盖事件转发；真实 SDK 流式待 §35 E2E |
| D | prompt → abort → 再 prompt | ✅ 运行时单测（abort 后可再 prompt）|
| E | compaction → complete → 续 prompt | ✅ 运行时单测（mock compaction 事件）|
| F | 切 model → 切 thinking → prompt | ✅ 运行时单测（setModel/setThinkingLevel 校验链）|
| G | runtime crash → UI 不退 → Crashed → Restart | ✅ Rust 单测（crash 相位转换）+ Banner UI；E2E 待 §35 |

## 未尽事项（下一阶段）

- Harness 控制平面（Run/Checkpoint/Policy/Artifacts/Baseline）——
  桩已就位，`api-types` 面 24 方法。
- `sessions.export / exportProject / contextMenu`（文件系统面，Rust 侧）。
- Tauri E2E（§35，需 tauri-driver 环境）与真实 SDK smoke（需 API token）。
- 打包：runtime/dist + node_modules 随资源分发（dev 期路径解析已就绪）。
- First Token Event Latency 指标（§36 其余项：sdkLoaded / piSdkLoadMs / firstAgentStartMs 已埋）。
