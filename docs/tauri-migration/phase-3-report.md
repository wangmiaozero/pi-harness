# Pi-Harness Tauri Migration Phase 3

对应任务 `task/14-Pi 生态里最好用.md`。

## Branch

`refactor/tauri-v2`（未改 `main`，未删 Electron）

## Architecture

```text
Vue 3
  → Platform Bridge (src/platform/tauri.ts)
    → Tauri 2 / Rust RuntimeSupervisor
      → JSONL RPC
        → Node sidecar
          ├── Session / Agent / Harness Core（Phase 2）
          ├── Harness Control Plane
          └── Multi-Agent Orchestration
                → Pi Coding Agent SDK
```

Vue 不调度 Agent / Task。Scheduler 只在 Runtime。

## Harness Control Plane

`runtime/src/harness-control/`：Runs / Tree / Compare / Baseline / Policy /
Checkpoint / Evaluation / Artifacts / Stats / Export / Trace / Replay。

RPC 名与 Electron `register-harness` 一致，经 `runtime_request` 转发。

## Run Management

Session ≠ Run。`RunRegistry` 观察 harness 事件，落盘 `harness-runs.json`。
事件复用现有类型：`run.started` / `run.completed` / `run.failed` / `run.aborted`。
`getRunTree` 返回结构化树（fork / retry / checkpoint parent）。

## Checkpoints

`CheckpointService`：list / create / resume / fork。Resume 走原 session tree；
Fork 走 Pi fork。格式兼容 Electron userData。

## Policy

`PolicyEngine` + `policy-tool-guard` 在 Runtime 工具边界执行。
sidecar 无窗口：`ask` → deny（与 Electron 缺窗一致）。Vue 只读/写配置。

## Evaluations

`EvaluationService` 绑定 `runId`。preset / lint / test 逻辑从 Electron 迁入，
未重做 Eval Framework。

## Multi-Agent Orchestration

`runtime/src/orchestration/`：CRUD、start / pause / resume / abort、snapshot。
OrchestrationAgent ≠ AgentSession。执行入口只有 `AgentRuntimeManager`。

## Scheduler

`TaskScheduler`：ready 队列、依赖 DAG、concurrency、budget。
不推理；不在 Vue。

## Agents

list / add / update / delete / setAgentBudget。Definition 持久化；
Session 运行期创建，不序列化。

## Tasks

list / create / update / delete / retry / skip / reassign。
状态机：pending → ready → running → completed | failed | skipped | blocked。
completed 不能直接回 running，必须 retry。

## Teams / Templates

Team / Template 与 Orchestration 实例分离。Template 不含 running state。

## Handoffs

`listHandoffs` + 依赖产物交接。Worktree 本阶段回退 shared cwd。

## Budget & Concurrency

Orchestration / Agent 的 token / cost ceiling 在 Runtime 真正暂停。
`maxConcurrentAgents` / `maxConcurrentRuns` 由 scheduler 执行。

## Crash Recovery

sidecar 启动 `recoverAll()`：
- running orchestration → paused（`Interrupted by app restart`）
- running / verifying / review task → pending
- 不标 completed，不自动重跑

## Runtime Data Model

同一套 userData JSON。Tauri `lib.rs` 注入 `PI_HARNESS_USER_DATA`。
导出只返回 `content`，不写用户路径。

## Tests

`pnpm test`：165 files / 968 passed / 5 skipped。

- Runtime + platform 控制面 / orchestration / RPC 隔离测试
- 测试目录用 `PI_HARNESS_USER_DATA` + mkdtemp，避免 policy 泄漏
- Orchestration 终态先写 evaluation 再标 completed，避免评审门竞态

## Electron Compatibility

PASS — `src/main/harness` 未删，`pnpm dev:electron` 仍走原主进程。

## Tauri Status

PASS — Control Plane + Orchestration 经 Platform Bridge → `runtime_request`。

## Commands Verified

见本轮验证输出。`pnpm build:tauri` 本阶段未打生产包（dev:tauri 已由用户启动）。

## Compatibility Matrix

见 `docs/tauri-migration/compatibility-matrix.md`。
`harness` 控制平面与 `orchestration` 全部 ✅。未迁 Git / Worktree / Skills / Updater。

## Performance Observations

控制面读写本地 JSON，无轮询。Scheduler 事件驱动。未做新的主观评分系统。

## Known Issues

- Worktree 模式回退 shared cwd（任务明确属下一阶段）
- 导出无原生保存对话框（Runtime 只返回 content）
- Electron orchestrator 全量套件偶发时序 flake（单文件重跑通过）

## Risks

- sidecar 与 Electron 共享 userData 时需同一 schema（已对齐）
- Policy `ask` 在 Tauri 无确认窗，危险操作会被 deny

## Files Added

`runtime/src/harness-control/**`、`runtime/src/orchestration/**`、
`runtime/src/support/{json-store,secrets,runtime-log,git-lite}.ts`、
`runtime/src/protocol/domain-control-methods.ts`、
`docs/tauri-migration/{control-plane,orchestration,scheduler,crash-recovery,runtime-data-model,phase-3-report}.md`

## Files Modified

`runtime/src/{services,protocol/dispatch,protocol/messages,pi/errors}.ts`、
`src/platform/tauri.ts`、`src-tauri/src/lib.rs`、
`docs/tauri-migration/{README,compatibility-matrix}.md`

## Next Phase Recommendation

Git / Worktree / Skills / Packages / Updater。不要在本阶段继续扩。
