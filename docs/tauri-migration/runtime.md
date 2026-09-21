# Runtime 生命周期（Rust ↔ Node）

第二阶段新增。描述 Pi-Harness Node 运行时（sidecar）的完整生命周期：
谁启动它、什么时候启动、怎么死、死了怎么办。

## 组件

```text
渲染层 (Vue)
  ↓ invoke('runtime_request', …) / pi-harness:* 事件
Tauri 命令层 (src-tauri/src/commands/runtime.rs)
  ↓ desktop_request()
RuntimeSupervisor (src-tauri/src/runtime/supervisor.rs)
  ↓ spawn node + JSONL stdin/stdout
Node 运行时 (runtime/dist/index.js)
  ↓ 动态 import（懒加载）
Pi Coding Agent SDK (@earendil-works/pi-coding-agent)
```

## 生命周期状态机

```text
Stopped ──start()──→ Starting ──握手成功──→ Running
   ↑                   │                        │
   │                   └── spawn 失败/握手失败 ──┤
   │                                            │
   └────stop()──── Stopping ←──── exit / crash ─┴──→ Crashed
```

- `Starting`：进程已 spawn，等待 `runtime.version` 握手（超时 30s）。
- `Running`：JSONL 双向通道就绪。**SDK 此时尚未加载** —— 首个
  `agent.start` 才触发 `import('@earendil-works/pi-coding-agent')`。
- `Crashed`：进程意外退出（非 shutdown）。UI 收 `runtime:state` 事件，
  `RuntimeStatusBanner` 展示崩溃条，用户可 Restart。
- `Stopped`：正常停机（app 退出或显式 stop）。

## 懒启动（场景 B）

渲染层不感知启动时序：任何域方法（`session.list`、`agent.start`…）经
`runtime_request` 到达时，若 phase 为 Stopped/Crashed，supervisor 自动
先 `start()` 再转发。Starting 中的请求直接排队转发（握手完成后响应）。
因此「进入 Agent Workspace → 请求会话列表」本身就是启动入口，
**没有显式的 runtime 启动按钮**。

## 进程解析

- Node 二进制：`PI_HARNESS_NODE` 环境变量 → PATH 上的 `node`。
- 入口脚本：`<repo>/runtime/dist/index.js`（dev；打包阶段随资源分发）。
- 额外环境：`PI_HARNESS_PI_CONFIG_DIR`（Pi agent dir 覆盖）；
  `PI_HARNESS_TEST_PI_SDK`（仅测试，注入 mock SDK 模块路径）。

## 崩溃与恢复（§29/§30）

Rust 侦测子进程退出 → phase 置 `Crashed` → 广播 `pi-harness:runtime:state`
→ `RuntimeStatusBanner` 给出一键 Restart。恢复语义：

- 运行时内存态（活跃 AgentSession、事件批）丢失，**属预期**。
- 持久会话（SessionManager 的 JSONL）不受影响；重启后 `session.list`
  照常，重新 `agent.start(sessionId)` 即可恢复。
- 渲染层各 store 的静默刷新失败不白屏；控制面 load 为 best-effort。

## 优雅停机（§28）

App 退出 → `RuntimeSupervisor::shutdown()`：

1. 发 `runtime.shutdown` RPC。
2. 运行时回 `{ stopping: true }` → 广播 `runtime.stopping` →
   flush 事件批 → `process.exit(0)`（2s watchdog 兜底）。
3. Rust 等待退出；超时关 stdin（stdin EOF 即退）；最终 kill 兜底。

## 观测（§36）

`runtime.status` RPC 返回 timing 字段（平铺）：

```json
{ "sdkLoaded": true, "piSdkLoadMs": 1043, "firstAgentStartMs": 2651 }
```

（未发生时为 `null`；`uptimeMs` 提供进程存活时长。）

stderr 全量由宿主收集（`SupervisorEvent::Log`），转发到
`pi-harness:runtime:log` 通道；stdout 只有 JSONL 协议（§31）。

## 测试

- 单元：`runtime/src/**/*.test.ts`（49 例，mock SDK）。
- 宿主集成：`src-tauri/tests/runtime_forwarding_test.rs`
  （Rust → 运行时 → mock SDK → agent 事件 → Rust 广播断言）。
- 手动：`echo '{"id":"1","method":"runtime.ping","params":{}}' | pnpm dev:runtime`。
