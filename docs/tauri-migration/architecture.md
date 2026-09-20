# 目标架构（第一阶段）

## 总览

```
┌────────────────────────────────────────────────────────────┐
│  Vue 3 渲染层（不重写）                                       │
│  src/renderer — 页面 / 组件 / stores / composables           │
│  只依赖 window.piSwitch（PiSwitchAPI 契约）                   │
└───────────────┬────────────────────────────────────────────┘
                │ window.piSwitch（平台无关契约）
┌───────────────┴────────────────────────────────────────────┐
│  平台桥接层 src/platform/                                    │
│  detect.ts / boot.ts / tauri.ts / electron.ts / types.ts    │
│  Tauri: invoke()/listen() 桥实现；Electron: 直接读取 preload  │
└───────────────┬────────────────────────────────────────────┘
                │ Tauri IPC（commands / events）
┌───────────────┴────────────────────────────────────────────┐
│  Rust 桌面宿主 src-tauri/                                    │
│  窗口 / 系统集成 / RuntimeSupervisor（进程监督）               │
│  不含业务逻辑 — 业务全部在 Node 侧                            │
└───────────────┬────────────────────────────────────────────┘
                │ JSONL RPC（stdin/stdout, 协议版本 1）
┌───────────────┴────────────────────────────────────────────┐
│  Node.js 运行时 sidecar runtime/                             │
│  请求分发 / 事件广播 / 优雅停机                               │
│  （后续阶段在此接入 Pi SDK：agent / harness / git / skills…）  │
└────────────────────────────────────────────────────────────┘
```

## 模块职责

### 1. 渲染层（不变）

- 所有业务 UI 逻辑留在 `src/renderer`。
- 仍然通过 `getApi()`（`src/renderer/src/composables/useApi.ts`）拿 `window.piSwitch`。
- `main.ts` 之前的 `platform-boot.ts` 脚本保证：`main.ts` 执行时桥已就绪
  （模块脚本按文档顺序执行 + 顶层 await）。

### 2. 平台桥接层（`src/platform/`）

| 文件          | 职责                                                               |
| ------------- | ------------------------------------------------------------------ |
| `detect.ts`   | 宿主探测（`__TAURI_INTERNALS__`）+ `SHELL_METHOD_PENDING` 错误载荷 |
| `boot.ts`     | 一次性安装桥；Electron 下 no-op                                    |
| `tauri.ts`    | 完整 `PiSwitchAPI` 实现（invoke/listen 映射）+ 拖拽区 shim         |
| `electron.ts` | Electron 访问器（preload 是真正的桥）                              |
| `types.ts`    | `runtime` 扩展命名空间类型（Tauri 独有）                           |
| `env.d.ts`    | `__TAURI_SHELL__` 编译期开关声明                                   |

要点：

- **单一 Tauri 导入点**：只有 `tauri.ts` 引 `@tauri-apps/api`。
- **编译期裁剪**：`__TAURI_SHELL__` 在 Electron 构建中为 `false`，
  Rollup 死代码消除把动态 `import('./tauri')` 从 Electron 包里完全剔除
  （已验证：`out/renderer` 中无任何 tauri 痕迹）。
- **未实现方法**：通过 Proxy 工厂返回 rejected promise
  （`SHELL_METHOD_PENDING` 结构化错误），渲染层错误管线照常展示。

### 3. Rust 宿主（`src-tauri/`）

| 模块                    | 职责                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `commands/`             | Tauri 命令薄层（system / window / runtime），错误统一序列化为 `AppErrorPayload` 形状 |
| `runtime/supervisor.rs` | RuntimeSupervisor：spawn / 握手 / 请求关联 / 事件扇出 / 崩溃隔离 / 优雅停机          |
| `runtime/protocol.rs`   | JSONL 协议解析（与 TS 侧镜像）                                                       |
| `process/`              | Node 二进制与 runtime 脚本路径解析                                                   |
| `system/`               | 系统集成（open / showItem，argv 直传不经 shell）                                     |
| `error.rs`              | `AppError`（渲染器兼容的序列化形状）                                                 |
| `state.rs`              | 受管状态（supervisor + 版本）                                                        |

设计决策：

- **窗口命令**（minimize / maximizeToggle / close / start_drag）直接操作
  Tauri 主窗口；**没有 `src/window/` 目录** — 窗口逻辑是命令层的一行转发，
  不需要独立子系统（Electron 侧对应 `src/main/window/`）。
- **懒启动**：`setup()` 只挂事件转发器，不 spawn 运行时。
- **世代计数**：每次 spawn 递增；退出监视器带世代校验，
  重启竞态下旧监视器不会污染新进程的状态。
- **崩溃语义**：非正常退出 → `Crashed` 相位 + 广播；外壳与 UI 不受影响。
- **无自动重启**：重启是显式操作（`runtime.restart`）。

### 4. Node 运行时 sidecar（`runtime/`）

- 独立 npm 包（`pi-harness-runtime`），**零依赖**、ESM、TypeScript。
- stdout 只承载协议（JSONL）；诊断走 stderr。
- `runtime/dist/index.js` 由根脚本 `pnpm runtime:build` 产出（复用根
  typescript，无独立 node_modules）。
- 当前方法：`runtime.ping` / `runtime.version` / `runtime.status` /
  `runtime.shutdown`；后续阶段在此进程内接入 Pi SDK。

## 数据流示例（runtime.ping）

```
Vue 调用: api.runtime.ping()
  → platform/tauri.ts: invoke('runtime_ping')
    → commands/runtime.rs: supervisor.request("runtime.ping")
      → supervisor: 写 JSONL 到 sidecar stdin, 挂起 pending oneshot
        → runtime/dispatch.ts: 返回 { pong: true, timestamp }
      → stdout reader: 解析响应, resolve pending
    → 命令返回 RuntimePingResult
  → platform 层原样返回
```

## 事件流

```
sidecar stdout 事件 → supervisor broadcast → tauri app.emit
  → platform/tauri.ts subscribe → piSwitch.on(...) 监听器
```

运行时生命周期事件（Tauri 侧）：

- `pi-harness:runtime:state` — 相位变化 `{ phase }`
- `pi-harness:runtime:event` — 运行时事件 `{ event, payload }`
- `pi-harness:runtime:log` — stderr 日志行 `{ line }`

## 帧窗口拖拽（macOS 细节）

渲染层标题栏依赖 `-webkit-app-region: drag`，WKWebView 忽略该属性。
平台层安装 mousedown shim：命中 `.drag-region`（且不在 `.no-drag` 内）的
左键按下转发到 Rust `window_start_drag`（内部即 `start_dragging()`）。
不改任何 Vue 组件。
