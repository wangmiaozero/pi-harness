# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>The complete desktop workspace for <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Configure Pi · Run agents · Manage models, Skills, packages, and projects
</p>

<p align="center">
  Everything you need to configure, run, and extend Pi Coding Agent in one native desktop app.
</p>

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
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1"><img alt="release v1.1.1" src="https://img.shields.io/badge/release-v1.1.1-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

![Pi-Harness overview with environment status, active model, and quick actions](docs/概览.jpg)

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#development">Development</a>
</p>

## Why Pi-Harness?

### More than a Pi chat UI

A basic desktop client gets you from Pi to chat. Pi-Harness also brings environment setup, provider and model management, Skills, packages, projects, files, and Git into one desktop workspace.

```text
Typical desktop client                Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness is not a wrapped web UI. It embeds no pi-web, Next.js server, or iframe, and it does not add a second agent runtime. Pi Coding Agent remains the only Agent Runtime, with sessions compatible with Pi CLI JSONL under `~/.pi/agent/sessions/`.

**Configure Pi. Run Pi. Extend Pi.**

## Download

Download Pi-Harness v1.1.1 from [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1).

| Platform            | Installer                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon | [`Pi-Harness-1.1.1-arm64.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1-arm64.dmg) |
| macOS Intel         | [`Pi-Harness-1.1.1.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1.dmg)             |
| Windows x64         | [`Pi-Harness.Setup.1.1.1.exe`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness.Setup.1.1.1.exe) |

> macOS community builds may be unsigned. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway**. See the [v1.1.1 installation notes](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1) for details.

Packaged users do not need to clone the repository or install pnpm. Pi-Harness can detect, install, and repair Node.js, npm, PATH, and Pi Coding Agent where supported.

## What you can do

### Workspace

Open a project, start or resume Pi sessions, stream Thinking and Tool Calls, and keep the conversation beside the files it changes.

### Providers & Models

Choose a Pi-compatible preset or configure a custom API, discover available models where the provider supports it, test the connection, and select the active model.

### Skills, Packages & MCP

Create and manage local Skills and Pi packages, and add MCP connectivity through supported packages.

### Environment

Detect Node.js, npm, PATH, and Pi Coding Agent, then install or repair common environment problems from the desktop app.

### Files & Git

Browse and upload files, edit readable text with conflict protection, inspect Git diffs, and work with project worktrees without turning the app into an IDE.

### Diagnostics & Security

Inspect environment, storage, workspace, and capability health from the desktop app.

## How it works

1. **Launch Pi-Harness** and let Overview check Node.js, npm, PATH, and Pi.
2. **Configure a provider** from a preset or your own Pi-compatible endpoint.
3. **Choose a model** and run a connection test.
4. **Open a project** in the native Workspace.
5. **Start or resume a Pi session** with streaming output, Tool Calls, files, and Git context.

```text
Install → Configure provider → Select model → Open project → Run Pi
```

## Screenshots

### 1. Know what is ready

Overview shows the active model, Pi environment, configuration health, and common setup actions in one place.

![Overview](docs/概览.jpg)

### 2. Run Pi inside a real project

Keep project sessions, streaming responses, Thinking, Tool Calls, files, and Git in one native workspace.

|                 Sessions                 |     Files and lightweight editing      |
| :--------------------------------------: | :------------------------------------: |
| ![Workspace sessions](docs/工作区-1.jpg) | ![Workspace editor](docs/工作区-2.jpg) |

### 3. Configure providers and models

Start with a preset or custom API, test it, manage available models, and choose the model Pi should use.

|              Providers               |             Provider setup             |
| :----------------------------------: | :------------------------------------: |
| ![Providers list](docs/提供商-1.jpg) | ![Provider details](docs/提供商-2.jpg) |
|              **Models**              |            **Model setup**             |
|   ![Models list](docs/模型-1.jpg)    |   ![Model details](docs/模型-2.jpg)    |

### 4. Extend Pi with Skills and packages

Manage local Skills, collections, and Pi packages.

|           Installed Skills           | Built-in collections and packages |
| :----------------------------------: | :-------------------------------: |
| ![Installed skills](docs/技能-1.jpg) | ![Skills market](docs/技能-2.jpg) |

### 5. Make the workspace yours

Choose system, light, or dark appearance and optionally enable a mascot.

![Appearance and mascot settings](docs/设置.jpg)

## Core features

| Area               | What Pi-Harness does                                  |
| ------------------ | ----------------------------------------------------- |
| Overview           | Shows environment, configuration, and model status    |
| Workspace          | Runs Pi sessions with project files and Git context   |
| Providers & Models | Manages Pi-compatible providers and models            |
| Skills & Packages  | Manages supported Skills and packages                 |
| Config             | Edits Pi configuration files with conflict protection |
| Diagnostics        | Reports application and environment health            |
| Updates            | Installs compatible application updates               |
| Appearance         | Offers theme, density, and optional mascot settings   |

### Lightweight editor, not an IDE

Pi-Harness edits readable text with lazy syntax highlighting, line numbers, undo/redo, find, explicit save, unsaved-state indicators, and external-change conflict protection. Oversized, binary, media, and document files use read-only previews.

It deliberately does not include LSP/IntelliSense, semantic refactoring, a debugger, task runner, integrated terminal, or IDE extension compatibility.

## Architecture

Pi-Harness separates managing Pi, using Pi, and extending Pi while keeping Pi Coding Agent as the only runtime.

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       Manage Pi              Use Pi             Extend Pi

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

The desktop boundary is `Vue Renderer → typed preload API → validated IPC → Main services → Pi SDK / operating system`. Domain adapters preserve unknown Pi configuration fields.

## Requirements

For the packaged app:

- macOS Apple Silicon, macOS Intel, or Windows x64
- Pi Coding Agent, which Pi-Harness can install or repair from the app

For development from source:

- Node.js ≥ 22
- pnpm `9.12.1`

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Without a local Pi installation, point **Settings → Config directory** at `fixtures/mock-pi/`, or copy `.env.example` to `.env` and set `PI_HARNESS_PI_CONFIG_DIR` to that fixture. Never store secrets in `VITE_*` variables; they are bundled into the renderer.

Common checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

## Documentation

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

Pi-Harness is free software licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). You may use, modify, and redistribute it under the license terms. Modified versions made available over a network must offer their corresponding source to users as required by AGPL v3.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## Author

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
