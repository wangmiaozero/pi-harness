# Runtime Crash Recovery（Phase 3）

## Agent / Session

Runtime 重启后内存中的 AgentSession 丢失。Session JSONL 仍在 `~/.pi`。
再次 `agent.start({ sessionId })` 从 SessionManager 恢复。

## Runs

已 finalize 的 Run 在 `harness-runs.json`。历史 Run 仍可从 session JSONL 重建。

## Orchestration

`recoverAll()` 在 sidecar 启动时执行：

- `running` / `paused` 的 orchestration → `paused`，`pausedReason = Interrupted by app restart`
- `running` / `verifying` / `review` 的 task → `pending`，error 标明中断
- 不标 completed，不自动重跑

用户显式 `orchestration.resume` 后 scheduler 重新检查依赖 / budget / ready queue。
