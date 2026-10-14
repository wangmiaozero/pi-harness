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

<h3 align="center">Das Operational Superset von Pi Coding Agent</h3>

<p align="center">
  <strong>Native Pi mit visuellem Workspace, Ausführungssteuerung, Wiederherstellung und Agenten-Teams.</strong>
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="#download"><strong>Download</strong></a> ·
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>Eigenen Skin erstellen</strong></a> ·
  <a href="#screenshots">Screenshots</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="Veröffentlichte Versionen" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

## Warum Pi-Harness?

Pi-Harness bringt Pi Coding Agent in einen Desktop-Workspace für macOS, Windows und Linux. Verwalte Chats, Projekte, Dateien, Git, Modelle und Skills an einem Ort und nutze Werkzeuge zur Prüfung von Ausführungen, Budgetsteuerung, Wiederherstellung und Zusammenarbeit von Agenten.

Native Pi führt die Agenten aus. Pi-Sitzungen, Konfiguration, Werkzeuge, Skills und Erweiterungen bleiben mit Pi kompatibel. Du kannst Pi auch außerhalb der Desktop-App weiter nutzen.

## Funktionen

### Workspace, Dateien und Git

Starte einen eigenständigen Chat oder öffne ein Projekt und setze eine Pi-Sitzung fort. Verfolge Streaming-Antworten, Denkprozesse, Werkzeugaufrufe, Bilder und Dateiänderungen; wähle Modell, Denkstufe und Werkzeuge oder komprimiere den Gesprächskontext. Über die Workspace-Werkzeuge erreichst du Harness und Agenten, während Chat und ungesendeter Entwurf erhalten bleiben.

Durchsuche Dateien, zeige Medien und Dokumente in der Vorschau an und bearbeite Text mit Syntaxhervorhebung, Zeilennummern, Suche, Rückgängig/Wiederholen, ausdrücklichem Speichern und Schutz vor Konflikten durch externe Änderungen. Git bietet Diffs, Verlauf, Aktivitätsgrafiken, Commits, optionale KI-Commit-Nachrichten und Worktrees.

### Anbieter und Modelle

Richte Pi-kompatible Anbieter mit Vorlagen oder eigenen Endpunkten ein, verwalte Zugangsdaten, lade unterstützte Modelllisten, teste Verbindungen und wähle dein Chatmodell. Mit unterstützten Bildmodellen kannst du Bilder erzeugen oder bearbeiten und die Ergebnisse herunterladen.

### Skills, Erweiterungen, Pakete und MCP

Durchsuche und bearbeite integrierte und lokale Skills und verwalte Pi-Pakete und Erweiterungen im Funktionsbereich. Gib `@` im Eingabefeld ein, um einen installierten Skill zu suchen und aufzurufen. Verbinde MCP über unterstützte Pakete. Optionale Ergänzungen wie [Superpowers](https://github.com/obra/superpowers) und [Odai](https://github.com/orziz/odai) kannst du bei Bedarf installieren, aktualisieren oder entfernen.

### Harness: beobachten, steuern und wiederherstellen

Prüfe Runs, Trace, Replay, Zeitleisten und Werkzeugaktivitäten. Vergleiche Ausführungen, verfolge Verzweigungen und Wiederholungen im Run Tree und sieh Tokens, Kosten, Dauer, Artefakte und Projektstatistiken ein.

Lege Werkzeugrichtlinien und Budgets pro Ausführung fest, erstelle Checkpoints und setze Arbeit fort, verzweige sie oder wiederhole sie. Evaluation, Diagnose und Regressionsbaselines helfen, Ergebnisse und Fehler anhand aufgezeichneter Ausführungsdaten zu prüfen.

### Agenten-Teams und Aufgabenkoordination

Koordiniere Pi-Agenten mit wiederverwendbaren Teams und Vorlagen. Weise Aufgaben Abhängigkeiten, Prioritäten und Verantwortliche zu, starte sie manuell, nacheinander oder parallel, übergib Ergebnisse und Artefakte und nutze Prüfschritte. Worktrees trennen Änderungen; Budgets, Konflikthinweise sowie Pause, Fortsetzen, Abbrechen, Wiederholen, Überspringen und Neuzuweisen helfen bei der Steuerung.

### Lokaler Gesprächsverlauf

Durchsuche gemeinsam die Verläufe von Claude Code, Codex (einschließlich Desktop und Archiv), Cursor, Cursor Agent, Gemini CLI, OpenCode und Pi. Filtere nach Quelle, Projekt oder Zeitraum und füge eigene Verlaufsordner hinzu.

Das ursprüngliche Gespräch bleibt schreibgeschützt. Prüfe die Übergabevorschau und bearbeite die nächste Anweisung, bevor du in einem neuen Pi-Chat desselben Projekts fortfährst. Ansehen, lokale Vorschauen und erneute Scans verbrauchen keine Modell-Tokens. Optionale KI-Zusammenfassungen verwenden dein konfiguriertes Modell nur auf Wunsch.

### Projektarchitektur

Öffne Architecture im Workspace, um Module, Abhängigkeiten, Einstiegspunkte und Quellcode-Verweise zu erkunden. Filtere nach Paket, fokussiere ein Modul, wechsle Kartenseiten, zoome oder nutze Vollbild. Speichere Analysen, erkenne veraltete Ergebnisse nach Quellcodeänderungen und exportiere JSON, Offline-HTML oder die aktuelle Ansicht als PNG.

Die lokale Analyse verbraucht keine Modell-Tokens; KI-Beschreibungen sind optional. Importbeziehungen von JavaScript, TypeScript und Vue werden lokal analysiert, andere unterstützte Sprachen erhalten einen Dateiindex. Abdeckung und Grenzen der Analyse werden angezeigt.

### Themes und eigene Skins

Wähle klassische Farbpaletten, Ming, Starship Cockpit, macOS-27-Hintergründe oder einen importierten Skin. Neue Installationen starten im dunklen Theme. Passe Chatnamen, App-Symbole, lokale Hintergrundbilder, Fenster- und Bildschirmleuchten sowie den Flammeneffekt des Eingabefelds an. Eine Startanimation begleitet die Umgebungsprüfung; Builds ohne Maskottchen behalten die allgemeinen Darstellungsoptionen.

### Umgebung und App-Einstellungen

Prüfe Node.js, npm, PATH, Pi Coding Agent und die aktive Konfiguration. Installiere, aktualisiere oder repariere Pi in unterstützten Umgebungen, nutze Diagnosen, verwalte Konfigurationssicherungen und prüfe App-Updates. Die Oberfläche ist in acht Sprachen verfügbar.

## Eigenen Skin erstellen

Erstelle deinen gewünschten Stil mit dem [Pi-Harness Skin-Starter](https://github.com/wangmiaozero/pi-harness-skin-starter).

1. Verwende das Starter-Repository als Vorlage oder lade es herunter.
2. Öffne es mit deinem Coding-Agenten und beschreibe den Stil im mitgelieferten Prompt.
3. Importiere das fertige Projekt unter **Einstellungen → Thema → Skin importieren**.

Der mehrsprachige Starter enthält Hinweise zu Farben, Vorschauen, Hintergründen und optionalen Charakterbildern. Aktualisiere und teile deinen Skin unabhängig in einem eigenen Repository.

<a id="screenshots"></a>

## Screenshots

Die Funktionsansichten sind nach Theme geordnet. Weitere Ansichten findest du im [vollständigen Screenshot-Verzeichnis](docs/README.md).

### Klassisches Theme

|                              Workspace                               |                             Git                              |
| :------------------------------------------------------------------: | :----------------------------------------------------------: |
|           ![Workspace](docs/功能界面/经典主题/工作区.png)            |            ![Git](docs/功能界面/经典主题/Git.png)            |
|                       **Anbieter und Modelle**                       |                     **Funktionsbereich**                     |
| ![Anbieter und Modelle](docs/功能界面/经典主题/Provider与模型-1.png) |  ![Funktionsbereich](docs/功能界面/经典主题/能力中心-1.png)  |
|                             **Harness**                              |                    **Projektarchitektur**                    |
|         ![Harness](docs/功能界面/经典主题/工具Harness-1.png)         | ![Projektarchitektur](docs/功能界面/经典主题/项目架构-1.png) |

### Ming-Funktionsansichten

|                   Allgemeine Einstellungen                   |                    Themes und Skins                    |
| :----------------------------------------------------------: | :----------------------------------------------------: |
| ![Allgemeine Einstellungen](docs/功能界面/大明/通用设置.png) | ![Themes und Skins](docs/功能界面/大明/主题皮肤库.png) |

### Theme-Galerie

|                     Ming · Beamter im Schnee                     |                   Ming · Flötenspielerin in der Schneenacht                   |
| :--------------------------------------------------------------: | :---------------------------------------------------------------------------: |
|   ![Ming · Beamter im Schnee](docs/主题展示/大明/雪境朝臣.png)   | ![Ming · Flötenspielerin in der Schneenacht](docs/主题展示/大明/雪夜笛姬.png) |
|                 **Ming · Gelehrte im Mondlicht**                 |                             **Starship Cockpit**                              |
| ![Ming · Gelehrte im Mondlicht](docs/主题展示/大明/月城书姬.png) |             ![Starship Cockpit](docs/主题展示/星舰/霜星领航.png)              |

<p align="center">
  <strong>macOS 27 · Liquid Ether</strong><br>
  <img src="docs/主题展示/macOS%2027/Liquid%20Ether.png" alt="macOS 27 · Liquid Ether" width="80%" />
</p>

<a id="download"></a>

## Download

Lade einen veröffentlichten Installer von [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) herunter und wähle die Datei für deine Plattform.

| Plattform           | Installer                  |
| ------------------- | -------------------------- |
| macOS Apple Silicon | `.dmg` · `arm64`           |
| macOS Intel         | `.dmg` · `x64`             |
| Windows x64         | `.exe` · Windows-Installer |
| Linux x64           | `.AppImage`                |

Nutzer der paketierten App müssen das Repository nicht klonen oder pnpm installieren. In unterstützten Umgebungen hilft Pi-Harness bei der Einrichtung von Pi und dessen Laufzeitumgebung.

> macOS-Community-Builds können unsigniert sein. Falls der erste Start blockiert wird, nutze **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen**.

## Erste Schritte

1. Starte Pi-Harness und prüfe die Umgebung in der Übersicht.
2. Richte einen Anbieter ein, teste die Verbindung und wähle ein Modell.
3. Starte einen eigenständigen Chat oder öffne ein Projekt.
4. Starte oder setze eine Pi-Sitzung fort und arbeite mit Chats, Dateien und Git.
5. Öffne die Workspace-Werkzeuge für Harness-Steuerung oder Agenten-Teams.

## Voraussetzungen

Die Desktop-App unterstützt macOS Apple Silicon, macOS Intel, Windows x64 und Linux x64. In unterstützten Umgebungen lässt sich Pi Coding Agent aus der App installieren oder reparieren. Für die Ausführung aus dem Quellcode sind Node.js ≥ 22.22.2 und pnpm 9.12.1 erforderlich.

## Dokumentation

- [Screenshot-Verzeichnis](docs/README.md)
- [Änderungsprotokoll](CHANGELOG.md)

## Danksagung und Autor

Pi-Harness baut auf den offiziellen Projekten [Pi Coding Agent und Pi Agent Harness](https://github.com/earendil-works/pi) auf.

Erstellt und gepflegt von [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

## Lizenz

Pi-Harness steht unter der [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
