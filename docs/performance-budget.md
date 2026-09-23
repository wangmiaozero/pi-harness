# 性能预算

数字只来自本机实测。测不到的项不写目标数字。

环境：darwin arm64，Node v26.7.0，2026-09-23。

## 已测

| 项 | 预算 | 实测 |
| --- | --- | --- |
| Sidecar time-to-ready | < 800ms | 20 次重启，median **151ms**，max **163ms**（`pnpm test:stress`） |
| 空闲时 sidecar | 不随 Settings/About 启动 | 仍是懒启动：`desktop_request` / 显式 `start` 才 spawn |
| Runtime Ready | 不依赖 Provider 网络、npm、Git | `runtime.handshake` 只交换协议版本 |

## 未测，因此不设漂亮目标

| 项 | 原因 |
| --- | --- |
| Cold Start / Warm Start（GUI） | 本轮没有交互式窗口计时 |
| Idle RAM / Agent RAM / Multi-Agent RAM | 没有 5-run `ps` 协议 |
| Streaming CPU | 没有真实模型流 |

这些项的预算是：**下次有仪器数据再定，不使用估算值。**

Phase 6 安装体积（供对照，不是本轮复测）：Electron `.app` 502MB，Tauri `.app` 425MB，DMG 129MB。见 [phase-6-report.md](./tauri-migration/phase-6-report.md)。
