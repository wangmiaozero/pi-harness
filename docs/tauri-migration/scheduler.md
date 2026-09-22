# Orchestration Scheduler

`TaskScheduler` 是纯函数：根据 strategy + 依赖 + 并发上限挑下一个 (task, agent)。

| strategy     | 行为                                      |
| ------------ | ----------------------------------------- |
| `manual`     | 不自动派发                                |
| `sequential` | 同时最多 1 个 run，优先级高的先跑         |
| `dependency` | ready 任务并行，受 maxConcurrent* 限制    |

依赖：`completed` / `cancelled` 才算满足；`failed` 使下游保持 blocked。
retry 产生新 Run，保留旧 Run 历史。
