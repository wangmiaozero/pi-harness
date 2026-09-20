# 迁移计划（分阶段）

原则：**Electron 主线随时可发布**；Tauri 分支每阶段收敛一个可验证的
垂直切片；渲染层零改动（除 `platform-boot` 一处安装脚本）。

## 阶段总览

| 阶段 | 主题         | 交付物                                                                     | 状态              |
| ---- | ------------ | -------------------------------------------------------------------------- | ----------------- |
| 0    | 基线         | Electron 指标记录（[baseline.md](./baseline.md)）                          | ✅ 完成           |
| 1    | 桌面外壳替换 | 平台桥接层 + Rust 宿主 + Node sidecar + JSONL RPC + `runtime.*` 命令       | ✅ 完成（本分支） |
| 2    | 配置与设置   | `settings` / `pi` / `config` / `logs` / `diagnostics` 进运行时；设置页可用 | ⬜                |
| 3    | 提供商与模型 | `providers` / `models` / `backup`                                          | ⬜                |
| 4    | 技能与能力   | `skills` / `capabilities`（含包注册表）                                    | ⬜                |
| 5    | 会话与 Agent | `sessions` / `agent` / `harness` / `files` — Pi SDK 接入运行时             | ⬜                |
| 6    | 工作区与 Git | `workspace`（含原生对话框）/ `git` / `worktrees` / `orchestration`         | ⬜                |
| 7    | 发布工程     | updater（Tauri 插件）/ 深度链接 / 单实例 / 安装包与签名 / overlay 窗口     | ⬜                |

## 阶段 1 交付清单（本分支）

1. **平台桥接层** `src/platform/`（detect / boot / tauri / electron / types）
   - 完整 `PiSwitchAPI` 形状：实现 `system` / `window` / `on`，
     其余命名空间返回 `SHELL_METHOD_PENDING` 结构化错误。
   - 编译期 `__TAURI_SHELL__` 开关：Electron 构建完全剔除 Tauri 代码
     （已验证 `out/renderer` 无 tauri 痕迹）。
   - 拖拽区 shim（`.drag-region` mousedown → `window_start_drag`）。
2. **渲染层接入**：`index.html` 增加 `platform-boot.ts` 模块脚本（先于
   `main.ts`；Electron 下 no-op）。无其他渲染层改动。
3. **Rust 宿主** `src-tauri/`：commands（system / window / runtime）、
   RuntimeSupervisor（世代计数防重启竞态、握手校验、优雅停机、崩溃隔离、
   懒启动）、JSONL 协议解析、Node/脚本路径解析。
4. **Node sidecar** `runtime/`：零依赖 ESM 包，协议 v1 全方法
   （ping / version / status / shutdown），stdout 纯协议、stderr 诊断。
5. **构建与验证**：`vite.tauri.config.ts`、`dev:tauri` / `build:tauri` /
   `runtime:build` 脚本；`pnpm typecheck / lint / test / compile` 全绿
   （Electron 不回归）；`cargo test` 拉起真实 Node sidecar 验证
   Rust↔Node↔Rust 全链路。
6. **文档**：本目录全部文档。

## 阶段 1 刻意不做（决策记录）

- **不自启运行时**：设置/主题/关于页不需要 Node。首个依赖运行时的调用
  （阶段 2 的 settings 读取）负责 spawn。
- **不打包 runtime 进安装包**：`resolve_runtime_script` 目前指向仓库内
  `runtime/dist/index.js`（dev 优先）。资源打包（`resource` bundle +
  路径解析调整）在阶段 7 发布工程解决；在此之前 `build:tauri` 产物
  启动 runtime 会因找不到脚本而报 `RUNTIME_ERROR`（UI 正常）。
- **不做 overlay 窗口**：入口未开放（Electron 下该窗口也从不自动打开）。
- **不迁移任何业务命名空间**：见兼容性矩阵。

## 阶段 2 预览（设置与配置）

- 运行时新增 `settings.*` / `config.*` / `pi.*` / `logs.*` / `diagnostics.*`
  方法组（文件系统操作全部在 Node 侧完成）。
- 平台层：去掉对应 `pendingNamespace`，改为 RPC 转发助手
  （`invokeRpc(method, params)`）。
- 首个依赖运行时的页面改为「启动运行时 → 等待 running → 调用」。
- 事件源迁移：`config-changed` / `pi-environment-changed` 由运行时广播。

## 回滚

任一阶段发现问题：切回 main 分支即可 — Electron 构建链路、发布脚本
与 `task` 工作流完全未动。Tauri 分支不合并到 main 直到阶段 7 完成并通过
发布演练。
