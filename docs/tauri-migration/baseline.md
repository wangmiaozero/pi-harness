# Electron 基线指标

测量环境（2025-09，第一阶段开始时）：

- 机型：Apple Silicon（darwin, arm64）
- 已安装应用：`/Applications/Pi-Harness.app`（v1.6.0，本仓库 `pnpm build:mac` 产物）
- 测量工具：`ps aux`（RSS）、`du`（磁盘）、进程计数
- 状态：应用空闲（首页已渲染，无 agent 会话运行）

## 进程模型

|   # | 进程                                 |                   RSS |
| --: | ------------------------------------ | --------------------: |
|   1 | `Pi-Harness`（main，含全部业务逻辑） |                265 MB |
|   2 | Helper (Renderer)                    |                320 MB |
|   3 | Helper (GPU)                         |                110 MB |
|   4 | Helper (Utility，网络服务）          |                110 MB |
|   5 | Helper（`--type=utility` 媒体）      |                109 MB |
|   6 | Helper（网络服务）                   |                 43 MB |
|   7 | Helper（utility）                    |                 37 MB |
|     | **合计**                             | **≈ 995 MB / 7 进程** |

## 磁盘占用

| 项                                      |       大小 |
| --------------------------------------- | ---------: |
| `/Applications/Pi-Harness.app`（整体）  | **460 MB** |
| ├ `Electron Framework.framework`        |     274 MB |
| ├ `app.asar`（业务代码 + node_modules） |     176 MB |
| └ 其余（辅助框架 / 资源）               |     ~10 MB |
| 开发构建产物 `out/`（dev/compile）      |      98 MB |

## 备注

- 业务主进程 265 MB 中包含 Pi SDK / harness 状态机等 Node 侧常驻内存；
  renderer 320 MB 为 Vue 应用（含图表、代码编辑器等重组件按需 chunk）。
- 7 进程是 Electron mac 运行时的固有模型（chromium 多进程沙箱），
  与业务无关 — 这是 Tauri 迁移的主要优化目标（单进程 + 按需 sidecar）。
- 未测量项：agent 会话峰值内存（需要真实会话负载，阶段 5 对照时补测）。
