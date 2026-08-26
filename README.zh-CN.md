# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong><a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a> 一站式桌面工作台</strong><br />
  配置 Pi · 管理模型 · 安装 Skills 与扩展包 · 运行 Agent · 管理项目
</p>

<p align="center">
  把使用 Pi Coding Agent 需要的环境、Provider、模型、能力和工作区集中到一个原生桌面应用中。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja-JP.md">日本語</a> ·
  <a href="README.ko-KR.md">한국어</a> ·
  <a href="README.ru-RU.md">Русский</a> ·
  <a href="README.fr-FR.md">Français</a> ·
  <a href="README.de-DE.md">Deutsch</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1"><img alt="v1.1.1 发布版" src="https://img.shields.io/badge/release-v1.1.1-4C8DFF?style=flat-square" /></a>
  <img alt="支持 macOS 和 Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only 许可" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

![Pi-Harness 概览页：环境状态、当前模型和快捷操作](docs/概览.jpg)

<p align="center">
  <a href="#下载">下载</a> ·
  <a href="#工作流程">工作流程</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#开发">开发</a>
</p>

## 为什么是 Pi-Harness？

### 不只是 Pi 聊天界面

普通桌面客户端解决的是“打开 Pi 并开始聊天”。Pi-Harness 还会准备运行环境、管理 Provider 和模型、安装 Skills 与 Pi 扩展包，并为每个项目提供包含会话、文件和 Git 的原生工作区。

```text
普通桌面客户端                         Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness 不是网页套壳：不嵌入 pi-web、Next.js 服务或 iframe，也不实现第二套 Agent Runtime。Pi Coding Agent 始终是唯一 Agent Runtime，会话与 `~/.pi/agent/sessions/` 下的 Pi CLI JSONL 保持兼容。

**配置 Pi。运行 Pi。扩展 Pi。**

## 下载

从 [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1) 下载 Pi-Harness v1.1.1。

| 平台                | 安装包                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon | [`Pi-Harness-1.1.1-arm64.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1-arm64.dmg) |
| macOS Intel         | [`Pi-Harness-1.1.1.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1.dmg)             |
| Windows x64         | [`Pi-Harness.Setup.1.1.1.exe`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness.Setup.1.1.1.exe) |

> macOS 社区构建可能没有签名。首次启动若被系统拦截，请前往“系统设置 → 隐私与安全性 → 仍要打开”。详细说明见 [v1.1.1 Release Notes](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1)。

安装包用户不需要 clone 仓库，也不需要安装 pnpm。Pi-Harness 可以在支持的环境中检测、安装和修复 Node.js、npm、PATH 与 Pi Coding Agent。

## 你可以做什么

### 工作区

打开真实项目，新建或继续 Pi 会话，让 Thinking、Tool Call、流式回复和被修改的文件处在同一个工作区里。

### Provider 与模型

使用 Pi 兼容预设或自定义 API；在服务支持时拉取模型目录，测试连接，并选择当前模型。

### Skills、扩展包与 MCP

创建和管理本地 Skills，安装可信精选能力与内置集合，修复 Pi Package，并通过支持的 Pi 扩展包接入 MCP。

### 运行环境

检测 Node.js、npm、PATH 与 Pi Coding Agent，直接在桌面应用里安装或修复常见环境问题。

### 文件与 Git

浏览和上传文件，安全编辑可读文本，查看 Git Diff，并使用项目 Worktree；定位仍是轻量工作区，不是 IDE。

### 诊断与安全

查看环境、存储、工作区与能力健康状态；凭证写入 Keychain 或 Electron `safeStorage`，复制诊断时自动脱敏。

## 工作流程

1. **启动 Pi-Harness**，在概览页检查 Node.js、npm、PATH 与 Pi。
2. **配置 Provider**，选择预设或填写自己的 Pi 兼容 API。
3. **选择模型**，并运行连接测试。
4. **打开项目**，进入原生工作区。
5. **新建或继续 Pi 会话**，使用流式输出、Tool Call、文件和 Git 上下文完成任务。

```text
安装 → 配置 Provider → 选择模型 → 打开项目 → 运行 Pi
```

## 界面预览

### 1. 先确认环境就绪

概览页集中展示当前模型、Pi 环境、配置健康度与常用安装操作。

![概览](docs/概览.jpg)

### 2. 在真实项目中运行 Pi

项目、会话、流式回复、Thinking、Tool Call、文件和 Git 都在同一个原生工作区中。

|             项目会话             |           文件与轻量编辑           |
| :------------------------------: | :--------------------------------: |
| ![工作区会话](docs/工作区-1.jpg) | ![工作区编辑器](docs/工作区-2.jpg) |

### 3. 配置 Provider 与模型

从预设或自定义 API 开始，测试连接、导入可发现模型，再指定 Pi 使用的当前模型。

|          Provider 列表           |          Provider 配置           |
| :------------------------------: | :------------------------------: |
| ![提供商列表](docs/提供商-1.jpg) | ![提供商详情](docs/提供商-2.jpg) |
|           **模型列表**           |           **模型配置**           |
|   ![模型列表](docs/模型-1.jpg)   |   ![模型详情](docs/模型-2.jpg)   |

### 4. 用 Skills 与扩展包扩展 Pi

管理本地 Skill、精选能力、内置集合和 Pi Package，并检查归属与健康状态。

|         已安装 Skills          |       内置集合与扩展包       |
| :----------------------------: | :--------------------------: |
| ![已安装技能](docs/技能-1.jpg) | ![技能市场](docs/技能-2.jpg) |

### 5. 调整工作区外观

选择跟随系统、浅色或深色主题；核心工作区就绪后，还可以按需启用运行时驱动的看板娘。

![外观与看板娘设置](docs/设置.jpg)

## 核心功能

| 模块              | Pi-Harness 提供的能力                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| 概览              | 当前模型、环境状态、配置健康度和常用操作                                       |
| 工作区            | 项目级 Pi 会话、流式输出、Thinking、Tool Call、文件、Git Diff 与 Worktree      |
| Provider          | Pi 兼容预设、自定义端点、凭证、实时模型发现与连接测试                          |
| 模型              | 创建预设或自定义模型，并选择 Pi 当前使用的模型                                 |
| Skills 与 Package | 创建、导入、校验、安装、更新、修复、启停、备份和卸载受支持能力                 |
| 配置              | 编辑 `models.json` / `settings.json`，支持格式化、备份、原子写入和外部变更保护 |
| 诊断              | 检查环境、存储、工作区、安全与能力健康度，并对复制/导出内容脱敏                |
| 更新              | 打包版检查 GitHub Releases，并在存在兼容 updater 元数据时安装更新              |
| 外观              | 跟随系统、浅色/深色主题、密度设置，以及可选的运行时看板娘                      |

### 轻量编辑器，不是 IDE

Pi-Harness 可以编辑可读文本文件，支持懒加载语法高亮、行号、撤销/重做、查找、显式保存、未保存状态和外部变更冲突保护。超大文件、二进制、媒体和文档使用只读预览。

它不提供 LSP/IntelliSense、语义重构、调试器、任务运行器、集成终端或 IDE 扩展兼容。详见[轻量代码编辑器边界](docs/lightweight-code-editor.md)。

## 架构

Pi-Harness 将“管理 Pi、使用 Pi、扩展 Pi”分层，同时始终保持 Pi Coding Agent 是唯一 Agent Runtime。

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       管理 Pi                使用 Pi             扩展 Pi

       Providers              Projects           Skills
       Models                 Sessions           Packages
       Environment            Agent              MCP adapters
       Config / Secrets       Streaming          Presets
       Backup / Diagnostics   Files / Git
       Updates                Worktree
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   ▼
                           Pi Coding Agent
```

桌面边界固定为 `Vue Renderer → typed preload API → validated IPC → Main services → Pi SDK / 操作系统`。Domain Adapter 会保留 Pi 配置中的未知字段。实现细节见[架构说明](docs/architecture.md)与 [Capability Layer](docs/capability-layer.md)。

## 安全

密钥不会以明文返回 Renderer。macOS 使用系统钥匙串，Windows 使用 Electron `safeStorage`。配置变更先备份再原子写入；工作区文件访问限制在已授权根目录；诊断会隐藏凭证字段和 Home 路径。

完整的信任边界、路径校验、进程执行与漏洞报告方式见[安全模型](docs/security.md)。

## 环境要求

安装包用户：

- macOS Apple Silicon、macOS Intel 或 Windows x64
- Pi Coding Agent，可直接在 Pi-Harness 中安装或修复

源码开发：

- Node.js ≥ 22
- pnpm `9.12.1`

## 开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

本机没有 Pi 时，可在“设置 → 配置目录”中指向 `fixtures/mock-pi/`；也可以把 `.env.example` 复制为 `.env`，并将 `PI_HARNESS_PI_CONFIG_DIR` 指向该 fixture。不要在 `VITE_*` 变量中存放密钥，它们会被打进 Renderer 包。

常用检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

## 文档

- [架构与进程边界](docs/architecture.md)
- [安全模型](docs/security.md)
- [测试策略](docs/testing.md)
- [应用更新与发布产物](docs/application-updates.md)
- [Pi 安装与 Node.js 前置条件](docs/pi-installation.md)
- [轻量代码编辑器边界](docs/lightweight-code-editor.md)
- [Capability Layer 与精选 Skill 安全模型](docs/capability-layer.md)
- [Pi Package 与 Skill 生命周期](docs/package-lifecycle.md)
- [内置 Skills 集合](docs/builtin-skills.md)
- [更新记录](CHANGELOG.md)

## 参与贡献

欢迎提交贡献。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并遵守项目已经确定的架构与安全边界。

## 许可协议

Pi-Harness 采用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）发布。你可以在协议条款下使用、修改和再分发；通过网络向用户提供修改版时，必须按 AGPL v3 要求向这些用户提供对应源代码。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero)。

## 作者

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
