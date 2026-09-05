# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="110" alt="Pi-Harness" />
</p>

<h3 align="center">Pi Coding Agent 桌面 Harness 与控制中心</h3>

<p align="center">
  <strong>将 Pi Agent Harness 带入可视化桌面工作区。</strong>
</p>

<p align="center">Everything around Pi, in one place.</p>

<p align="center">
  管理模型 · 运行 Agent · 查看 Harness 状态 · 使用 Skills · 浏览文件 · 操作 Git
</p>

<p align="center">
  <a href="#下载"><strong>下载 Pi-Harness</strong></a> ·
  <a href="README.md">English</a> ·
  <a href="https://github.com/earendil-works/pi">Pi Agent Harness</a> ·
  <a href="docs/workspace.mp4?raw=1">观看演示</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.2.0"><img alt="v1.2.0 发布版" src="https://img.shields.io/badge/release-v1.2.0-4C8DFF?style=flat-square" /></a>
  <img alt="支持 macOS、Windows 和 Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only 许可" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

<p align="center">
  <a href="docs/workspace.mp4?raw=1"><img src="docs/workspace.gif" width="920" alt="Pi-Harness 工作区演示" /></a>
</p>

<p align="center">
  ⭐ <a href="https://github.com/wangmiaozero/pi-harness/stargazers">点个 Star</a>，关注 Pi-Harness 接下来的 Harness Console 更新。
</p>

## 为什么是 Pi-Harness？

[Pi Coding Agent](https://github.com/earendil-works/pi) 本身已经拥有强大的 Agent Harness。大量 Runtime、Context、Tools、Compaction、Queue 和 Session 能力天然存在于 CLI 与 SDK 行为之中。

Pi-Harness 的目标，是把这些能力真正做成可见、可控、可管理的原生桌面产品，并和日常使用 Pi 所需的配置与项目工具放在一起。

> **Pi 负责运行 Agent。Pi-Harness 负责让你看见并控制它是如何运行的。**

Pi-Harness 不是网页套壳：不嵌入 pi-web、Next.js 服务或 iframe，也不增加第二套 Agent Runtime。

## 基于 Pi Agent Harness

[Pi 官方项目](https://github.com/earendil-works/pi) 已经提供 Agent Harness，并由它驱动 Pi Coding Agent。

Pi-Harness 不替换、也不重新实现这套 Runtime。真正负责 Agent Loop、工具、上下文、压缩和会话执行的，始终是 Pi Coding Agent 与 Pi Agent Harness。

Pi-Harness 提供围绕它的桌面控制平面、可视化、配置和工作区：

- 查看 Runtime 与 Context 状态
- 启动、继续、Fork 和导航 Session
- 选择模型、Thinking Level 与工具
- 控制 Compaction、Steering 和 Follow-up
- 观察流式回复、Thinking、Tool Call 与 Agent Event
- 在 Agent 旁边使用文件和 Git

**基于 Pi Agent Harness。**

## 现在已经具备什么

以下都是当前能力，不是 Roadmap 声明：Pi-Harness 可以启动和继续 Pi 兼容 Session；展示流式回复、Thinking、Tool Call、Context 使用量和 Session Stats；切换模型、Thinking Level 与工具预设；控制 Compaction；发送 Steering 与 Follow-up；以及 Fork 或导航 Session 历史。

周边桌面能力汇总如下。

## 核心功能

| 模块              | Pi-Harness 提供的能力                                    |
| ----------------- | -------------------------------------------------------- |
| 概览              | 展示环境、配置和当前模型状态                             |
| 工作区            | 在项目文件、Git 与 Worktree 旁运行 Pi Session            |
| Pi Runtime        | 展示流式输出、Thinking、Tool Call、Context、Queue 与统计 |
| Provider 与模型   | 管理 Pi 兼容 Provider 和模型                             |
| Skills 与 Package | 管理受支持的 Skills、Pi Package 与 MCP 扩展              |
| 文件              | 提供显式保存、冲突保护和轻量文本编辑                     |
| 诊断              | 查看应用、环境、存储和工作区健康状态                     |
| 更新              | 安装兼容的应用更新                                       |
| 外观              | 提供明暗主题、密度、驾驶舱模式和特色主题                 |

### 轻量编辑器，不是 IDE

Pi-Harness 可以编辑可读文本文件，支持懒加载语法高亮、行号、撤销/重做、查找、显式保存、未保存状态和外部变更冲突保护。超大文件、二进制、媒体和文档使用只读预览。

它不提供 LSP/IntelliSense、语义重构、调试器、任务运行器、集成终端或 IDE 扩展兼容。

## 架构

Pi-Harness 将桌面控制平面与持续完善的可视化 Harness Console 分层，同时始终保持 Pi Coding Agent 是唯一 Agent Runtime。

```text
                         Pi-Harness

             ┌──────────────┴──────────────┐
             │                             │
       Control Plane                 Harness Console
             │                             │
        Providers                      Runtime
        Models                         Context
        Skills                         Tools
        Packages                       Thinking
        Environment                    Compaction
        Config                         Sessions
        Updates                        Timeline
             │                             │
             └──────────────┬──────────────┘
                            ▼
                    Pi Agent Harness
                            │
                            ▼
                    Pi Coding Agent
                            │
                            ▼
                         Models
```

Control Plane 负责管理 Pi 周边能力；Harness Console 的产品方向是把 Pi Agent Harness 可视化。尚未发布的界面能力会在下方明确标注为 Roadmap。

Pi-Harness 通过 Pi 的 Runtime 接口与其连接。Session 与 <code>~/.pi/agent/sessions/</code> 下的 Pi CLI JSONL 保持兼容。

## 当前界面

### 工作区

打开真实项目，新建或继续 Pi Session，让流式输出、项目文件与 Git 变更处在同一个原生工作区里。

<p align="center">
  <a href="docs/workspace.mp4?raw=1"><img src="docs/workspace.gif" width="920" alt="Pi-Harness 当前工作区" /></a>
</p>

|              项目会话               |            文件与轻量编辑             |
| :---------------------------------: | :-----------------------------------: |
| ![工作区会话](docs/workspace-1.jpg) | ![工作区编辑器](docs/workspace-2.jpg) |

![星际驾驶舱工作区](docs/workspace-3.jpg)

### Provider、模型与 Skills

|            Provider 列表            |            Provider 配置            |
| :---------------------------------: | :---------------------------------: |
| ![提供商列表](docs/providers-1.jpg) | ![提供商详情](docs/providers-2.jpg) |
|            **模型列表**             |            **模型配置**             |
|   ![模型列表](docs/models-1.jpg)    |   ![模型详情](docs/models-2.jpg)    |

![技能市场](docs/skills.jpg)

## 接下来

Pi-Harness 正在从桌面控制中心继续升级为完整的 Pi Agent Harness 可视化控制台。

下一阶段的重点，是让 Runtime 状态更容易检查，同时不替换 Pi 已经提供的 Runtime。

### Harness Console — 规划中的 UI / Roadmap 预览

```text
┌──────────────────────────────────────────────┐
│ HARNESS                                      │
│                                              │
│ ● Running                                    │
│                                              │
│ Runtime                                      │
│ ───────────────────────────────────────────  │
│ Model              claude-sonnet             │
│ Thinking           High                      │
│ Status             Running                   │
│                                              │
│ Context                                      │
│ ───────────────────────────────────────────  │
│ 74,120 / 128,000                             │
│ █████████████░░░░░░ 58%                      │
│                                              │
│ Compaction                                   │
│ Auto               ON                        │
│ Running            NO                        │
│                                              │
│ Tools                                        │
│ ✓ read   ✓ grep   ✓ edit   ✓ write   ✓ bash │
│                                              │
│ Queue                                        │
│ Steering           0                         │
│ Follow-up          1                         │
└──────────────────────────────────────────────┘
```

### Harness Timeline — 规划中的 UI / Roadmap 预览

```text
12:40:03  Session started
12:40:05  Agent running
12:40:07  Tool · read · src/auth.ts
12:40:10  Tool · grep · refreshToken
12:40:13  Tool · edit · src/auth.ts
12:40:23  Compaction started
12:40:25  Compaction completed
12:40:31  Agent completed
```

以上内容用于表达产品方向，不是已上线功能截图，也不表示完整可视化 Inspector 已经发布。

## Roadmap

### 当前

- 上文列出的已发布桌面能力
- Pi Agent Runtime 集成与 Session 控制
- 原生项目工作区与控制平面

### 下一步

- 完整 Harness Console
- Runtime 与 Context Inspector
- Tools Inspector 与 Compaction Control
- Steering 与 Follow-up Inspector
- Session Tree 可视化
- Harness Timeline 与 Stats

### 后续

- Tool Policy 与 Approval Policy
- Workspace Permissions
- Verification 与质量检查集成
- Harness Profiles

## Pi-Harness 对比

“普通桌面客户端”表示常见的轻量聊天客户端，不代表所有具体产品。

| 能力              | Pi CLI         | 普通桌面客户端 | Pi-Harness                          |
| ----------------- | -------------- | -------------- | ----------------------------------- |
| Chat 与 Session   | 支持           | 通常支持       | 支持                                |
| 项目工作区        | Terminal       | 基础           | 原生工作区                          |
| Provider 管理     | 配置文件       | 有限           | 支持                                |
| Skills 管理       | CLI / 文件     | 有限           | 支持                                |
| 环境管理          | 手动           | 很少           | 支持                                |
| Harness 状态      | CLI / SDK      | 有限           | 已具备并持续完善                    |
| Context Inspector | CLI / SDK      | 有限           | 当前基础展示；完整 Inspector 规划中 |
| Tool Inspector    | CLI / SDK      | 有限           | 当前可选择；完整 Inspector 规划中   |
| Compaction 控制   | CLI / SDK      | 有限           | 支持                                |
| Harness Timeline  | 无可视化控制台 | 很少           | Roadmap                             |
| 文件与 Git        | Terminal       | 视产品而定     | 支持                                |

## 下载

从 [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.2.0) 下载 Pi-Harness v1.2.0。

| 平台                | 安装包                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [`Pi-Harness-1.2.0-arm64.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.2.0/Pi-Harness-1.2.0-arm64.dmg)     |
| macOS Intel         | [`Pi-Harness-1.2.0.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.2.0/Pi-Harness-1.2.0.dmg)                 |
| Windows x64         | [`Pi-Harness Setup 1.2.0.exe`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.2.0/Pi-Harness%20Setup%201.2.0.exe) |
| Linux x64           | [`Pi-Harness-1.2.0.AppImage`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.2.0/Pi-Harness-1.2.0.AppImage)       |

> macOS 社区构建可能没有签名。首次启动若被系统拦截，请前往“系统设置 → 隐私与安全性 → 仍要打开”。详细说明见 [v1.2.0 Release Notes](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.2.0)。

安装包用户不需要 clone 仓库，也不需要安装 pnpm。Pi-Harness 可以在支持的环境中检测、安装和修复 Node.js、npm、PATH 与 Pi Coding Agent。

## 工作流程

1. 启动 Pi-Harness，在概览页检查 Node.js、npm、PATH 与 Pi。
2. 配置 Pi 兼容 Provider，并选择模型。
3. 打开项目，进入原生工作区。
4. 新建或继续 Pi Session。
5. 在同一个界面中使用流式输出、Tool Call、文件和 Git。

```text
安装 → 配置 Provider → 选择模型 → 打开项目 → 运行 Pi
```

## 环境要求

安装包用户：

- macOS Apple Silicon、macOS Intel、Windows x64 或 Linux x64
- Pi Coding Agent，可直接在 Pi-Harness 中安装或修复

源码开发：

- Node.js ≥ 22
- pnpm 9.12.1

## 开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

本机没有 Pi 时，可在“设置 → 配置目录”中指向 <code>fixtures/mock-pi/</code>；也可以把 <code>.env.example</code> 复制为 <code>.env</code>，并将 <code>PI_HARNESS_PI_CONFIG_DIR</code> 指向该 fixture。不要在 <code>VITE_*</code> 变量中存放密钥，它们会被打进 Renderer。

常用检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

## 关注项目

Pi-Harness 下一阶段的重点，就是上面展示的可视化 Harness Console。Runtime 与 Context Inspector、Tools Inspector、Compaction Control、Session Tree 和 Harness Timeline 会继续完善。

如果你对这些功能感兴趣，可以给 [Pi-Harness 点一个 ⭐](https://github.com/wangmiaozero/pi-harness/stargazers)，关注后续版本。Star 也能帮助更多 Pi 用户发现这个项目。

## 翻译

- [English](README.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)
- [日本語](README.ja-JP.md)
- [한국어](README.ko-KR.md)
- [Русский](README.ru-RU.md)
- [Français](README.fr-FR.md)
- [Deutsch](README.de-DE.md)

## 致谢

Pi-Harness 是围绕官方 [Pi Coding Agent 与 Pi Agent Harness](https://github.com/earendil-works/pi) 构建的桌面项目。

项目由 [wangmiao](https://github.com/wangmiaozero) 创建并维护 · [tuziling84@gmail.com](mailto:tuziling84@gmail.com)。

已发布变更见[更新记录](CHANGELOG.md)。

## 许可协议

Pi-Harness 采用 [GNU Affero General Public License v3.0 only](LICENSE)（<code>AGPL-3.0-only</code>）发布。你可以在协议条款下使用、修改和再分发；通过网络向用户提供修改版时，必须按 AGPL v3 要求向这些用户提供对应源代码。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero)。
