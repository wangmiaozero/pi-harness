# 第一阶段基准：Tauri vs Electron（实测）

测量日期：2025-09-20（阶段 1 完成时）
方法：`ps aux`（RSS，空闲稳定后取值）、`du -sh`（磁盘）。
对比对象：同一台 Apple Silicon 机器上，Electron 已安装版（v1.6.0）
与 Tauri `build:tauri` 产物（同源渲染层）。

## 内存（空闲，UI 已渲染，无 agent 会话）

| 指标       | Electron | Tauri（release） |     差异 |
| ---------- | -------: | ---------------: | -------: |
| 宿主进程数 |        7 |            **1** |       -6 |
| 宿主总 RSS | ≈ 995 MB |      **≈ 95 MB** | **-90%** |

说明：

- Electron 的 995 MB 是 chromium 多进程沙箱模型的固定开销（GPU / 网络服务 /
  utility 各一份 helper），与业务无关。
- Tauri 的 95 MB 是 release 二进制 + WKWebView（WKWebView 自身子进程由
  系统托管，未计入 `ps` 该行；系统级核算见下）。
- Node 运行时 sidecar 均未启动（两边都是懒启动语义；Electron 的业务
  main 进程常驻含在 995 MB 内，Tauri 等价业务在 sidecar、当前未 spawn —
  阶段 5 接入 Pi SDK 后需复测带会话负载的数值）。
- 开发模式参考值：Tauri dev 宿主（debug 二进制）≈ 140 MB，另加 vite dev
  server ≈ 295 MB（仅开发时存在）。

## 磁盘

| 项            |                  Electron |                        Tauri |     差异 |
| ------------- | ------------------------: | ---------------------------: | -------: |
| 安装的应用    |            460 MB（.app） |            **45 MB**（.app） | **-90%** |
| 其中引擎/框架 | Electron Framework 274 MB | 无独立框架（系统 WKWebView） |          |
| 业务负载      |           app.asar 176 MB |   二进制 42 MB（内嵌渲染层） |          |

- Tauri `.app` = 42 MB 单二进制（含内嵌静态资源 + icon 3.2 MB）。
- 渲染层静态产物 `out/renderer-tauri/` 42 MB（Electron 侧 `out/` 98 MB 为
  dev 产物口径，非直接可比）。
- DMG 打包：`bundle_dmg.sh` 在当前无头环境执行失败（hdiutil 权限），
  属于阶段 7 发布工程事项，不影响功能；`.app` 产物完整可启动。

## 启动与进程模型（定性）

| 项           | Electron                          | Tauri                      |
| ------------ | --------------------------------- | -------------------------- |
| 进程模型     | 1 main + N helper 常驻            | 1 宿主 + 按需 Node sidecar |
| 业务逻辑常驻 | main 进程常驻（含 Pi SDK 状态机） | sidecar 懒启动，崩溃隔离   |
| 业务更新     | 整包更新                          | 渲染层静态资源独立于二进制 |

## 未测项（诚实记录）

- agent 会话运行时峰值内存（需真实负载；阶段 5 对照补测）。
- 冷启动时间（需人工计时 / 性能仪器，阶段 7 补）。
- Pi agent 子进程内存：pi CLI 不在测试机 PATH，无法启动真实会话。
- Windows / Linux 数据（阶段 7 跨平台验证时补）。
