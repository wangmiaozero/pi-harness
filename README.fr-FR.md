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
  <strong>Tout Native Pi, avec davantage d’observation, de contrôle, de récupération, d’évaluation et d’orchestration Multi-Agent.</strong>
</p>

<p align="center">Native Pi, suralimenté.</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>Créer un thème personnalisé</strong></a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.8.0"><img alt="release v1.8.0" src="https://img.shields.io/badge/release-v1.8.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## Pourquoi Pi-Harness ?

Pi-Harness est l’Operational Superset de Pi Coding Agent. Native Pi reste l’unique Agent Runtime ; ses Sessions, Tools, Models, Skills, Extensions, Context et Compaction compatibles sont complétés par l’observation, le contrôle, la récupération, l’évaluation et l’orchestration Multi-Agent.

> **Pi exécute l’Agent ; Pi-Harness en fait un système d’ingénierie observable, contrôlable, récupérable et orchestrable.**

Pi-Harness ne remplace ni ne réimplémente l’Agent Runtime de Pi.

## Ce que signifie « Superset »

Native Pi reste toujours dans le chemin d’exécution réel ; Pi-Harness ajoute autour de lui le Harness Control Plane et le Visual Engineering Workspace.

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

Téléchargez Pi-Harness v1.8.0 depuis [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.8.0).

| Plateforme          | Programme d’installation                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.8.0-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-1.8.0-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.8.0.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-1.8.0.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.8.0.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-Setup-1.8.0.exe) |
| Linux x64           | [Pi-Harness-1.8.0.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-1.8.0.AppImage)   |

> Les builds communautaires macOS peuvent ne pas être signés. Si macOS bloque le premier lancement, utilisez **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Consultez les [notes de la v1.8.0](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.8.0).

Avec l’application empaquetée, inutile de cloner le dépôt ou d’installer pnpm. Pi-Harness peut détecter, installer et réparer Node.js, npm, PATH et Pi Coding Agent dans les environnements pris en charge.

## Ce que vous pouvez faire

- **Espace de travail :** lancer ou reprendre des sessions Pi dans un vrai projet, avec réponses en streaming, Thinking, Tool Call, fichiers et Git.
- **Fournisseurs et modèles :** configurer des fournisseurs et modèles compatibles Pi, tester la connexion et choisir le modèle actif.
- **Skills, paquets et MCP :** gérer les Skills locaux et les paquets Pi ; connecter MCP via les paquets pris en charge.
- **Environnement :** détecter Node.js, npm, PATH et Pi, puis résoudre les problèmes d’installation courants depuis l’application.
- **Fichiers et Git :** parcourir et importer des fichiers, les modifier avec protection contre les conflits, consulter Git Diff et travailler avec les Worktrees.
- **Diagnostic :** vérifier l’état de l’application et de l’environnement.
- **Démarrage et apparence :** au lancement, Pi-Harness vérifie le registre npm, Node.js, npm, Pi Agent et la configuration tout en affichant une animation quantique monochrome pendant au moins cinq secondes. Les réglages généraux permettent de choisir les icônes Classique, Ming ou Quantique, ainsi que les halos de fenêtre et d’écran et l’effet de flamme du champ de saisie. La version sans mascotte conserve l’animation et ces réglages sans charger les thèmes de mascotte optionnels.

## Créez votre thème personnalisé

Utilisez le [modèle de thème personnalisé Pi-Harness](https://github.com/wangmiaozero/pi-harness-skin-starter) pour créer l’apparence de votre choix.

1. Utilisez le dépôt comme modèle, ou téléchargez-le et décompressez-le.
2. Ouvrez-le avec Codex ou Pi et décrivez le style souhaité dans le prompt prêt à copier ou dans `SKIN_BRIEF.md`.
3. Importez le projet terminé depuis **Paramètres → Thème → Importer un thème**.

Le modèle multilingue contient le Schema du manifeste, des jetons de couleur modifiables, les exigences relatives aux ressources et les instructions de validation pour l’aperçu, le fond et le portrait facultatif. Conservez votre thème dans un dépôt distinct afin de le versionner, le mettre à jour et le partager indépendamment de Pi-Harness.

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

Le thème par défaut présente les fonctions principales. La galerie v1.8.0 est reclassée en thèmes d’espace de travail et écrans fonctionnels.

### Thème par défaut

|                                Espace de travail                                 |                            Git                             |
| :------------------------------------------------------------------------------: | :--------------------------------------------------------: |
|      ![Espace de travail avec le thème classique](docs/经典主题/工作区.jpg)      |   ![Git avec le thème classique](docs/经典主题/Git.jpg)    |
|                          **Centre de fonctionnalités**                           |                        **Modèles**                         |
| ![Centre de fonctionnalités avec le thème classique](docs/经典主题/能力中心.jpg) | ![Modèles avec le thème classique](docs/经典主题/模型.jpg) |
|                                 **Préférences**                                  |                                                            |
|          ![Préférences avec le thème classique](docs/经典主题/设置.jpg)          |                                                            |

### Galerie d’apparence v1.8.0

#### Thèmes d’espace de travail

|                          Ming · dignitaire enneigé                           |                        Ming · musicienne sous la neige                        |
| :--------------------------------------------------------------------------: | :---------------------------------------------------------------------------: |
|   ![Espace Ming avec dignitaire enneigé](docs/主题展示/大明/雪境朝臣.jpg)    | ![Espace Ming avec musicienne sous la neige](docs/主题展示/大明/雪夜笛姬.jpg) |
|                     **Ming · lettrée au clair de lune**                      |                             **Starship Cockpit**                              |
|       ![Espace Ming au clair de lune](docs/主题展示/大明/月城书姬.jpg)       |          ![Espace Starship Cockpit](docs/主题展示/星舰/霜星领航.jpg)          |
|                         **macOS 27 · Liquid Ether**                          |                           **Apparence déclarative**                           |
| ![Espace macOS 27 Liquid Ether](docs/主题展示/macOS%2027/Liquid%20Ether.jpg) | ![Apparence personnalisée déclarative](docs/主题展示/自定义皮肤/夏日海岸.jpg) |

#### Écrans fonctionnels

|                        Réglages généraux                        |                            Galerie de thèmes                             |
| :-------------------------------------------------------------: | :----------------------------------------------------------------------: |
| ![Réglages généraux de l’apparence](docs/功能界面/通用设置.jpg) |     ![Thèmes intégrés et personnalisés](docs/功能界面/主题图库.jpg)      |
|                  **Centre de fonctionnalités**                  |                       **Fournisseurs et modèles**                        |
|    ![Marché des fonctionnalités](docs/功能界面/能力中心.jpg)    | ![Gestion des fournisseurs et modèles](docs/功能界面/Provider与模型.jpg) |

<p align="center">
  <strong>Git</strong><br>
  <img src="docs/功能界面/Git.jpg" alt="Espace Git" width="49%">
</p>

## Limites de l’éditeur

Pi-Harness modifie les fichiers texte lisibles avec coloration syntaxique, numéros de ligne, annuler/rétablir, recherche, sauvegarde explicite et protection contre les changements externes. Les fichiers volumineux, binaires, multimédias et documents restent en lecture seule.

Ce n’est pas un IDE : pas de LSP/IntelliSense, refactorisation sémantique, débogueur, exécuteur de tâches, terminal intégré ou compatibilité avec les extensions IDE.

## Architecture

Native Pi est contenu dans l’architecture d’exécution de Pi-Harness, sans être remplacé.

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

La frontière desktop reste `Vue Renderer → typed preload API → validated IPC → Main services → Pi compatibility layer → Native Pi SDK`. Les Session restent compatibles avec le JSONL de Pi CLI sous <code>~/.pi/agent/sessions/</code>.

## Harness Control Plane

Runs, Trace, Replay, Run Tree, Run Compare, Policy, Budget, Checkpoints, Recovery, Permissions, Evaluation, Diagnostics, Regression et Artifacts sont disponibles. Les données proviennent de vrais Pi Event, Session et résultats de commande.

## Orchestration Multi-Agent

Agents, Teams, Tasks, Dependencies, Handoffs, Review Gates, Budget, l’isolation Worktree ainsi que pause, resume, abort, retry, skip et reassign sont pris en charge. Chaque Agent s’exécute via une vraie Pi Session.

## Pi Superset Contract

Pi-Harness est un operational superset de Pi Coding Agent. Il préserve l’Agent Runtime natif et la compatibilité de Pi, tout en ajoutant observabilité, gouvernance, orchestration, récupération, évaluation et espace de travail d’ingénierie visuel.

- Pi-Harness ne réduit pas intentionnellement les capacités de Native Pi et conserve les formats natifs lorsque cela est techniquement possible.
- Native Pi reste toujours le Runtime d’exécution. Pi-Harness ne réimplémente ni Agent Loop, ni Context, ni Compaction, ni Tools, Skills ou Extensions.
- Les Session et configurations Pi restent utilisables seules ; l’état propre au Harness est stocké séparément.
- Les améliorations sont additives par défaut et les nouvelles capacités Pi passent d’abord par la couche de compatibilité.
- La compatibilité repose sur capability detection, graceful degradation et best-effort forward compatibility.

## Roadmap

- Visualisation de Session Tree et inspecteurs Context / Queue plus approfondis
- Permissions Workspace avancées et intégrations de vérification
- Harness Profiles et Run Analysis plus intelligent

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
