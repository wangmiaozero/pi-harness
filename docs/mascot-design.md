# Pi-Harness 看板娘设计规范

## 角色概览

![派可（Pico）角色设定](./mascot/pi-harness-mascot-pico-concept.png)

| 项目     | 设定                                              |
| -------- | ------------------------------------------------- |
| 中文名   | 派可                                              |
| 英文名   | Pico                                              |
| 呼号     | PI-01                                             |
| 定位     | Pi-Harness 本地工作区的无限知识领航员与状态助手   |
| 核心性格 | 冷静、可靠、好奇、善于把复杂知识组织成清晰路径    |
| 角色语气 | 简短、技术化、有行动指向，不卖萌打断工作流        |
| 代表物   | Pi 发夹、连续知识路径、知识图谱终端、轨道式知识环 |

`π` 的小数无限不循环，象征知识没有终点、理解可以持续逼近。派可的职责不是“知道一切”，而是不断探索、校验并建立知识之间的连接。她不是通用聊天机器人，也不是 IDE 功能的拟人化替代；她代表 Pi-Harness 在模型、工具、会话与本地工作区之间组织知识路径、验证结果并保持可靠连接的产品定位。

## 视觉设定

### 轮廓

- 成年女性知识领航员，体态自然、从容，动作以阅读、推演和讲解为主。
- 石墨黑短款不对称波波头，内层保留一束低饱和 Pi 蓝挑染。
- 小型几何 `π` 发夹作为第一识别点，造型来源于 Pi-Harness 应用图标。
- 长款学者领航员外套、高领浅色内搭和深色长裤构成克制、知性的轮廓。
- 一条连续的 Pi 蓝路径贯穿外套前后，既对应 Harness，也象征无限延展的求知路径。
- 半透明知识图谱终端以节点、关系线和同心数据弧表达“理解与连接”，不显示不可验证的装饰性文字。
- 肩后悬浮不闭合的椭圆知识环：蓝色节点持续向外延展，绿色节点表示已验证知识。
- 装备只保留知识终端与最小工具袋；不使用武器、动物耳朵、女仆装或繁复装饰。

### 色彩

颜色应直接复用 `src/renderer/src/styles/tokens.css` 中的设计令牌，不在组件内新增独立品牌色。

| 用途       | 色值                        | 对应令牌                     |
| ---------- | --------------------------- | ---------------------------- |
| 主体深色   | `#16181B`                   | `--bg-window`                |
| 次级深色   | `#25282E`                   | `--bg-surface-raised`        |
| Pi 蓝      | `#5B91F5`                   | `--accent`                   |
| 已验证知识 | `#5ABF8A`                   | `--success`                  |
| 浅色内搭   | `rgba(255, 255, 255, 0.90)` | `--text-primary`（深色主题） |

浅色主题下保持角色服装本色，只调整投影、状态光和气泡背景；禁止对整张角色图进行反相。

## 形态体系

### 可切换风格

应用设置字段为 `mascotStyle`，默认值固定为 `none`，即不显示看板娘。六种可见风格中，前四种共享派可的脸型、短黑发、Pi 蓝内层发色、蓝灰色眼睛和 `π` 发夹；职场黑丝与女仆白丝风格共享参考图中的银白长发成年角色身份。

|                               `knowledge`                               |                             `engineer`                             |                            `maid`                            |                            `mature`                            |
| :---------------------------------------------------------------------: | :----------------------------------------------------------------: | :----------------------------------------------------------: | :------------------------------------------------------------: |
| ![无限知识领航员](../src/renderer/src/assets/mascot/pico-knowledge.png) | ![工程执行者](../src/renderer/src/assets/mascot/pico-engineer.png) | ![女仆助手](../src/renderer/src/assets/mascot/pico-maid.png) | ![成熟御姐](../src/renderer/src/assets/mascot/pico-mature.png) |
|                             无限知识领航员                              |                             工程执行者                             |                           女仆助手                           |                            成熟御姐                            |
|                         知识图谱、无限学习路径                          |                       终端、工具、工程安全带                       |                    技术服务制服、终端托盘                    |                珍珠白主管装、成熟身形与知识终端                |

- **无限知识领航员**：品牌主形象，表达 `π` 的无限不循环小数与持续求知。
- **工程执行者**：强调读取、修改、验证与工具执行，适合偏工程的工作氛围。
- **女仆助手**：强调可靠服务与细致响应；保持端庄、技术化，不使用动物耳朵或夸张性感设计。
- **成熟御姐**：明确为成年女性，采用自然丰盈的胸部曲线与成熟体态；使用珍珠白、浅银和 Pi 蓝知识主管装，保持合体、端庄、不暴露，不使用黑色或近黑色服装。

|                                `office`                                |                                `maidWhite`                                 |
| :--------------------------------------------------------------------: | :------------------------------------------------------------------------: |
| ![职场风格（黑丝）](../src/renderer/src/assets/mascot/pico-office.png) | ![女仆风格（白丝）](../src/renderer/src/assets/mascot/pico-maid-white.png) |
|                            职场风格（黑丝）                            |                              女仆风格（白丝）                              |
|                        白衬衫、铅笔裙与黑色丝袜                        |                            黑白女仆装与白色丝袜                            |

- **职场风格（黑丝）**：银白长发成年角色，采用白衬衫、黑色铅笔裙、黑色丝袜与终端平板。
- **女仆风格（白丝）**：同一银白长发成年角色，采用端庄黑白女仆装、白色丝袜与终端托盘。

|                       设置页选择                        |                         工作区显示                         |
| :-----------------------------------------------------: | :--------------------------------------------------------: |
| ![成熟御姐设置卡片](./mascot/mature-style-settings.png) | ![成熟御姐工作区效果](./mascot/mature-style-workspace.png) |

### 标准立绘

- 用于关于页、首次进入工作区的空状态、发布物料和角色说明文档。
- 建议导出透明背景 PNG/WebP，高度不低于 `1600px`。
- UI 内最大显示宽度不超过主内容区的 `32%`，不得压住主操作按钮。

### Q 版桌面助手

- 三头身，保留发夹、蓝色内层头发、连续知识路径和知识图谱终端四个识别点。
- 用于工作区右下角状态提示；默认显示高度 `96px`，紧凑模式为 `72px`。
- 默认 `pointer-events: none`，不承载必须点击才能完成的功能。

### 状态头像

| 状态       | 表情/动作                          | 状态色            | 触发时机               |
| ---------- | ---------------------------------- | ----------------- | ---------------------- |
| `idle`     | 平静微笑，知识环缓慢停驻           | `--text-tertiary` | 会话空闲               |
| `starting` | 查看知识终端                       | `--accent`        | Agent 启动或模型连接中 |
| `thinking` | 托下巴、视线在知识节点间移动       | `--accent`        | 推理或压缩上下文       |
| `running`  | 图谱节点依次点亮，知识路径轻微呼吸 | `--accent`        | 工具调用或流式输出     |
| `success`  | 闭眼微笑                           | `--success`       | 任务正常完成           |
| `warning`  | 睁眼提醒、橙色感叹提示             | `--warning`       | 配置冲突或可恢复错误   |
| `error`    | 收起笑容、终端显示红色状态点       | `--error`         | 不可继续的运行错误     |

状态信息必须同时通过现有文字、图标或通知呈现，不能只依赖角色颜色和表情。

## 工作区使用规范

### 全局菜单背景

- 左侧导航对应的概览、工作区、厂商、模型、技能、配置、诊断和设置页面均显示当前选中的看板娘背景。
- 背景锚定在页面右下方，位于所有页面内容之后，不能拦截鼠标或键盘事件，也不能降低主要文字与表单的对比度。
- 深色主题不透明度为 `0.11`，浅色主题为 `0.065`；窄窗口进一步降低不透明度和占用宽度。
- 工作区聊天页允许同时保留右下角 Q 版桌面助手，形成“淡背景立绘 + 前景状态助手”的层次；文件编辑内容仍以可读性优先。
- 设置保存后，所有菜单页面的背景与工作区前景角色同步切换；选择“无看板娘”或遇到异常值时不渲染角色图片。

|                             深色主题                             |                                浅色主题                                |
| :--------------------------------------------------------------: | :--------------------------------------------------------------------: |
| ![深色主题全局看板娘背景](./mascot/menu-background-settings.png) | ![浅色主题全局看板娘背景](./mascot/menu-background-settings-light.png) |

### 空状态

- 标准立绘放在主工作区右侧，角色面向输入框或主要操作区域。
- 角色不透明度建议为 `0.18–0.28`，输入框及文字区域保持完整对比度。
- 背景只允许极淡的 Pi 几何线条或知识轨道，不使用整页主题皮肤、花边或高对比装饰框。

### 会话进行中

- Q 版形态锚定在聊天滚动区右下角，位于输入框上方 `16px`，距右边缘 `16px`。
- 保留至少 `120px × 120px` 的安全区，不覆盖代码块复制按钮、滚动按钮或最新消息文本。
- 当窗口宽度小于 `960px`、编辑器为主视图或安全区不足时自动隐藏。
- 状态气泡最多显示两行，每行不超过 18 个中文字符，`3s` 后自动收起。

### 动效

- 空闲：`4–7s` 随机眨眼，呼吸位移不超过 `2px`。
- 运行：知识图谱节点依次点亮，知识环以 `1.6s` 周期轻微明暗变化，不使用持续旋转或大幅弹跳。
- 完成：一次 `600ms` 的成功表情过渡，随后回到空闲。
- 警告：只播放一次 `160ms` 的轻微位移，不抖动整个界面。
- `prefers-reduced-motion: reduce` 或设置中关闭动效时，全部切换为静态状态帧。

## 文案规范

派可只播报与当前工作区状态直接相关的短句，不复述助手完整回答。

| 场景       | 推荐文案              |
| ---------- | --------------------- |
| Agent 启动 | `正在连接当前工作区…` |
| 读取项目   | `项目知识图谱已就绪`  |
| 工具运行   | `正在执行 {toolName}` |
| 正常完成   | `本轮任务已完成`      |
| 配置冲突   | `文件已在外部变更`    |
| 可恢复失败 | `操作失败，可以重试`  |

禁止使用与实际状态不一致的拟人化承诺，例如“我已经修好”或“绝对没问题”。

## 资产与实现边界

- 当前设定图：[`docs/mascot/pi-harness-mascot-pico-concept.png`](./mascot/pi-harness-mascot-pico-concept.png)，尺寸 `1706 × 922`。
- 设定图用于确认角色身份与比例，不直接作为运行时精灵图。
- 六张运行时透明资产位于 `src/renderer/src/assets/mascot/`，统一为 `1024 × 1536` RGBA PNG：
  - `pico-knowledge.png`
  - `pico-engineer.png`
  - `pico-maid.png`
  - `pico-mature.png`
  - `pico-office.png`
  - `pico-maid-white.png`
- 设置页展示全部风格卡片；所有菜单页面加载当前选中的背景风格，工作区聊天页额外显示同风格桌面助手。
- `mascotStyle` 只接受 `none`、`knowledge`、`engineer`、`maid`、`mature`、`office`、`maidWhite`；缺失值、已移除的 `longhair` 或其他异常值回退为 `none`。
- 看板娘属于可选表现层；不得侵入 Agent Runtime、工具调用、文件编辑或 IPC 安全边界。
- 当前只在视口宽度不小于 `1080px` 时展示，避免在最小窗口宽度下遮挡对话。
- 后续如增加“显示看板娘”或独立动效开关，应继续使用应用设置，不写入 Pi 原生配置。

## 最终视觉生成提示词

以下提示词用于复现最终设定方向。首版派可图只作为角色身份锚点，重点修订为“无限知识领航员”。

```text
Use case: identity-preserve
Asset type: revised original character design sheet for the Pi-Harness desktop coding-agent application
Input images: Image 1 is the first Pico mascot draft and identity anchor. Preserve her face, adult age, short asymmetrical graphite-black bob with cobalt-blue inner streak, blue-gray eyes, pi hair clip, clean anime rendering, and Pi-Harness graphite/blue palette. Redesign her role and visual storytelling from a generic field engineer into an "infinite knowledge navigator."
Primary request: Pi represents an infinite non-repeating decimal and, for this product, endless learning and expanding knowledge. Make Pico feel scholarly, insightful, calm, curious, and technically credible at first glance.
Subject redesign: replace the busy utility-worker emphasis with a refined graphite scholar-navigator coat, off-white high-neck inner layer, and one continuous cobalt-blue harness ribbon that loops through the front and back like an endless path while subtly preserving Pi geometry. Keep a minimal tool pouch only. Give her a slim transparent knowledge codex/tablet showing abstract layered knowledge graphs, constellation nodes, and concentric data arcs with no readable text. Add a restrained thin orbital knowledge halo behind one shoulder: incomplete elliptical blue arcs, small points, and a subtle endless-decimal rhythm, elegant and scientific rather than magical. A small mint-green node marks verified knowledge. Optional subtle half-lens/holographic reading display near one eye, not glasses.
Character personality through pose: one hand supports the knowledge codex, the other lightly traces a node in the knowledge graph; composed warm expression of someone explaining a difficult idea clearly.
Color palette: Pi-Harness graphite #16181B and #25282E, accent blue #5B91F5, verified-knowledge mint #5ABF8A, warm off-white. Low saturation, readable on dark and light desktop themes.
Style/medium: premium modern Japanese anime product mascot, crisp clean line art, restrained cel shading, sophisticated and intellectual, professional software brand character.
Composition/framing: clean landscape character sheet on a warm very-light gray background. Include one large full-body front three-quarter view, one smaller back/side outfit view clearly showing the continuous blue knowledge-path harness, one 3-head-tall chibi desktop-assistant version holding a small floating knowledge codex, and four small facial expressions representing calm/idle, focused reasoning, insight/success, and caution. Every figure fully visible with clear separation and generous margins.
Constraints: same character identity and consistent outfit across all views; no text, no captions, no equations that need to be readable, no watermark, original design only. The sense of infinite knowledge must be visible through the continuous path, orbital knowledge graph, and codex.
Avoid: maid costume, frills, animal ears, whale/fish elements, fantasy mage robe, occult magic circles, library background, stacks of books, graduation cap, school uniform, sexualized pose, weapons, excessive belts/carabiners, neon cyberpunk glow, busy background.
```

六张工作区透明资产的最终生成提示词记录在 [`mascot-runtime-prompts.md`](./mascot-runtime-prompts.md)。
