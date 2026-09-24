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

<p align="center">
  <strong>Le Superset Harness pour Pi Coding Agent</strong><br />
  Native Pi, suralimenté.
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0"><img alt="release v1.7.0" src="https://img.shields.io/badge/release-v1.7.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## Pourquoi Pi-Harness ?

### Plus qu’une interface de chat pour Pi

Un client de bureau classique ouvre Pi et lance un chat. Pi-Harness regroupe environnement, fournisseurs, modèles, Skills, paquets, projets, fichiers et Git dans un seul espace de travail de bureau.

```text
Client de bureau classique            Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness n’est pas une enveloppe web. Il n’intègre ni pi-web, ni serveur Next.js, ni iframe, et n’ajoute pas un second Agent Runtime. Pi Coding Agent reste le seul Agent Runtime ; les sessions sont compatibles avec les JSONL de Pi CLI dans ~/.pi/agent/sessions/.

**Configurer Pi. Exécuter Pi. Étendre Pi.**

## Pi Superset Contract

Pi-Harness est un operational superset de Pi Coding Agent. Il préserve l’Agent Runtime natif et la compatibilité de Pi, tout en ajoutant observabilité, gouvernance, orchestration, récupération, évaluation et espace de travail d’ingénierie visuel.

- Pi-Harness ne réduit pas intentionnellement les capacités de Native Pi et conserve les formats natifs lorsque cela est techniquement possible.
- Native Pi reste toujours le Runtime d’exécution. Pi-Harness ne réimplémente ni Agent Loop, ni Context, ni Compaction, ni Tools, Skills ou Extensions.
- Les Session et configurations Pi restent utilisables seules ; l’état propre au Harness est stocké séparément.
- Les améliorations sont additives par défaut et les nouvelles capacités Pi passent d’abord par la couche de compatibilité.
- La compatibilité repose sur capability detection, graceful degradation et best-effort forward compatibility.

## Matrice Pi / Pi-Harness

| Capacité                             | Native Pi | Pi-Harness             |
| ------------------------------------ | --------- | ---------------------- |
| Agent Runtime / Loop                 | Oui       | Native Pi              |
| Sessions / Context / Compaction      | Oui       | Oui + gestion visuelle |
| Steering / Follow-up / Thinking      | Oui       | Oui + contrôle visuel  |
| Models / Tools / Skills / Extensions | Oui       | Oui + Manager / Policy |
| Runs / Trace / Replay / Compare      | —         | Oui                    |
| Policy / Budget / Evaluation         | —         | Oui                    |
| Checkpoint / Recovery / Diagnostics  | —         | Oui                    |
| Regression / Artifacts               | —         | Oui                    |
| Multi-Agent / Task DAG / Handoff     | —         | Oui                    |
| Review Gates / Worktree isolation    | —         | Oui                    |

## Télécharger

Téléchargez Pi-Harness v1.7.0 depuis [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0).

| Plateforme          | Programme d’installation                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.7.0-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.7.0.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.7.0.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-Setup-1.7.0.exe) |
| Linux x64           | [Pi-Harness-1.7.0.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.AppImage)   |

> **Note de mise à niveau Windows :** au premier lancement de l’application v1.7.0 installée, les anciennes données de Pi-Harness — réglages, coffre local d’identifiants, sauvegardes de l’application et caches — sont réinitialisées une seule fois. Reconfigurez ensuite les préférences et identifiants. Le répertoire de données séparé de Pi Agent et les fichiers des projets ne sont pas réinitialisés.
>
> Les builds communautaires macOS peuvent ne pas être signés. Si macOS bloque le premier lancement, utilisez **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Consultez les [notes de la v1.7.0](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0).

Avec l’application empaquetée, inutile de cloner le dépôt ou d’installer pnpm. Pi-Harness peut détecter, installer et réparer Node.js, npm, PATH et Pi Coding Agent dans les environnements pris en charge.

## Ce que vous pouvez faire

- **Espace de travail :** lancer ou reprendre des sessions Pi dans un vrai projet, avec réponses en streaming, Thinking, Tool Call, fichiers et Git.
- **Fournisseurs et modèles :** configurer des fournisseurs et modèles compatibles Pi, tester la connexion et choisir le modèle actif.
- **Skills, paquets et MCP :** gérer les Skills locaux et les paquets Pi ; connecter MCP via les paquets pris en charge.
- **Environnement :** détecter Node.js, npm, PATH et Pi, puis résoudre les problèmes d’installation courants depuis l’application.
- **Fichiers et Git :** parcourir et importer des fichiers, les modifier avec protection contre les conflits, consulter Git Diff et travailler avec les Worktrees.
- **Diagnostic :** vérifier l’état de l’application et de l’environnement.
- **Démarrage et apparence :** au lancement, Pi-Harness vérifie le registre npm, Node.js, npm, Pi Agent et la configuration tout en affichant une animation quantique monochrome pendant au moins cinq secondes. Les réglages généraux permettent de choisir les icônes Classique, Ming ou Quantique, ainsi que les halos de fenêtre et d’écran et l’effet de flamme du champ de saisie. La version sans mascotte conserve l’animation et ces réglages sans charger les thèmes de mascotte optionnels.

## Fonctionnement

1. Lancez Pi-Harness et vérifiez l’environnement.
2. Configurez un fournisseur.
3. Choisissez un modèle et testez la connexion.
4. Ouvrez un projet.
5. Lancez ou reprenez une session Pi.

```text
Installer → Configurer le fournisseur → Choisir le modèle → Ouvrir le projet → Exécuter Pi
```

## Captures d’écran

Les écrans principaux sont présentés avec le thème par défaut et le thème d’inspiration Ming. L’espace de travail Ming comprend une variante neige et une variante nuit.

### Thème par défaut

|                               Espace de travail                               |                               Git                                |
| :---------------------------------------------------------------------------: | :--------------------------------------------------------------: |
|     ![Espace de travail avec le thème par défaut](docs/默认主题/Work.jpg)     |      ![Git avec le thème par défaut](docs/默认主题/Git.jpg)      |
|                               **Fournisseurs**                                |                           **Modèles**                            |
|       ![Fournisseurs avec le thème par défaut](docs/默认主题/APIs.jpg)        |   ![Modèles avec le thème par défaut](docs/默认主题/Model.jpg)   |
|                         **Centre de fonctionnalités**                         |                         **Préférences**                          |
| ![Centre de fonctionnalités avec le thème par défaut](docs/默认主题/Caps.jpg) | ![Préférences avec le thème par défaut](docs/默认主题/Prefs.jpg) |

### Thème d’inspiration Ming

|                      Espace de travail (neige)                      |                      Espace de travail (nuit)                       |
| :-----------------------------------------------------------------: | :-----------------------------------------------------------------: |
| ![Espace de travail neige avec le thème Ming](docs/古风/Work-1.jpg) | ![Espace de travail nuit avec le thème Ming](docs/古风/Work-2.jpg)  |
|                                 Git                                 |                          **Fournisseurs**                           |
|            ![Git avec le thème Ming](docs/古风/Git.jpg)             |       ![Fournisseurs avec le thème Ming](docs/古风/APIs.jpg)        |
|                             **Modèles**                             |                    **Centre de fonctionnalités**                    |
|         ![Modèles avec le thème Ming](docs/古风/Model.jpg)          | ![Centre de fonctionnalités avec le thème Ming](docs/古风/Caps.jpg) |
|                           **Préférences**                           |                                                                     |
|       ![Préférences avec le thème Ming](docs/古风/Prefs.jpg)        |                                                                     |

## Limites de l’éditeur

Pi-Harness modifie les fichiers texte lisibles avec coloration syntaxique, numéros de ligne, annuler/rétablir, recherche, sauvegarde explicite et protection contre les changements externes. Les fichiers volumineux, binaires, multimédias et documents restent en lecture seule.

Ce n’est pas un IDE : pas de LSP/IntelliSense, refactorisation sémantique, débogueur, exécuteur de tâches, terminal intégré ou compatibilité avec les extensions IDE.

## Architecture

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       Gérer Pi               Utiliser Pi        Étendre Pi

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

Pi Coding Agent reste le seul Agent Runtime.

## Prérequis

Application empaquetée :

- macOS Apple Silicon, macOS Intel ou Windows x64
- Pi Coding Agent, installable ou réparable depuis Pi-Harness

Développement depuis les sources :

- Node.js ≥ 22.19.0
- pnpm 9.12.1

## Développement

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Contrôles courants : pnpm typecheck, pnpm lint, pnpm test, pnpm compile et pnpm test:e2e:only. Ne stockez jamais de secrets dans des variables VITE_* : elles sont intégrées au bundle Renderer.

## Documentation

- [Historique des modifications](CHANGELOG.md)

## Licence

Pi-Harness est distribué sous [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## Auteur

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
