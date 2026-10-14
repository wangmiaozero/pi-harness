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

<h3 align="center">The Operational Superset of Pi Coding Agent</h3>

<p align="center">
  <strong>Native Pi with a visual workspace, run controls, recovery, and agent teams.</strong>
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="#download"><strong>Download</strong></a> ·
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>Create a custom skin</strong></a> ·
  <a href="#screenshots">Screenshots</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="Releases" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

## Why Pi-Harness?

Pi-Harness brings Pi Coding Agent into a desktop workspace for macOS, Windows, and Linux. Manage conversations, projects, files, Git, models, and Skills in one place, with tools to inspect runs, control budgets, recover work, and coordinate agent teams.

Native Pi runs the agent. Your Pi sessions, configuration, tools, Skills, and extensions remain compatible with Pi, and you can continue using Pi outside the desktop app.

## Features

### Workspace, files, and Git

Start a standalone chat or open a project and resume a Pi session. Follow streaming replies, thinking, tool calls, images, and changed files; choose the model, thinking level, and tools, or compact the conversation. Workspace Tools gives you access to Harness and Agents while preserving your conversation and draft.

Browse and search files, preview media and documents, and edit readable text with syntax highlighting, line numbers, find, undo/redo, explicit save, and external-change conflict protection. The lightweight editor keeps file editing focused. Git provides diffs, history, activity graphs, commits, optional AI commit messages, and worktrees.

### Providers and models

Configure Pi-compatible providers with presets or custom endpoints, manage credentials, discover models where supported, test connections, and choose your chat model. Use supported image models for text-to-image or image editing, then download the results.

### Skills, extensions, packages, and MCP

Browse built-in and local Skills, edit them, and manage Pi packages and extensions from Capabilities. Type `@` in the composer to search and invoke an installed Skill. Connect MCP through supported packages. Optional add-ons such as [Superpowers](https://github.com/obra/superpowers) and [Odai](https://github.com/orziz/odai) can be installed, updated, or removed when you choose.

### Harness: observe, control, and recover

Inspect Runs, Trace, Replay, timelines, and tool activity. Compare runs, follow forks and retries in the Run Tree, review tokens, cost, and duration, and browse artifacts and project statistics.

Set tool policies and per-run budgets, create checkpoints, and resume, fork, or retry work. Evaluation, Diagnostics, and regression baselines help you check results and investigate failures using recorded run evidence.

### Agent teams and task orchestration

Coordinate Pi agents with reusable teams and templates. Assign tasks with dependencies and priorities, schedule them manually, sequentially, or in parallel, pass results and artifacts to the next task, and use review gates. Worktrees keep agent changes separate; budgets, conflict hints, and pause, resume, abort, retry, skip, and reassign controls help you manage the work.

### Local conversation history

Browse Claude Code, Codex (including desktop and archived conversations), Cursor, Cursor Agent, Gemini CLI, OpenCode, and Pi history together. Search, filter by source, project, or date range, and add custom history folders.

View the original conversation in read-only mode, preview a handoff, and edit the next instruction before continuing in a new Pi chat under the same project. Browsing, local previews, and scan retries use no model tokens. Optional AI summaries use your configured model only when requested.

### Project architecture

Open Architecture in Workspace to explore modules, dependencies, entrypoints, and source references. Filter by package, focus on a module, browse map pages, zoom, or use fullscreen. Save analysis snapshots, see when source changes make them stale, and export JSON, offline HTML, or the current view as PNG.

Local analysis uses no model tokens; AI descriptions are optional. JavaScript, TypeScript, and Vue import relationships are analyzed locally, while other supported languages have a file-level index. The analysis shows its coverage and limitations.

### Themes and custom skins

Choose classic palettes, Ming themes, Starship Cockpit, macOS 27 backgrounds, or an imported custom skin. New installations start in Dark. Customize chat display names, app icons, local background images, window and screen glow, and the input flame effect. Startup animation accompanies the environment check; mascot-free builds retain the general appearance controls.

### Environment and app settings

Check Node.js, npm, PATH, Pi Coding Agent, and the active configuration. Install, update, or repair Pi where supported, inspect environment diagnostics, manage configuration backups, and check for app updates. The interface is available in eight languages.

## Create your own skin

Use the [Pi-Harness Custom Skin Starter](https://github.com/wangmiaozero/pi-harness-skin-starter) to create the visual style you want.

1. Use the starter repository as a template or download it.
2. Open it with your coding agent and describe your preferred style using the included prompt.
3. Import the completed project from **Settings → Theme → Import Skin**.

The multilingual starter includes guidance for colors, previews, wallpapers, and optional character artwork. Keep your skin in its own repository to update and share it independently.

<a id="screenshots"></a>

## Screenshots

Product screenshots are grouped by theme. Browse the [complete screenshot index](docs/README.md) for additional views.

### Classic theme

|                              Workspace                               |                              Git                               |
| :------------------------------------------------------------------: | :------------------------------------------------------------: |
|           ![Workspace](docs/功能界面/经典主题/工作区.png)            |             ![Git](docs/功能界面/经典主题/Git.png)             |
|                       **Providers and models**                       |                        **Capabilities**                        |
| ![Providers and models](docs/功能界面/经典主题/Provider与模型-1.png) |     ![Capabilities](docs/功能界面/经典主题/能力中心-1.png)     |
|                             **Harness**                              |                    **Project architecture**                    |
|         ![Harness](docs/功能界面/经典主题/工具Harness-1.png)         | ![Project architecture](docs/功能界面/经典主题/项目架构-1.png) |

### Ming interfaces

|                   General settings                   |                    Theme and skin gallery                    |
| :--------------------------------------------------: | :----------------------------------------------------------: |
| ![General settings](docs/功能界面/大明/通用设置.png) | ![Theme and skin gallery](docs/功能界面/大明/主题皮肤库.png) |

### Theme gallery

|                   Ming · Snowbound official                   |                   Ming · Snow flute scholar                   |
| :-----------------------------------------------------------: | :-----------------------------------------------------------: |
| ![Ming · Snowbound official](docs/主题展示/大明/雪境朝臣.png) | ![Ming · Snow flute scholar](docs/主题展示/大明/雪夜笛姬.png) |
|                    **Ming · Moon scholar**                    |                     **Starship Cockpit**                      |
|    ![Ming · Moon scholar](docs/主题展示/大明/月城书姬.png)    |     ![Starship Cockpit](docs/主题展示/星舰/霜星领航.png)      |

<p align="center">
  <strong>macOS 27 · Liquid Ether</strong><br>
  <img src="docs/主题展示/macOS%2027/Liquid%20Ether.png" alt="macOS 27 · Liquid Ether" width="80%" />
</p>

<a id="download"></a>

## Download

Download a published installer from [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) and choose the file for your platform.

| Platform            | Installer                  |
| ------------------- | -------------------------- |
| macOS Apple Silicon | `.dmg` · `arm64`           |
| macOS Intel         | `.dmg` · `x64`             |
| Windows x64         | `.exe` · Windows installer |
| Linux x64           | `.AppImage`                |

Packaged users do not need to clone the repository or install pnpm. Pi-Harness can help set up Pi and its environment where supported.

> macOS community builds may be unsigned. If the first launch is blocked, use **System Settings → Privacy & Security → Open Anyway**.

## Get started

1. Launch Pi-Harness and check the environment in Overview.
2. Configure a provider, test the connection, and select a model.
3. Start a standalone chat or open a project.
4. Start or resume a Pi session, then work with conversations, files, and Git.
5. Open Workspace Tools for Harness controls or agent teams.

## Requirements

The desktop app supports macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64. Pi Coding Agent can be installed or repaired from the app where supported. Running from source requires Node.js ≥ 22.22.2 and pnpm 9.12.1.

## Documentation

- [Screenshot index](docs/README.md)
- [Changelog](CHANGELOG.md)

## Credits

Pi-Harness is built around the official [Pi Coding Agent and Pi Agent Harness](https://github.com/earendil-works/pi).

Created and maintained by [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

## License

Pi-Harness is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
