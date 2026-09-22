# Harness Control Plane（Runtime）

Phase 3 把 Electron `HarnessRuntime` 的控制平面迁入 Node sidecar。

```text
HarnessService (session / agent / compaction)
        │
        ▼  harness.event
ControlPlaneService
        ├── RunRegistry + JsonRunRepository
        ├── PolicyEngine + policy-tool-guard
        ├── CheckpointService
        ├── EvaluationService
        ├── ArtifactService
        ├── TraceService + ReplayService
        ├── RegressionService (baseline)
        └── RunExportService（只渲染内容，不写用户路径）
```

数据文件与 Electron 相同，根目录由宿主注入 `PI_HARNESS_USER_DATA`：

- `harness-runs.json`
- `harness-policy.json`
- `harness-checkpoints.json`
- `harness-evaluations.json`
- `harness-artifacts.json`
- `harness-traces.json`
- `harness-baselines.json`
- `harness-store-settings.json`

导出：Runtime 返回 `{ content, path, cancelled }`；Tauri 宿主负责保存对话框。
`ask` 策略在 sidecar 无窗口时按 Electron 缺窗规则拒绝。
