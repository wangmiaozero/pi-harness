# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>Local-first Desktop-Steuerzentrale und nativer Arbeitsbereich für <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Pi konfigurieren · Projektsitzungen ausführen · Lokale Dateien anzeigen und bearbeiten
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

Pi-Harness verwaltet Pi-Anbieter, Modelle, Zugangsdaten, Skills, Rohkonfiguration, Backups und Diagnose und führt projektbezogene Pi-Agent-Sitzungen in einem nativen Arbeitsbereich aus. Sitzungen bleiben mit den Pi-CLI-JSONL-Dateien unter `~/.pi/agent/sessions/` kompatibel; pi-web, Next.js-Server und iframe werden nicht eingebettet.

Geheimnisse erscheinen im Renderer nie im Klartext. macOS speichert sie im System-Schlüsselbund; Windows und Linux nutzen Electron `safeStorage`. Unbekannte Pi-Felder bleiben erhalten.

## Highlights in v1.0.9

- Assistant-Antworten werden als sicheres Streaming-Markdown mit expliziter Tag- und Protokoll-Whitelist dargestellt.
- Tool Result ist standardmäßig eingeklappt und öffnet sich in einem begrenzten scrollbaren Bereich.
- Das globale Maskottchen ist standardmäßig deaktiviert; sechs Stile einschließlich neuer Büro- und Maid-Varianten sind auswählbar.

## Screenshots

|                   Übersicht                    |         Einstellungen — Maskottchen         |
| :--------------------------------------------: | :-----------------------------------------: |
|          ![Übersicht](docs/概览.jpg)           | ![Maskottchen-Einstellungen](docs/设置.jpg) |
|         **Arbeitsbereich — Sitzungen**         |         **Arbeitsbereich — Editor**         |
| ![Arbeitsbereich Sitzungen](docs/工作区-1.jpg) | ![Arbeitsbereich Editor](docs/工作区-2.jpg) |
|              **Anbieter — Liste**              |           **Anbieter — Details**            |
|      ![Anbieterliste](docs/提供商-1.jpg)       |    ![Anbieterdetails](docs/提供商-2.jpg)    |
|              **Modelle — Liste**               |            **Modelle — Details**            |
|        ![Modellliste](docs/模型-1.jpg)         |      ![Modelldetails](docs/模型-2.jpg)      |
|            **Skills — Installiert**            |             **Skills — Markt**              |
|    ![Installierte Skills](docs/技能-1.jpg)     |      ![Skills-Markt](docs/技能-2.jpg)       |

## Funktionen

| Modul              | Beschreibung                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Übersicht**      | Aktives Modell, Pi-CLI / Konfigurationsverzeichnis, Umgebungsstatus und häufige Aktionen                            |
| **Arbeitsbereich** | Native Projekte und Pi-Sitzungen, Streaming-Chat, Thinking / Tool Call, leichte Bearbeitung, Git Diff und Worktree  |
| **Anbieter**       | Durchsuchbare Pi-kompatible Presets; Provider ≠ Protocol ≠ Model; Keychain / `safeStorage`                          |
| **Modelle**        | Preset- oder eigene Modell-IDs, Fähigkeitsmetadaten, aktive Auswahl, Verifikation nach dem Schreiben                |
| **Skills**         | `SKILL.md` erstellen / importieren / bearbeiten / prüfen; Pfadwurzel-Beschränkung                                   |
| **Konfiguration**  | CodeMirror-Editor für `models.json` / `settings.json`; Formatieren und im Dateimanager anzeigen                     |
| **Diagnose**       | Umgebungsbericht; Kopieren wird bereinigt (`apiKey` / `token` / `secret` usw.)                                      |
| **Einstellungen**  | Oberfläche 简体中文 / English, System/Dunkel/Hell, Dichte, Werkzeug-Preset, Wiederherstellung, Backups, Maskottchen |

Zuverlässigkeit:

- Automatisches Backup vor dem Schreiben; atomare Schreibvorgänge
- Erkennung externer Änderungen (mtime) mit Reload / Compare / Overwrite
- Paketierte Builds prüfen und laden Updates im Hintergrund; Installation beim Beenden oder über **Installieren & Neustarten**
- Nur Desktop: externe Browserfenster und URL-Handoff außerhalb der App werden blockiert

## Grenze des leichtgewichtigen Editors

Der Arbeitsbereich bearbeitet lesbare Textdateien mit verzögertem Syntax-Highlighting, Zeilennummern, Rückgängig/Wiederholen, Suche, explizitem Speichern, Änderungsanzeigen und Schutz vor externen Änderungen. Unbekannte Texterweiterungen werden als Klartext geöffnet; große, binäre, Medien- und Dokumentdateien bleiben schreibgeschützt.

Pi-Harness ist bewusst keine allgemeine IDE: kein LSP/IntelliSense, semantisches Refactoring, Debugger, Task Runner, integriertes Terminal oder IDE-Erweiterungssystem. Siehe [Grenze des leichtgewichtigen Editors](docs/lightweight-code-editor.md).

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

| Befehl           | Zweck                                                           |
| ---------------- | --------------------------------------------------------------- |
| `pnpm typecheck` | Vue- / TypeScript-Typprüfung                                    |
| `pnpm lint`      | ESLint                                                          |
| `pnpm test`      | Vitest-Unit-Tests                                               |
| `pnpm test:e2e`  | Kompilieren, dann Playwright-Electron-Smoke                     |
| `pnpm compile`   | Vite-Build nach `out/` (kein Installer)                         |
| `pnpm build`     | Kompilieren und Pakete für macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | Nur macOS                                                       |

## Architektur

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentRuntime      Pi-Sitzungen / Streaming / Werkzeugereignisse
                                                ├─ Workspace         Projekte / Dateien / leichter Editor / Git
                                                ├─ PiConfigService   atomares Schreiben / mtime-Konflikt
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Die Domain bleibt über einen Adapter vom nativen Pi-JSON entkoppelt. Unbekannte Felder werden durchgereicht. Die Logik ist nicht an einen bestimmten Modellnamen gebunden.

## Projektdokumentation

- [Änderungsprotokoll](CHANGELOG.md)
- [Anwendungsupdates und Release-Artefakte](docs/application-updates.md)
- [Grenze des leichtgewichtigen Code-Editors](docs/lightweight-code-editor.md)
- [Maskottchen-Design und Laufzeitregeln](docs/mascot-design.md)

## Autor

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## Lizenz

Pi-Harness ist freie Software unter der [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`). Nutzung, Änderung und Weitergabe sind gemäß den Lizenzbedingungen erlaubt. Über ein Netzwerk bereitgestellte geänderte Versionen müssen ihren Benutzern den korrespondierenden Quellcode gemäß AGPL v3 anbieten.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
