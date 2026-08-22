# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>Local-first desktop control plane and native workspace for <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Configure Pi · Run project sessions · Inspect and edit local files
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
  <img alt="version" src="https://img.shields.io/badge/version-1.0.9-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

Pi-Harness manages Pi providers, models, credentials, skills, raw configuration, backups, and diagnostics, then runs project-scoped Pi Agent sessions in a native desktop Workspace. Sessions remain compatible with Pi CLI JSONL under `~/.pi/agent/sessions/`; there is no embedded pi-web, Next.js server, or iframe.

Secrets never appear in the renderer as plaintext. macOS stores them in the system Keychain; Windows and Linux use Electron `safeStorage`. Unknown Pi fields are preserved.

## v1.0.9 highlights

- Assistant responses render safe streaming Markdown through an explicit tag and protocol allowlist.
- Tool results are collapsed by default and expand into a bounded scrollable panel.
- Optional application-wide mascots: “No Mascot” is the default, with six selectable visual styles including the new office and maid variants.

## Screenshots

|                 Overview                 |           Settings — Mascots           |
| :--------------------------------------: | :------------------------------------: |
|        ![Overview](docs/概览.jpg)        |   ![Mascot settings](docs/设置.jpg)    |
|         **Workspace — Sessions**         |         **Workspace — Editor**         |
| ![Workspace sessions](docs/工作区-1.jpg) | ![Workspace editor](docs/工作区-2.jpg) |
|           **Providers — List**           |        **Providers — Details**         |
|   ![Providers list](docs/提供商-1.jpg)   | ![Provider details](docs/提供商-2.jpg) |
|            **Models — List**             |          **Models — Details**          |
|     ![Models list](docs/模型-1.jpg)      |   ![Model details](docs/模型-2.jpg)    |
|          **Skills — Installed**          |          **Skills — Market**           |
|   ![Installed skills](docs/技能-1.jpg)   |   ![Skills market](docs/技能-2.jpg)    |

## Features

| Module          | Description                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Overview**    | Active model, Pi CLI / config directory, environment status, and common actions                                     |
| **Workspace**   | Native projects and Pi Sessions, streaming chat, Thinking / Tool Call, lightweight editing, Git Diff, Worktree      |
| **Providers**   | Searchable Pi-compatible presets; Provider ≠ Protocol ≠ Model; credentials use Keychain / `safeStorage`             |
| **Models**      | Preset or custom model IDs, capability metadata, active-model selection, read-back verification                     |
| **Skills**      | Create / import / edit / validate `SKILL.md`; path-root enforcement                                                 |
| **Config**      | CodeMirror editor for `models.json` / `settings.json`; format and reveal in the file manager                        |
| **Diagnostics** | Environment report; copy is sanitized (`apiKey` / `token` / `secret`, etc.)                                         |
| **Settings**    | Simplified Chinese / English UI, system/dark/light themes, density, tool preset, restore behavior, backups, mascots |

Reliability:

- Automatic backup before writes; atomic writes
- External change detection (mtime) with Reload / Compare / Overwrite
- Packaged builds check and download updates in the background, then install on quit or via **Install & Restart**
- Desktop-only: external browser windows and off-app URL handoff are blocked

## Lightweight editor boundary

Workspace can edit readable text files with lazy syntax highlighting, line numbers, undo/redo, find, explicit save, unsaved indicators, and external-change conflict protection. Unknown text extensions fall back to plain text; oversized, binary, media, and document files use read-only previews.

Pi-Harness is deliberately not a general-purpose IDE: no LSP/IntelliSense, semantic refactoring, debugger, task runner, integrated terminal, or IDE extension compatibility. See [the lightweight editor design boundary](docs/lightweight-code-editor.md).

## Requirements

- Node.js ≥ 22 (enforced when installing dependencies)
- pnpm `9.12.1` (see the `packageManager` field)
- [Pi Coding Agent](https://github.com/badlogic/pi-mono) installed, or install / update from the app

## Quick start

```bash
pnpm install
pnpm dev
```

Without a local Pi install, point Settings → config directory at `fixtures/mock-pi/`, or:

```bash
cp .env.example .env
# PI_HARNESS_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

Do not store secrets in `VITE_*` variables — they are bundled into the renderer.

## Commands

| Command                                 | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `pnpm typecheck`                        | Vue / TypeScript typecheck                               |
| `pnpm lint`                             | ESLint                                                   |
| `pnpm test`                             | Vitest unit tests                                        |
| `pnpm test:e2e`                         | Compile, then run Playwright Electron smoke tests        |
| `pnpm sync:provider-presets -- --check` | Verify the generated provider/model catalog              |
| `pnpm compile`                          | Vite build to `out/` (no installer)                      |
| `pnpm build`                            | Compile and package macOS / Windows / Linux → `release/` |
| `pnpm build:mac`                        | macOS Apple Silicon                                      |

## Architecture

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentRuntime      Pi sessions / streaming / tool events
                                                ├─ Workspace         projects / files / lightweight editor / git
                                                ├─ PiConfigService   atomic write / mtime conflict
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Domain stays decoupled from Pi native JSON via an Adapter. Unknown fields pass through. Logic is not hard-coded to a specific model name.

## Project documentation

- [Changelog](CHANGELOG.md)
- [Application updates and release artifacts](docs/application-updates.md)
- [Lightweight code editor boundary](docs/lightweight-code-editor.md)
- [Mascot design and runtime rules](docs/mascot-design.md)

## Author

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## License

Pi-Harness is free software licensed under the [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`). You may use, modify, and redistribute it under the license terms. Modified versions made available over a network must offer their corresponding source to users as required by AGPL v3.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
