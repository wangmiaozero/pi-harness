# Pi-Switch

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Switch" />
</p>

<p align="center">
  <strong>All-in-One Desktop Manager for <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Local-first desktop configuration manager · Electron · Vue 3 · TypeScript
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
  <img alt="version" src="https://img.shields.io/badge/version-0.3.0-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

Manage providers, models, API keys, skills, raw Pi config, backups, and diagnostics from a desktop UI — without hand-editing `~/.pi/agent/*.json`.

Secrets never appear in the renderer as plaintext. macOS stores them in the system Keychain; Windows and Linux use Electron `safeStorage`. Unknown Pi fields are preserved.

## Screenshots

| Overview | Providers |
| :---: | :---: |
| ![Overview](docs/1.jpg) | ![Providers](docs/2.jpg) |
| **Models** | **Skills** |
| ![Models](docs/3.jpg) | ![Skills](docs/4.jpg) |

## Features

| Module | Description |
| --- | --- |
| **Overview** | Active model, Pi CLI / config directory, environment status, and common actions |
| **Providers** | Provider ≠ Protocol ≠ Model; credentials go to Keychain / `safeStorage` |
| **Models** | Capability flags, active model, connection test; writes re-read `settings.json` to verify |
| **Skills** | Create / import / edit / validate `SKILL.md`; path-root enforcement |
| **Config** | CodeMirror editor for `models.json` / `settings.json`; format and reveal in the file manager |
| **Diagnostics** | Environment report; copy is sanitized (`apiKey` / `token` / `secret`, etc.) |
| **Settings** | zh-CN / English / 한국어 / Русский / Français / Deutsch, dark / light, standard / compact density, backups |

Reliability:

- Automatic backup before writes; atomic writes
- External change detection (mtime) with Reload / Compare / Overwrite
- Packaged builds support `electron-updater` (never silent auto-install)
- Desktop-only: external browser windows and off-app URL handoff are blocked

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
# PI_SWITCH_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

Do not store secrets in `VITE_*` variables — they are bundled into the renderer.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Vue / TypeScript typecheck |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Compile, then run Playwright Electron smoke tests |
| `pnpm compile` | Vite build to `out/` (no installer) |
| `pnpm build` | Compile and package macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | macOS only |

## Architecture

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ PiConfigService   atomic write / mtime conflict
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Domain stays decoupled from Pi native JSON via an Adapter. Unknown fields pass through. Logic is not hard-coded to a specific model name.

## Author

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-switch](https://github.com/wangmiaozero/pi-switch)

## License

[MIT](./LICENSE) © 2026 wangmiao
