# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong><a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a> 的本地优先桌面控制台与原生工作区</strong><br />
  配置 Pi · 运行项目会话 · 查看并编辑本地文件
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ko-KR.md">한국어</a> ·
  <a href="README.ru-RU.md">Русский</a> ·
  <a href="README.fr-FR.md">Français</a> ·
  <a href="README.de-DE.md">Deutsch</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.1.0-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

Pi-Harness 通过桌面界面管理 Pi 的 Provider、Model、凭证、Skills、原始配置、备份与诊断，并在原生工作区中运行面向真实项目的 Pi Agent Session。会话继续兼容 `~/.pi/agent/sessions/` 下的 Pi CLI JSONL，不嵌入 pi-web、Next.js 服务或 iframe。

密钥不出 Renderer 明文；macOS 写入系统钥匙串，Windows / Linux 走 Electron `safeStorage`。未知 Pi 字段原样保留。

## v1.1.0 重点

- 新增统一 Capability Layer，在领域层兼容 Skills、Extensions、Packages、MCP 与 Presets；Pi 仍是唯一 Agent Runtime。
- Skills 页面新增紧凑的“精选技能”，Odai 作为普通 `skill` Capability 接入，用于 Agent 治理与任务验收。
- 精选技能只从 Main Process 的可信 Catalog 安装，经过 typed IPC、隔离暂存、`SKILL.md` 校验、原子落盘、并发锁与错误脱敏。
- 已安装的精选技能支持查看、编辑、更新、启用/禁用与卸载；更新和卸载前自动创建本地 Skill 备份。

## 界面预览

|               概览               |           设置 — 看板娘            |
| :------------------------------: | :--------------------------------: |
|      ![概览](docs/概览.jpg)      |    ![看板娘设置](docs/设置.jpg)    |
|        **工作区 — 会话**         |        **工作区 — 编辑器**         |
| ![工作区会话](docs/工作区-1.jpg) | ![工作区编辑器](docs/工作区-2.jpg) |
|        **提供商 — 列表**         |         **提供商 — 详情**          |
| ![提供商列表](docs/提供商-1.jpg) |  ![提供商详情](docs/提供商-2.jpg)  |
|         **模型 — 列表**          |          **模型 — 详情**           |
|   ![模型列表](docs/模型-1.jpg)   |    ![模型详情](docs/模型-2.jpg)    |
|        **技能 — 已安装**         |          **技能 — 市场**           |
|  ![已安装技能](docs/技能-1.jpg)  |    ![技能市场](docs/技能-2.jpg)    |

## 功能

| 模块       | 说明                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| **概览**   | 当前模型、环境状态、Node.js/Pi 安装引导、Pi 一键安装与常用操作                        |
| **工作区** | 原生项目与 Pi Session、流式对话、Thinking / Tool Call、轻量编辑、Git Diff、Worktree   |
| **提供商** | 可搜索的 Pi 兼容预设；Provider ≠ Protocol ≠ Model；凭证走 Keychain / `safeStorage`    |
| **模型**   | 预设或自定义模型 ID、能力元数据、激活模型、写入后回读校验                             |
| **技能**   | Capability 化的本地/精选技能；创建、导入、编辑、校验、安装、更新、启停与卸载          |
| **配置**   | CodeMirror 编辑 `models.json` / `settings.json`；格式化、在文件管理器中显示           |
| **诊断**   | 环境报告；复制前脱敏（apiKey / token / secret 等）                                    |
| **设置**   | 简体中文 / English UI、跟随系统/深色/浅色主题、工具预设、恢复行为、备份、看板娘 |

可靠性：

- 写配置前自动备份；原子写入
- 外部修改检测（mtime），冲突对话框：Reload / Compare / Overwrite
- 打包版通过 `electron-updater` 后台检查并下载更新，退出时安装，也可选择“安装并重启”
- 桌面应用：拦截任意站外跳转，仅放行固定的 Node.js 官方下载入口
- 精选技能来源由 Main Process 的可信 Registry 解析；Renderer 无法提交命令、URL 或安装路径

## 轻量编辑器边界

工作区可以编辑可读文本文件，支持懒加载语法高亮、行号、撤销/重做、查找、显式保存、未保存状态和外部变更冲突保护。未知文本扩展名回退为纯文本；超大文件、二进制、媒体和文档使用只读预览。

Pi-Harness 明确不是通用 IDE：不提供 LSP/IntelliSense、语义重构、调试器、任务运行器、集成终端或 IDE 扩展兼容。详见[轻量代码编辑器设计边界](docs/lightweight-code-editor.md)。

## 环境要求

- 开发环境需要 Node.js ≥ 22；打包版会在安装 Pi 前引导用户前往 Node.js 官方地址
- pnpm `9.12.1`（见 `packageManager` 字段）
- 已安装 [Pi Coding Agent](https://github.com/badlogic/pi-mono)，或在应用内安装 / 更新

## 快速开始

```bash
pnpm install
pnpm dev
```

无本机 Pi 环境时，可在设置里把配置目录指到 `fixtures/mock-pi/`，或：

```bash
cp .env.example .env
# PI_HARNESS_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

不要使用 `VITE_*` 存放密钥——它们会被打进 Renderer 包。

## 常用命令

| 命令                                    | 作用                                            |
| --------------------------------------- | ----------------------------------------------- |
| `pnpm typecheck`                        | Vue / TypeScript 类型检查                       |
| `pnpm lint`                             | ESLint                                          |
| `pnpm test`                             | Vitest 单元测试                                 |
| `pnpm test:e2e`                         | 编译后跑 Playwright Electron smoke              |
| `pnpm sync:provider-presets -- --check` | 校验生成的厂商/模型目录                         |
| `pnpm compile`                          | Vite 编译到 `out/`（不打安装包）                |
| `pnpm build`                            | 编译并打包 macOS / Windows / Linux → `release/` |
| `pnpm build:mac`                        | 仅 macOS                                        |

## 架构

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentRuntime      Pi 会话 / 流式输出 / 工具事件
                                                ├─ Workspace         项目 / 文件 / 轻量编辑器 / Git
                                                ├─ PiConfigService   原子写 / mtime 冲突
                                                ├─ CapabilityService Skills / Extensions / Packages / MCP / Presets
                                                ├─ Pet Adapter       Runtime 状态 → 13 状态可视化层
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Domain 与 Pi 原生 JSON 之间通过 Adapter 解耦，未知字段透传，不因某个模型名写死逻辑。

## 项目文档

- [更新记录](CHANGELOG.md)
- [应用更新与发布产物](docs/application-updates.md)
- [Pi 安装与 Node.js 前置条件](docs/pi-installation.md)
- [轻量代码编辑器边界](docs/lightweight-code-editor.md)
- [Capability Layer 与精选技能安全模型](docs/capability-layer.md)
- [看板娘设计与运行时规则](docs/mascot-design.md)
- [宠物状态系统与 Sprite Manifest](docs/pet-state-system.md)

## 作者

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## 许可协议

Pi-Harness 采用 [GNU Affero General Public License v3.0 only](./LICENSE)（`AGPL-3.0-only`）发布。你可以在该协议条款下使用、修改和再分发；通过网络向用户提供修改版时，必须按 AGPL v3 要求向这些用户提供对应源代码。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero)。
