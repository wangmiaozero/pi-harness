# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong><a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a> 的完整桌面 Harness</strong><br />
  本地优先的桌面工作台 · Electron · Vue 3 · TypeScript
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
  <img alt="version" src="https://img.shields.io/badge/version-1.0.8-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

通过图形界面管理 Provider、Model、API Key、Skills、原始配置、备份与诊断，然后进入工作区直接与 Pi Coding Agent 对话，无需离开桌面应用。

密钥不出 Renderer 明文；macOS 写入系统钥匙串，Windows / Linux 走 Electron `safeStorage`。未知 Pi 字段原样保留。

## 界面预览

| 概览 | 设置 |
| :---: | :---: |
| ![概览](docs/概览.jpg) | ![设置](docs/设置.jpg) |
| **工作区 — 会话** | **工作区 — 编辑器** |
| ![工作区会话](docs/工作区-1.jpg) | ![工作区编辑器](docs/工作区-2.jpg) |
| **提供商 — 列表** | **提供商 — 详情** |
| ![提供商列表](docs/提供商-1.jpg) | ![提供商详情](docs/提供商-2.jpg) |
| **模型 — 列表** | **模型 — 详情** |
| ![模型列表](docs/模型-1.jpg) | ![模型详情](docs/模型-2.jpg) |
| **技能 — 已安装** | **技能 — 市场** |
| ![已安装技能](docs/技能-1.jpg) | ![技能市场](docs/技能-2.jpg) |

## 功能

| 模块 | 说明 |
| --- | --- |
| **概览** | 当前模型、Pi CLI / 配置目录、环境状态与常用操作 |
| **工作区** | 项目、Session、流式对话、Thinking、Tool Call、轻量代码编辑、Git Diff、Worktree |
| **提供商** | 协议解耦（Provider ≠ Protocol ≠ Model）；凭证走 Keychain / `safeStorage` |
| **模型** | 能力标记、激活模型、连接测试；写入后回读 `settings.json` 校验 |
| **技能** | 创建 / 导入 / 编辑 / 校验 `SKILL.md`；路径根目录约束 |
| **配置** | CodeMirror 编辑 `models.json` / `settings.json`；格式化、在文件管理器中显示 |
| **诊断** | 环境报告；复制前脱敏（apiKey / token / secret 等） |
| **设置** | 简体中文 / English / 한국어 / Русский / Français / Deutsch、深浅色、标准 / 紧凑密度、自动备份与保留策略 |

可靠性：

- 写配置前自动备份；原子写入
- 外部修改检测（mtime），冲突对话框：Reload / Compare / Overwrite
- 打包版支持 `electron-updater`（不会静默安装）
- 桌面应用：拦截站外浏览器窗口与 URL 跳转

## 环境要求

- Node.js ≥ 22（安装依赖时强制校验）
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

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | Vue / TypeScript 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest 单元测试 |
| `pnpm test:e2e` | 编译后跑 Playwright Electron smoke |
| `pnpm compile` | Vite 编译到 `out/`（不打安装包） |
| `pnpm build` | 编译并打包 macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | 仅 macOS |

## 架构

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentSession      项目 / 会话 / 流式执行
                                                ├─ Workspace         文件 / 轻量编辑器 / Git
                                                ├─ PiConfigService   原子写 / mtime 冲突
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Domain 与 Pi 原生 JSON 之间通过 Adapter 解耦，未知字段透传，不因某个模型名写死逻辑。

## 作者

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## 许可协议

Pi-Harness 采用 [GNU Affero General Public License v3.0 only](./LICENSE)（`AGPL-3.0-only`）发布。你可以在该协议条款下使用、修改和再分发；通过网络向用户提供修改版时，必须按 AGPL v3 要求向这些用户提供对应源代码。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero)。
