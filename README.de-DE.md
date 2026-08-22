# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>Vollständiger Desktop-Harness für <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Local-first Desktop-Harness · Electron · Vue 3 · TypeScript
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
  <img alt="version" src="https://img.shields.io/badge/version-1.0.7-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

Verwalten Sie Anbieter, Modelle, API-Schlüssel, Skills, Pi-Konfiguration, Backups und Diagnose und arbeiten Sie anschließend im Arbeitsbereich direkt mit Pi Coding Agent an einem echten Projekt.

Geheimnisse erscheinen im Renderer nie im Klartext. macOS speichert sie im System-Schlüsselbund; Windows und Linux nutzen Electron `safeStorage`. Unbekannte Pi-Felder bleiben erhalten.

## Screenshots

| Übersicht | Einstellungen |
| :---: | :---: |
| ![Übersicht](docs/概览.jpg) | ![Einstellungen](docs/设置.jpg) |
| **Arbeitsbereich — Sitzungen** | **Arbeitsbereich — Editor** |
| ![Arbeitsbereich Sitzungen](docs/工作区-1.jpg) | ![Arbeitsbereich Editor](docs/工作区-2.jpg) |
| **Anbieter — Liste** | **Anbieter — Details** |
| ![Anbieterliste](docs/提供商-1.jpg) | ![Anbieterdetails](docs/提供商-2.jpg) |
| **Modelle — Liste** | **Modelle — Details** |
| ![Modellliste](docs/模型-1.jpg) | ![Modelldetails](docs/模型-2.jpg) |
| **Skills — Installiert** | **Skills — Markt** |
| ![Installierte Skills](docs/技能-1.jpg) | ![Skills-Markt](docs/技能-2.jpg) |

## Funktionen

| Modul | Beschreibung |
| --- | --- |
| **Übersicht** | Aktives Modell, Pi-CLI / Konfigurationsverzeichnis, Umgebungsstatus und häufige Aktionen |
| **Arbeitsbereich** | Projekte, Sessions, Streaming-Chat, Thinking, Tool Call, leichtgewichtige Codebearbeitung, Git Diff und Worktree |
| **Anbieter** | Provider ≠ Protocol ≠ Model; Zugangsdaten in Keychain / `safeStorage` |
| **Modelle** | Fähigkeitsflags, aktives Modell, Verbindungstest; nach dem Schreiben wird `settings.json` erneut gelesen |
| **Skills** | `SKILL.md` erstellen / importieren / bearbeiten / prüfen; Pfadwurzel-Beschränkung |
| **Konfiguration** | CodeMirror-Editor für `models.json` / `settings.json`; Formatieren und im Dateimanager anzeigen |
| **Diagnose** | Umgebungsbericht; Kopieren wird bereinigt (`apiKey` / `token` / `secret` usw.) |
| **Einstellungen** | 简体中文 / English / 한국어 / Русский / Français / Deutsch, Dunkel / Hell, Standard- / Kompaktdichte, Backups |

Zuverlässigkeit:

- Automatisches Backup vor dem Schreiben; atomare Schreibvorgänge
- Erkennung externer Änderungen (mtime) mit Reload / Compare / Overwrite
- Paketierte Builds unterstützen `electron-updater` (keine stille Auto-Installation)
- Nur Desktop: externe Browserfenster und URL-Handoff außerhalb der App werden blockiert

## Voraussetzungen

- Node.js ≥ 22 (wird bei der Abhängigkeitsinstallation erzwungen)
- pnpm `9.12.1` (siehe Feld `packageManager`)
- [Pi Coding Agent](https://github.com/badlogic/pi-mono) installiert, oder Installation / Update aus der App

## Schnellstart

```bash
pnpm install
pnpm dev
```

Ohne lokale Pi-Installation in den Einstellungen das Konfigurationsverzeichnis auf `fixtures/mock-pi/` setzen, oder:

```bash
cp .env.example .env
# PI_HARNESS_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

Keine Geheimnisse in `VITE_*`-Variablen speichern — sie landen im Renderer-Bundle.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `pnpm typecheck` | Vue- / TypeScript-Typprüfung |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest-Unit-Tests |
| `pnpm test:e2e` | Kompilieren, dann Playwright-Electron-Smoke |
| `pnpm compile` | Vite-Build nach `out/` (kein Installer) |
| `pnpm build` | Kompilieren und Pakete für macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | Nur macOS |

## Architektur

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentSession      Projekte / Sessions / Streaming-Ausführung
                                                ├─ Workspace         Dateien / leichter Editor / Git
                                                ├─ PiConfigService   atomares Schreiben / mtime-Konflikt
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Die Domain bleibt über einen Adapter vom nativen Pi-JSON entkoppelt. Unbekannte Felder werden durchgereicht. Die Logik ist nicht an einen bestimmten Modellnamen gebunden.

## Autor

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## Lizenz

Pi-Harness ist freie Software unter der [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`). Nutzung, Änderung und Weitergabe sind gemäß den Lizenzbedingungen erlaubt. Über ein Netzwerk bereitgestellte geänderte Versionen müssen ihren Benutzern den korrespondierenden Quellcode gemäß AGPL v3 anbieten.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
