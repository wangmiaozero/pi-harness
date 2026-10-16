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

## Pi vs Pi-Harness

Pi-Harness is the operational superset of Pi Coding Agent: native Pi capabilities form the foundation, with observation, control, recovery, orchestration, and a visual workspace added around them.

| Capability               | Native Pi | Pi-Harness                 |
| ------------------------ | --------- | -------------------------- |
| Agent Runtime            | Yes       | Native Pi                  |
| Agent Loop               | Yes       | Native Pi                  |
| Sessions                 | Yes       | Yes + visual management    |
| Context                  | Yes       | Yes + inspection           |
| Compaction               | Yes       | Yes + visual control       |
| Steering                 | Yes       | Yes                        |
| Follow-up                | Yes       | Yes                        |
| Models                   | Yes       | Yes + manager              |
| Thinking                 | Yes       | Yes + visual control       |
| Tools                    | Yes       | Yes + selection and policy |
| Skills                   | Yes       | Yes + manager              |
| Extensions               | Yes       | Yes + manager              |
| Packages                 | Yes       | Yes + manager              |
| MCP / Codemode           | Yes       | Yes + selection and policy |
| Runs                     | —         | Yes                        |
| Trace                    | —         | Yes                        |
| Replay                   | —         | Yes                        |
| Run Compare              | —         | Yes                        |
| Evaluation               | —         | Yes                        |
| Policy                   | —         | Yes                        |
| Budget                   | —         | Yes                        |
| Checkpoints              | —         | Yes                        |
| Recovery                 | —         | Yes                        |
| Diagnostics              | —         | Yes                        |
| Regression               | —         | Yes                        |
| Artifacts                | —         | Yes                        |
| Multi-Agent              | —         | Yes                        |
| Task DAG                 | —         | Yes                        |
| Handoff                  | —         | Yes                        |
| Review Gates             | —         | Yes                        |
| Worktree isolation       | —         | Yes                        |
| Project architecture map | —         | Yes                        |

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

Maps describe supported static dependencies; they do not establish a complete function-call graph. Local conversation history keeps source sessions read-only, and continuing a task starts a new Pi conversation.

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

#### Workspace

[![Workspace](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)

<details>
<summary>Git · Providers and models · Capabilities · Harness · Project architecture</summary>

#### Git

[![Git](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)

#### Providers and models

[![Providers and models](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)

#### Capabilities

[![Capabilities](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)

#### Harness

[![Harness](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)

#### Project architecture

[![Project architecture](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)

</details>

### Ming interfaces

<details>
<summary>General settings · Theme and skin gallery</summary>

#### General settings

[![General settings](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)

#### Theme and skin gallery

[![Theme and skin gallery](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)

</details>

### Theme gallery

<details>
<summary>Ming · Snowbound official · Ming · Snow flute scholar · Ming · Moon scholar · Starship Cockpit · macOS 27 · Liquid Ether</summary>

#### Ming · Snowbound official

[![Ming · Snowbound official](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)

#### Ming · Snow flute scholar

[![Ming · Snow flute scholar](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)

#### Ming · Moon scholar

[![Ming · Moon scholar](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)

#### Starship Cockpit

[![Starship Cockpit](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)

#### macOS 27 · Liquid Ether

[![macOS 27 · Liquid Ether](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)

</details>

<a id="download"></a>

## Download

Download a published installer from [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) and choose the file for your platform.

| Platform            | Installer                  |
| ------------------- | -------------------------- |
| macOS Apple Silicon | `.dmg` · `arm64`           |
| macOS Intel         | `.dmg` · `x64`             |
| Windows x64         | `.exe` · Windows installer |
| Linux x64           | `.AppImage`                |

New Community packages from this source include Pi, Node.js, npm and npx: install and launch without separately installing Node.js or Pi. Older downloads may have different setup requirements; follow their release notes. Choose the standard package or the `nomascot` package without mascot artwork. Windows/Linux ARM64 builds remain previews until native validation is complete; check the notes for the exact release you download.

Community releases are free. macOS packages use Ad-hoc signing without Apple Developer ID or notarization. Windows installers are unsigned and may show SmartScreen warnings. Confirm the official download source and SHA256 checksum before allowing an app to open. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** for that app.

On macOS, Apple Silicon uses ARM64 and Intel uses x64. Open the DMG and drag Pi-Harness to Applications. On Windows, run the x64 installer and choose an installation directory. On Linux, grant the downloaded AppImage executable permission (`chmod +x Pi-Harness-*.AppImage`) and open it. Linux native validation targets Ubuntu 24.04; other distributions and FUSE/desktop integration need their own checks.

Download `SHA256SUMS` alongside the installer. Calculate the installer hash and compare it with the same filename in the list (replace `VERSION` with your download's version):

```sh
# macOS
shasum -a 256 "Pi-Harness-VERSION-arm64.dmg"
# Linux
sha256sum "Pi-Harness-VERSION.AppImage"
```

```powershell
# Windows
Get-FileHash ".\Pi-Harness-Setup-VERSION.exe" -Algorithm SHA256
```

SHA256 checks consistency with the checksum list; it does not independently prove publisher identity. Use the official [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) page. Report suspected vulnerabilities privately to [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

Community builds check for new versions in the app and open the official Releases page for manual download and installation on all platforms. Automatic installation remains disabled until cross-version installation is verified. Existing installations keep their previous update behavior. See [Community Release](docs/release/community-release.md) and [update details](docs/release/update-strategy.md).

## Get started

1. Launch Pi-Harness and check the environment in Overview.
2. Configure a provider, test the connection, and select a model.
3. Start a standalone chat or open a project.
4. Start or resume a Pi session, then work with conversations, files, and Git.
5. Open Workspace Tools for Harness controls or agent teams.

## Requirements

Community release validation covers macOS Apple Silicon, macOS Intel, Windows x64 and Linux x64; platform availability is subject to each release's verified results. The bundled Pi and Node runtimes are ready to use, with System and Custom runtime choices available in settings. Source development and packaging require Node.js ≥ 22.22.2 and pnpm 9.12.1; installed users do not need these build tools.

## Documentation

- [Screenshot index](docs/README.md)
- [Changelog](CHANGELOG.md)

## Credits

Pi-Harness is built around the official [Pi Coding Agent and Pi Agent Harness](https://github.com/earendil-works/pi).

Created and maintained by [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

## License

Pi-Harness is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
