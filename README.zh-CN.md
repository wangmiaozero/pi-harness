# Pi-Harness

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja-JP.md">日本語</a> ·
  <a href="README.ko-KR.md">한국어</a> ·
  <a href="README.ru-RU.md">Русский</a> ·
  <a href="README.fr-FR.md">Français</a> ·
  <a href="README.de-DE.md">Deutsch</a>
</p>

<p align="center">
  <img src="build/icon.png" width="110" alt="Pi-Harness" />
</p>

<h3 align="center">Pi Coding Agent 的 Operational Superset</h3>

<p align="center">
  <strong>在 Native Pi 之上，提供可视化工作区、运行控制、任务恢复与多智能体协作。</strong>
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="#download"><strong>下载</strong></a> ·
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>创建自定义皮肤</strong></a> ·
  <a href="#screenshots">界面预览</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="已发布版本" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

## 为什么是 Pi-Harness？

Pi-Harness 将 Pi Coding Agent 带入 macOS、Windows 和 Linux 桌面工作区。在同一个应用中管理对话、项目、文件、Git、模型和 Skills，并通过运行观测、预算控制、任务恢复与智能体团队完成工作。

Native Pi 负责运行智能体。Pi 会话、配置、工具、Skills 与扩展保持兼容，也可以继续在桌面应用之外使用 Pi。

## 原生 Pi 与 Pi-Harness

Pi-Harness 是 Pi Coding Agent 的操作能力超集：以原生 Pi 能力为基础，增加观测、控制、恢复、多智能体编排与可视化工作区。

| 能力                     | Native Pi | Pi-Harness        |
| ------------------------ | --------- | ----------------- |
| Agent Runtime            | 支持      | Native Pi         |
| Agent Loop               | 支持      | Native Pi         |
| Sessions                 | 支持      | 支持 + 可视化管理 |
| Context                  | 支持      | 支持 + 检查视图   |
| Compaction               | 支持      | 支持 + 可视化控制 |
| Steering                 | 支持      | 支持              |
| Follow-up                | 支持      | 支持              |
| Models                   | 支持      | 支持 + 管理器     |
| Thinking                 | 支持      | 支持 + 可视化控制 |
| Tools                    | 支持      | 支持 + 选择与策略 |
| Skills                   | 支持      | 支持 + 管理器     |
| Extensions               | 支持      | 支持 + 管理器     |
| Packages                 | 支持      | 支持 + 管理器     |
| MCP / Codemode           | 支持      | 支持 + 选择与策略 |
| Runs                     | —         | 支持              |
| Trace                    | —         | 支持              |
| Replay                   | —         | 支持              |
| Run Compare              | —         | 支持              |
| Evaluation               | —         | 支持              |
| Policy                   | —         | 支持              |
| Budget                   | —         | 支持              |
| Checkpoints              | —         | 支持              |
| Recovery                 | —         | 支持              |
| Diagnostics              | —         | 支持              |
| Regression               | —         | 支持              |
| Artifacts                | —         | 支持              |
| Multi-Agent              | —         | 支持              |
| Task DAG                 | —         | 支持              |
| Handoff                  | —         | 支持              |
| Review Gates             | —         | 支持              |
| Worktree isolation       | —         | 支持              |
| Project architecture map | —         | 支持              |

## 功能介绍

### 工作区、文件与 Git

可以直接开始独立对话，也可以打开项目并继续 Pi 会话。集中查看流式回复、思考过程、工具调用、图片和文件变更，选择模型、思考级别与工具，或压缩对话上下文。在工作区“工具”中打开 Harness 和智能体时，对话与未发送草稿会保留。

支持文件浏览与搜索、媒体和文档预览，以及带语法高亮、行号、查找、撤销/重做、显式保存和外部变更冲突保护的轻量文本编辑。Git 提供差异、提交历史、活动图、提交操作、可选 AI 提交信息和 worktree。

### Provider 与模型

通过预设或自定义地址配置 Pi 兼容 Provider，管理凭证、获取服务支持的模型列表、测试连接并选择聊天模型。支持的图像模型可用于文生图或图片编辑，结果可以下载。

### Skills、扩展、包与 MCP

在能力中心浏览内置与本地 Skills、编辑 Skill，并管理 Pi 包和扩展。在输入框键入 `@`，即可搜索并调用已安装的 Skill。通过支持的包连接 MCP；[Superpowers](https://github.com/obra/superpowers) 和 [Odai](https://github.com/orziz/odai) 等可选增强能力可按需安装、更新或卸载。

### Harness：观测、控制与恢复

查看运行记录、Trace、回放、时间线与工具活动；对比不同运行，在运行树中追踪分支和重试，检查 Token、费用、耗时、产物及项目统计。

设置工具策略与单次运行预算，创建检查点，并恢复、分支或重试任务。评估、诊断和回归基线帮助你依据实际运行记录检查结果、定位失败原因。

### 智能体团队与任务编排

使用可复用团队和模板协调多个 Pi 智能体，为任务指定依赖、优先级和负责人，支持手动、顺序或并行调度、结果与产物交接、审核关卡。通过 worktree 隔离修改，并使用预算、冲突提示，以及暂停、继续、中止、重试、跳过和重新分配来管理任务。

### 本地会话历史

统一浏览 Claude Code、Codex（含桌面及归档会话）、Cursor、Cursor Agent、Gemini CLI、OpenCode 和 Pi 历史，支持搜索、来源/项目/日期范围筛选和自定义历史目录。

原始会话只读；查看交接预览、编辑下一步指令后，可以在同一项目下新建 Pi 对话继续任务。浏览、本地预览和扫描重试不消耗模型 Token；可选 AI 整理只在主动使用时调用已配置的模型。

### 项目架构

在工作区打开“项目架构”，浏览模块、依赖、入口文件和源码引用。支持按包筛选、模块聚焦、地图翻页、缩放与全屏，保存分析快照并提示源码变化，可导出 JSON、离线 HTML 或当前视图 PNG。

架构图展示支持范围内的静态依赖，不代表完整的函数调用关系。AI 会话历史保留原始会话只读，继续任务时会创建新的 Pi 对话。

本地分析不消耗模型 Token，AI 说明按需使用。JavaScript、TypeScript 和 Vue 提供本地导入关系分析，其他支持语言提供文件级索引，分析结果会标明覆盖范围与限制。

### 主题与自定义皮肤

选择经典配色、大明、星舰驾驶舱、macOS 27 背景或导入自定义皮肤。新安装默认使用深色主题；支持自定义聊天显示名称、应用图标、本地背景图，以及窗口光圈、屏幕光圈和输入框火焰效果。启动动画伴随环境检查，无吉祥物版本保留通用外观设置。

### 环境与应用设置

检查 Node.js、npm、PATH、Pi Coding Agent 和当前配置，在支持的环境中安装、更新或修复 Pi；查看环境诊断、管理配置备份并检查应用更新。界面支持八种语言。

## 创建自定义皮肤

使用 [Pi-Harness 自定义皮肤模板](https://github.com/wangmiaozero/pi-harness-skin-starter)，制作你喜欢的视觉风格。

1. 使用模板仓库，或下载并解压它。
2. 用编码智能体打开项目，通过内置提示词描述你喜欢的风格。
3. 完成后从“设置 → 主题 → 导入皮肤”导入项目。

多语言模板提供配色、预览图、壁纸和可选角色图的制作说明。皮肤可以保存在独立仓库中，单独更新和分享。

<a id="screenshots"></a>

## 界面预览

功能界面按主题分类，更多视图见[完整截图索引](docs/README.md)。

### 经典主题

#### 工作区

[![工作区](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)

<details>
<summary>Git · Provider 与模型 · 能力中心 · Harness 工具 · 项目架构</summary>

#### Git

[![Git](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)

#### Provider 与模型

[![Provider 与模型](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)

#### 能力中心

[![能力中心](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)

#### Harness 工具

[![Harness 工具](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)

#### 项目架构

[![项目架构](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)

</details>

### 大明功能界面

<details>
<summary>通用设置 · 主题皮肤库</summary>

#### 通用设置

[![通用设置](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)

#### 主题皮肤库

[![主题皮肤库](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)

</details>

### 主题展示

<details>
<summary>大明·雪境朝臣 · 大明·雪夜笛姬 · 大明·月城书姬 · 星舰驾驶舱 · macOS 27 · Liquid Ether</summary>

#### 大明·雪境朝臣

[![大明·雪境朝臣](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)

#### 大明·雪夜笛姬

[![大明·雪夜笛姬](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)

#### 大明·月城书姬

[![大明·月城书姬](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)

#### 星舰驾驶舱

[![星舰驾驶舱](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)

#### macOS 27 · Liquid Ether

[![macOS 27 · Liquid Ether](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)

</details>

<a id="download"></a>

## 下载

在 [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) 下载已发布的安装包，选择与你的平台对应的文件。

| 平台                | 安装包                    |
| ------------------- | ------------------------- |
| macOS Apple Silicon | `.dmg` · `arm64`          |
| macOS Intel         | `.dmg` · `x64`            |
| Windows x64         | `.exe` · Windows 安装程序 |
| Linux x64           | `.AppImage`               |

安装包用户无需克隆仓库或安装 pnpm。请以所下载版本的发布说明为准，确认该安装包的运行环境要求。

> macOS 社区构建可能未签名。首次启动若被系统拦截，请前往“系统设置 → 隐私与安全性 → 仍要打开”。

## 开始使用

1. 启动 Pi-Harness，在概览页检查运行环境。
2. 配置 Provider、测试连接并选择模型。
3. 直接新建对话，或打开项目。
4. 新建或继续 Pi 会话，在同一个界面中处理对话、文件和 Git。
5. 需要运行控制或团队协作时，打开工作区“工具”。

## 环境要求

桌面应用支持 macOS Apple Silicon、macOS Intel、Windows x64 和 Linux x64。支持的环境可在应用中安装或修复 Pi Coding Agent。源码开发与打包需要 Node.js ≥ 22.22.2 和 pnpm 9.12.1；这与已发布桌面安装包的运行要求分别说明。

## 文档

- [截图分类索引](docs/README.md)
- [更新记录](CHANGELOG.md)

## 技术交流

扫码加入 QQ 群 **pi-harness**，交流使用与开发问题。

**QQ群：1109717308**

<p align="center">
  <img src="docs/社区/qq-group.jpg" width="280" alt="Pi-Harness QQ 群二维码" />
</p>

## 致谢与作者

Pi-Harness 围绕官方 [Pi Coding Agent 与 Pi Agent Harness](https://github.com/earendil-works/pi) 构建。

由 [wangmiao](https://github.com/wangmiaozero) 创建并维护 · [tuziling84@gmail.com](mailto:tuziling84@gmail.com)。

### PR 贡献者

感谢 [@HenryArch](https://github.com/HenryArch) 通过 [PR #8](https://github.com/wangmiaozero/pi-harness/pull/8) 为项目作出贡献。

## 许可协议

Pi-Harness 采用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）发布。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
