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
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<h3 align="center">The Operational Superset of Pi Coding Agent</h3>

<p align="center">
  <strong>Alles aus Native Pi plus Beobachtung, Steuerung, Wiederherstellung, Evaluation und Multi-Agent-Orchestrierung.</strong>
</p>

<p align="center">Native Pi, leistungsstärker.</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.1"><img alt="release v1.7.1" src="https://img.shields.io/badge/release-v1.7.1-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## Warum Pi-Harness?

Pi-Harness ist das Operational Superset von Pi Coding Agent. Native Pi bleibt die einzige Agent Runtime; kompatible Sessions, Tools, Models, Skills, Extensions, Context und Compaction werden um Beobachtung, Steuerung, Wiederherstellung, Evaluation und Multi-Agent-Orchestrierung ergänzt.

> **Pi führt den Agent aus; Pi-Harness macht daraus ein beobachtbares, steuerbares, wiederherstellbares und orchestrierbares Engineering-System.**

Pi-Harness ersetzt oder reimplementiert die Agent Runtime von Pi nicht.

## Was „Superset“ bedeutet

Native Pi bleibt immer im realen Ausführungspfad; Pi-Harness ergänzt darum den Harness Control Plane und den Visual Engineering Workspace.

## Pi-/Pi-Harness-Fähigkeitsmatrix

| Fähigkeit                            | Native Pi | Pi-Harness               |
| ------------------------------------ | --------- | ------------------------ |
| Agent Runtime / Loop                 | Ja        | Native Pi                |
| Sessions / Context / Compaction      | Ja        | Ja + visuelle Verwaltung |
| Steering / Follow-up / Thinking      | Ja        | Ja + visuelle Steuerung  |
| Models / Tools / Skills / Extensions | Ja        | Ja + Manager / Policy    |
| Runs / Trace / Replay / Compare      | —         | Ja                       |
| Policy / Budget / Evaluation         | —         | Ja                       |
| Checkpoint / Recovery / Diagnostics  | —         | Ja                       |
| Regression / Artifacts               | —         | Ja                       |
| Multi-Agent / Task DAG / Handoff     | —         | Ja                       |
| Review Gates / Worktree isolation    | —         | Ja                       |

## Download

Lade Pi-Harness v1.7.1 aus den [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.1) herunter.

| Plattform           | Installer                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.7.1-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.1/Pi-Harness-1.7.1-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.7.1.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.1/Pi-Harness-1.7.1.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.7.1.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.1/Pi-Harness-Setup-1.7.1.exe) |
| Linux x64           | [Pi-Harness-1.7.1.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.1/Pi-Harness-1.7.1.AppImage)   |

> **Hinweis zum Windows-Upgrade:** Beim Upgrade von v1.7.0 auf v1.7.1 wird der einmalige Reset älterer App-Daten nicht wiederholt. Auf einem Rechner, auf dem die installierte Version v1.7.0 noch nie gestartet wurde, werden ältere Pi-Harness-Einstellungen, der lokale Anmeldedatentresor, App-Backups und Caches einmalig zurückgesetzt. Das separate Datenverzeichnis von Pi Agent und Projektdateien werden nicht zurückgesetzt.
>
> macOS-Community-Builds können unsigniert sein. Falls macOS den ersten Start blockiert, verwende **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen**. Details stehen in den [Hinweisen zu v1.7.1](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.1).

Nutzer der paketierten App müssen das Repository nicht klonen und pnpm nicht installieren. Pi-Harness kann Node.js, npm, PATH und Pi Coding Agent in unterstützten Umgebungen erkennen, installieren und reparieren.

## Was du tun kannst

- **Workspace:** Pi-Sitzungen in einem echten Projekt starten oder fortsetzen und Streaming, Thinking, Tool Calls, Dateien und Git zusammen nutzen.
- **Providers & Models:** Pi-kompatible Anbieter und Modelle einrichten, die Verbindung testen und das aktive Modell wählen.
- **Skills, Packages & MCP:** lokale Skills und Pi-Pakete verwalten; MCP über unterstützte Pakete anbinden.
- **Environment:** Node.js, npm, PATH und Pi erkennen und typische Installationsprobleme direkt in der Desktop-App beheben.
- **Files & Git:** Dateien durchsuchen und hochladen, mit Konfliktschutz bearbeiten sowie Git Diff und Worktrees verwenden.
- **Diagnostics:** Zustand der Anwendung und Umgebung prüfen.
- **Start und Erscheinungsbild:** Beim Start prüft Pi-Harness die npm-Registry, Node.js, npm, Pi Agent und die Konfiguration und zeigt mindestens fünf Sekunden lang eine einfarbige Quantenpartikel-Animation. In den allgemeinen Einstellungen lassen sich Classic-, Ming- oder Quantum-App-Symbole, Fenster- und Bildschirmleuchten sowie der Flammeneffekt des Eingabefelds wählen. Die Version ohne Maskottchen behält die Standardanimation und diese Einstellungen bei, ohne optionale Maskottchen-Themen zu laden.

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

Dieselben Hauptansichten werden im Standardthema und im Ming-Stil gezeigt. Der Ming-Arbeitsbereich umfasst eine Schnee- und eine Mondnacht-Variante.

### Standardthema

|                        Arbeitsbereich                        |                            Git                             |
| :----------------------------------------------------------: | :--------------------------------------------------------: |
|  ![Arbeitsbereich im Standardthema](docs/默认主题/Work.jpg)  |       ![Git im Standardthema](docs/默认主题/Git.jpg)       |
|                         **Anbieter**                         |                        **Modelle**                         |
|     ![Anbieter im Standardthema](docs/默认主题/APIs.jpg)     |    ![Modelle im Standardthema](docs/默认主题/Model.jpg)    |
|                     **Funktionszentrum**                     |                     **Einstellungen**                      |
| ![Funktionszentrum im Standardthema](docs/默认主题/Caps.jpg) | ![Einstellungen im Standardthema](docs/默认主题/Prefs.jpg) |

### Ming-Stil

|                   Arbeitsbereich (Schnee)                   |                   Arbeitsbereich (Mondnacht)                   |
| :---------------------------------------------------------: | :------------------------------------------------------------: |
| ![Arbeitsbereich Schnee im Ming-Stil](docs/古风/Work-1.jpg) | ![Arbeitsbereich Mondnacht im Ming-Stil](docs/古风/Work-2.jpg) |
|                             Git                             |                          **Anbieter**                          |
|           ![Git im Ming-Stil](docs/古风/Git.jpg)            |          ![Anbieter im Ming-Stil](docs/古风/APIs.jpg)          |
|                         **Modelle**                         |                      **Funktionszentrum**                      |
|        ![Modelle im Ming-Stil](docs/古风/Model.jpg)         |      ![Funktionszentrum im Ming-Stil](docs/古风/Caps.jpg)      |
|                      **Einstellungen**                      |                                                                |
|     ![Einstellungen im Ming-Stil](docs/古风/Prefs.jpg)      |                                                                |

## Editor-Grenze

Pi-Harness bearbeitet lesbare Textdateien mit Syntax-Highlighting, Zeilennummern, Rückgängig/Wiederholen, Suche, explizitem Speichern und Schutz vor externen Änderungen. Große, binäre, Medien- und Dokumentdateien werden schreibgeschützt angezeigt.

Es ist keine IDE: kein LSP/IntelliSense, semantisches Refactoring, Debugger, Task Runner, integriertes Terminal oder IDE-Erweiterungssystem.

## Architektur

Native Pi ist in der Ausführungsarchitektur von Pi-Harness enthalten und wird nicht ersetzt.

```text
                         Pi-Harness
┌─────────────────────────────────────────────────────┐
│                                                     │
│                Superset Capabilities                │
│                                                     │
│  Observe              Control          Orchestrate  │
│  ─────────            ─────────        ───────────  │
│  Runs                 Policy           Agents       │
│  Trace                Budget           Teams        │
│  Replay               Checkpoints      Tasks        │
│  Diagnostics          Recovery         DAG          │
│  Evaluation           Permissions      Handoffs     │
│  Regression                            Review Gates │
│  Artifacts                             Worktrees    │
│                                                     │
│  Workspace · Models · Providers · Skills · Git      │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                  Native Pi                    │  │
│  │                                               │  │
│  │ Agent Runtime · Sessions · Context · Tools    │  │
│  │ Compaction · Thinking · Skills · Extensions  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Die Desktop-Grenze bleibt `Vue Renderer → typed preload API → validated IPC → Main services → Pi compatibility layer → Native Pi SDK`. Sessions bleiben mit Pi-CLI-JSONL unter <code>~/.pi/agent/sessions/</code> kompatibel.

## Harness Control Plane

Runs, Trace, Replay, Run Tree, Run Compare, Policy, Budget, Checkpoints, Recovery, Permissions, Evaluation, Diagnostics, Regression und Artifacts sind veröffentlicht. Die Daten stammen aus echten Pi Events, Sessions und Befehlsergebnissen.

## Multi-Agent-Orchestrierung

Agents, Teams, Tasks, Dependencies, Handoffs, Review Gates, Budget, Worktree-Isolation sowie pause, resume, abort, retry, skip und reassign werden unterstützt. Jeder Agent läuft über eine echte Pi Session.

## Pi Superset Contract

Pi-Harness ist ein operational superset von Pi Coding Agent. Es bewahrt Native Pis Agent Runtime und Kompatibilität und ergänzt Beobachtbarkeit, Governance, Orchestrierung, Wiederherstellung, Evaluation und einen visuellen Engineering-Arbeitsbereich.

- Pi-Harness reduziert Native-Pi-Fähigkeiten nicht absichtlich und wahrt native Pi-Formate, soweit dies technisch möglich ist.
- Native Pi bleibt immer die Ausführungs-Runtime. Agent Loop, Context, Compaction, Tools, Skills und Extensions werden nicht neu implementiert.
- Native Pi-Sessions und -Konfiguration bleiben eigenständig nutzbar; Harness-spezifischer Zustand wird getrennt gespeichert.
- Erweiterungen sind standardmäßig additiv; neue Pi-Fähigkeiten werden zuerst über die Kompatibilitätsschicht eingebunden.
- Die Kompatibilität nutzt capability detection, graceful degradation und best-effort forward compatibility.

## Roadmap

- Session-Tree-Visualisierung und tiefere Context-/Queue-Inspektoren
- Erweiterte Workspace-Berechtigungen und Verifikationsintegrationen
- Harness Profiles und intelligentere Run Analysis

## Voraussetzungen

Paketierte App:

- macOS Apple Silicon, macOS Intel oder Windows x64
- Pi Coding Agent, das Pi-Harness in der App installieren oder reparieren kann

Entwicklung aus dem Quellcode:

- Node.js ≥ 22.19.0
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
