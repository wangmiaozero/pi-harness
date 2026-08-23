# Pi-Harness 宠物状态系统

宠物系统是 Pi Agent Runtime 的只读可视化层，不参与 Provider、Session、Streaming、Tool Call 或文件编辑决策。

```text
Pi Agent Runtime
       ↓ existing agent-event / reactive snapshots
Pet Runtime Adapter
       ↓ PetEvent
Pet State Resolver
       ↓ durable PetState
Pet Store
       ↓ runtime state + temporary state
Pet Renderer
       ↓ manifest / sprite / fallback
Mascot UI
```

## 预置主题

系统提供 6 套 RGBA 透明主题，设置页按以下顺序展示：

| ID          | 名称             | 说明                       |
| ----------- | ---------------- | -------------------------- |
| `maidWhite` | 女仆风格（白丝） | 优先主题；直接声明 13 状态 |
| `office`    | 职场风格（黑丝） | 优先主题；直接声明 13 状态 |
| `knowledge` | 无限知识领航员   | 缺失动画按 manifest 回退   |
| `engineer`  | 工程执行者       | 缺失动画按 manifest 回退   |
| `maid`      | 女仆助手         | 缺失动画按 manifest 回退   |
| `mature`    | 成熟御姐         | 缺失动画按 manifest 回退   |

每套主题由独立 `PetManifest` 描述资源、帧尺寸、网格、强调色和状态动画。当前内置 RGBA 立绘作为单单元 Sprite 使用；Renderer 已支持任意 `columns × rows` 多帧图集，后续替换资源不需要修改状态系统。

## 13 个状态

| 状态           | 触发条件                                               |
| -------------- | ------------------------------------------------------ |
| `idle`         | 无任务、无完成态且未达到休眠阈值                       |
| `thinking`     | Thinking 流、上下文压缩开始                            |
| `running`      | Agent 启动、发送中、流式文本输出或任务仍在运行         |
| `coding`       | 活跃 Tool 被识别为源码写入、编辑、Patch 或重构         |
| `tool-calling` | 活跃 Tool 存在，但不是 Coding Tool                     |
| `waiting`      | 确认对话框或 Runtime 明确等待用户                      |
| `review`       | 成功临时动画结束后的稳定完成态                         |
| `success`      | `prompt_done` 后的临时状态                             |
| `failed`       | `prompt_error` 或 Tool 执行失败                        |
| `warning`      | 自动重试、可恢复 Runtime 警告或警告通知                |
| `waving`       | 新 Session，或从 Sleeping 被用户键盘/指针/窗口活动唤醒 |
| `jumping`      | 成功后的可选庆祝临时状态                               |
| `sleeping`     | Runtime 不忙且用户连续空闲达到设置阈值，默认 10 分钟   |

稳定状态优先级为：`failed > waiting > warning > tool-calling > coding > thinking > running > review > sleeping > idle`。休眠判断始终排在运行状态之后，长任务不会误休眠。

## Temporary State

`success`、`waving`、`jumping` 由 Pet Store 的临时状态序列管理：

```text
任务成功: success (1800 ms) → jumping (1500 ms) → resolvePetState() → review
用户唤醒: waving (1500 ms) → resolvePetState() → 当前真实状态
```

临时动画结束时重新执行 Resolver，不直接写入 `idle`。新任务或失败事件会取消旧序列；Store 销毁时会清理全部计时器。

## Runtime Adapter

Renderer 额外订阅现有 `agent-event`，并观察 Agent Store、Session Store 与全局确认对话框。Adapter 只生成 `PetEvent`：

- `agent_start` → `TASK_STARTED`
- Thinking 事件 / Compaction → Thinking start/finish
- Text stream → Stream start/finish
- Tool execution → Tool start/finish
- `prompt_done` → Task succeeded
- `prompt_error` / Tool error → Task failed
- Retry → Warning / Warning cleared

Adapter 不修改现有 Agent Store、Streaming reducer 或 Tool Call 生命周期；卸载时移除 IPC、DOM 监听器和 Vue watchers。

## Tool / Coding 识别

状态只分 `coding` 与 `tool-calling`，不会为 Shell、Git、MCP 等扩充 `PetState`。

- Coding：`apply_patch`、`write_file`、`edit_file`、`create_file`、`replace_code`、`refactor` 等明确写操作。
- Read-only：`read`、`search`、`find`、`list`、`scan`、`view`、`glob`、`grep` 等不会进入 Coding。
- 状态文案可把 Tool 映射为 Shell、Git、MCP、Browser、Search、Filesystem、Skills、Package、Extension 等类别。
- 并发 Tool 中只要存在 Coding Tool 就显示 `coding`；结束后重新从剩余 Tool 计算。

## Sprite Renderer 与回退

Renderer 使用 `requestAnimationFrame` 按 manifest 的 FPS 更新当前帧，用 CSS `translate3d` 移动 Sprite 图集；不以高频 Vue watcher 驱动帧动画。单帧主题使用状态专属 CSS transform 表达动作。

缺失动画按照以下链路回退，最终尝试 `idle`：

```text
thinking → idle
coding / tool-calling → running
waiting / review / warning / sleeping → idle
success → jumping
```

资源加载失败时仅记录警告并显示 `π` Fallback，不向主程序抛出异常。关闭动画或系统启用 reduced motion 时保留静态状态帧。

## Settings 与 Debug

应用设置包含：显示宠物、主题、动画、状态文字、自动休眠、休眠分钟数（1–120）、完成提示音。提示音默认关闭，主题默认 `none`，因此升级后不会强制显示装饰内容。

未打包的开发环境可启用 Developer Mode 查看 Pet Debug Preview。预览支持手动切换全部 13 状态，并显示 Current、Previous、Temporary、Resolved、Current Tool 和完整 Resolver Context；它不修改真实 Runtime。

## 关键文件

- `src/shared/pet/`：类型、Resolver、动画回退、Runtime Adapter、Tool 检测。
- `src/renderer/src/stores/pet.ts`：独立 Pinia Store 与临时状态序列。
- `src/renderer/src/pet/`：运行时安装器和 6 套 manifest。
- `src/renderer/src/components/pet/`：Renderer、Status、Debug Preview。
