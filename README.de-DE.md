# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>Der vollständige Desktop-Arbeitsbereich für <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Pi konfigurieren · Agents ausführen · Modelle, Skills, Pakete und Projekte verwalten
</p>

<p align="center">
  Alles, was du zum Konfigurieren, Ausführen und Erweitern von Pi Coding Agent brauchst, in einer nativen Desktop-App.
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
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.2"><img alt="release v1.1.2" src="https://img.shields.io/badge/release-v1.1.2-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

<p align="center">
  <a href="docs/workspace.mp4?raw=1"><img src="docs/workspace-3.jpg" width="920" alt="Demo des Pi-Harness-Arbeitsbereichs" /></a><br />
  <a href="docs/workspace.mp4?raw=1">▶ Demo des Pi-Harness-Arbeitsbereichs ansehen</a>
</p>

## Warum Pi-Harness?

### Mehr als eine Pi-Chat-Oberfläche

Ein einfacher Desktop-Client öffnet Pi und startet einen Chat. Pi-Harness bündelt Umgebung, Anbieter, Modelle, Skills, Pakete, Projekte, Dateien und Git in einem Desktop-Arbeitsbereich.

```text
Einfacher Desktop-Client              Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness ist kein Wrapper um eine Web-Oberfläche. Es bettet weder pi-web noch einen Next.js-Server oder iframe ein und fügt keine zweite Agent Runtime hinzu. Pi Coding Agent bleibt die einzige Agent Runtime; Sitzungen sind mit den Pi-CLI-JSONL-Dateien unter ~/.pi/agent/sessions/ kompatibel.

**Pi konfigurieren. Pi ausführen. Pi erweitern.**

## Download

Lade Pi-Harness v1.1.2 aus den [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.2) herunter.

| Plattform           | Installer                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.1.2-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.2/Pi-Harness-1.1.2-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.1.2.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.2/Pi-Harness-1.1.2.dmg)             |
| Windows x64         | [Pi-Harness.Setup.1.1.2.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.2/Pi-Harness.Setup.1.1.2.exe) |

> macOS-Community-Builds können unsigniert sein. Falls macOS den ersten Start blockiert, verwende **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen**. Details stehen in den [Hinweisen zu v1.1.2](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.2).

Nutzer der paketierten App müssen das Repository nicht klonen und pnpm nicht installieren. Pi-Harness kann Node.js, npm, PATH und Pi Coding Agent in unterstützten Umgebungen erkennen, installieren und reparieren.

## Was du tun kannst

- **Workspace:** Pi-Sitzungen in einem echten Projekt starten oder fortsetzen und Streaming, Thinking, Tool Calls, Dateien und Git zusammen nutzen.
- **Providers & Models:** Pi-kompatible Anbieter und Modelle einrichten, die Verbindung testen und das aktive Modell wählen.
- **Skills, Packages & MCP:** lokale Skills und Pi-Pakete verwalten; MCP über unterstützte Pakete anbinden.
- **Environment:** Node.js, npm, PATH und Pi erkennen und typische Installationsprobleme direkt in der Desktop-App beheben.
- **Files & Git:** Dateien durchsuchen und hochladen, mit Konfliktschutz bearbeiten sowie Git Diff und Worktrees verwenden.
- **Diagnostics:** Zustand der Anwendung und Umgebung prüfen.

## So funktioniert es

1. Pi-Harness starten und die Umgebung prüfen.
2. Einen Provider konfigurieren.
3. Ein Modell wählen und die Verbindung testen.
4. Ein Projekt öffnen.
5. Eine Pi-Sitzung starten oder fortsetzen.

```text
Installieren → Provider konfigurieren → Modell wählen → Projekt öffnen → Pi ausführen
```

## Screenshots

### 1. Bereitschaft prüfen

![Übersicht](docs/overview.jpg)

### 2. Pi in einem echten Projekt ausführen

|        Projektsitzungen         | Dateien und leichte Bearbeitung |
| :-----------------------------: | :-----------------------------: |
| ![Sitzungen](docs/workspace-1.jpg) |  ![Editor](docs/workspace-2.jpg)   |

![Starship-Cockpit-Arbeitsbereich](docs/workspace-3.jpg)

### 3. Anbieter und Modelle konfigurieren

|              Anbieter               |          Anbieter einrichten          |
| :---------------------------------: | :-----------------------------------: |
| ![Anbieterliste](docs/providers-1.jpg) | ![Anbieterdetails](docs/providers-2.jpg) |
|             **Modelle**             |         **Modell einrichten**         |
|   ![Modellliste](docs/models-1.jpg)   |   ![Modelldetails](docs/models-2.jpg)   |

### 4. Pi erweitern

![Skills-Markt](docs/skills.jpg)

### 5. Workspace anpassen

![Einstellungen für Erscheinungsbild und Maskottchen](docs/settings.jpg)

![Auswahl des Maskottchen-Stils](docs/mascot-settings.jpg)

## Editor-Grenze

Pi-Harness bearbeitet lesbare Textdateien mit Syntax-Highlighting, Zeilennummern, Rückgängig/Wiederholen, Suche, explizitem Speichern und Schutz vor externen Änderungen. Große, binäre, Medien- und Dokumentdateien werden schreibgeschützt angezeigt.

Es ist keine IDE: kein LSP/IntelliSense, semantisches Refactoring, Debugger, Task Runner, integriertes Terminal oder IDE-Erweiterungssystem.

## Architektur

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       Pi verwalten           Pi verwenden       Pi erweitern

       Providers              Projects           Skills
       Models                 Sessions           Packages
       Environment            Agent              MCP adapters
       Config / Secrets       Streaming          Presets
       Backup / Diagnostics   Files / Git
       Updates                Worktree
              └────────────────────┼────────────────────┘
                                   ▼
                           Pi Coding Agent
```

Pi Coding Agent bleibt die einzige Agent Runtime.

## Voraussetzungen

Paketierte App:

- macOS Apple Silicon, macOS Intel oder Windows x64
- Pi Coding Agent, das Pi-Harness in der App installieren oder reparieren kann

Entwicklung aus dem Quellcode:

- Node.js ≥ 22
- pnpm 9.12.1

## Entwicklung

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Übliche Prüfungen: pnpm typecheck, pnpm lint, pnpm test, pnpm compile und pnpm test:e2e:only. Keine Geheimnisse in VITE_*-Variablen speichern; sie landen im Renderer-Bundle.

## Dokumentation

- [Änderungsprotokoll](CHANGELOG.md)

## Lizenz

Pi-Harness wird unter der [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only) veröffentlicht.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## Autor

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
