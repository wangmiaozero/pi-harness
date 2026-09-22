# Multi-Agent Orchestration（Runtime）

Orchestration 状态机跑在 Node sidecar，Vue 只创建 / 查看 / 暂停 / 恢复 / 停止。

```text
OrchestratorService
        │
        ├── OrchestrationStore（harness-orchestration.json）
        ├── TaskScheduler
        ├── AgentManager
        ├── TeamService / Templates
        └── HandoffService
                │
                ▼
        AgentRuntimeManager → Pi AgentSession
                │
                ▼
        ControlPlane Run / Artifact
```

- Agent Definition 长期存在；AgentSession 是运行期实例，不序列化。
- Task 依赖由 Runtime DAG 判断，不在 Vue。
- Budget / maxConcurrentAgents / maxConcurrentRuns 在 scheduler 真正执行。
- Crash 后 `recoverAll()`：running task → pending（带 interrupted 原因），orchestration → paused。不自动重跑。
- Worktree 模式本阶段回退到 shared cwd（Git Worktree 属下一阶段）。
