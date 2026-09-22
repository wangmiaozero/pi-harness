# Runtime Data Model

```text
Session (Pi JSONL, ~/.pi)
 └── Run (prompt → tools → settlement)
      ├── Trace / Replay events
      ├── Artifacts (metadata)
      ├── Checkpoints (session entry + optional git HEAD)
      └── Evaluation (deterministic checks)

Orchestration
 ├── Agents (definitions; live sessionId while running)
 ├── Tasks (DAG + assignedAgentId + runIds)
 ├── Handoffs (fromAgent → toAgent + artifactIds)
 └── Teams / Templates (reusable, no live state)
```

交叉引用：

- Run.agentId / taskId / orchestrationId
- Task.runIds / lastRunId
- Artifact.producedByAgentId / producedByTaskId

Session ≠ Run。一次会话可有多条 Run。
OrchestrationAgent ≠ Pi AgentSession。
