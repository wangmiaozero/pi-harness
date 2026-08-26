# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>L’espace de travail tout-en-un pour <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Configurer Pi · Exécuter des agents · Gérer modèles, Skills, paquets et projets
</p>

<p align="center">
  Tout le nécessaire pour configurer, exécuter et étendre Pi Coding Agent dans une seule application de bureau native.
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
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1"><img alt="release v1.1.1" src="https://img.shields.io/badge/release-v1.1.1-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

![Aperçu Pi-Harness avec l’environnement, le modèle actif et les actions rapides](docs/概览.jpg)

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

## Télécharger

Téléchargez Pi-Harness v1.1.1 depuis [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1).

| Plateforme          | Programme d’installation                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.1.1-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.1.1.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1.dmg)             |
| Windows x64         | [Pi-Harness.Setup.1.1.1.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness.Setup.1.1.1.exe) |

> Les builds communautaires macOS peuvent ne pas être signés. Si macOS bloque le premier lancement, utilisez **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Consultez les [notes de la v1.1.1](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1).

Avec l’application empaquetée, inutile de cloner le dépôt ou d’installer pnpm. Pi-Harness peut détecter, installer et réparer Node.js, npm, PATH et Pi Coding Agent dans les environnements pris en charge.

## Ce que vous pouvez faire

- **Espace de travail :** lancer ou reprendre des sessions Pi dans un vrai projet, avec réponses en streaming, Thinking, Tool Call, fichiers et Git.
- **Fournisseurs et modèles :** configurer des fournisseurs et modèles compatibles Pi, tester la connexion et choisir le modèle actif.
- **Skills, paquets et MCP :** gérer les Skills locaux et les paquets Pi ; connecter MCP via les paquets pris en charge.
- **Environnement :** détecter Node.js, npm, PATH et Pi, puis résoudre les problèmes d’installation courants depuis l’application.
- **Fichiers et Git :** parcourir et importer des fichiers, les modifier avec protection contre les conflits, consulter Git Diff et travailler avec les Worktrees.
- **Diagnostic :** vérifier l’état de l’application et de l’environnement.

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

### 1. Vérifier que tout est prêt

![Aperçu](docs/概览.jpg)

### 2. Exécuter Pi dans un vrai projet

|       Sessions du projet       |  Fichiers et édition légère   |
| :----------------------------: | :---------------------------: |
| ![Sessions](docs/工作区-1.jpg) | ![Éditeur](docs/工作区-2.jpg) |

### 3. Configurer fournisseurs et modèles

|                 Fournisseurs                 |         Configuration du fournisseur         |
| :------------------------------------------: | :------------------------------------------: |
| ![Liste des fournisseurs](docs/提供商-1.jpg) | ![Détails du fournisseur](docs/提供商-2.jpg) |
|                 **Modèles**                  |         **Configuration du modèle**          |
|    ![Liste des modèles](docs/模型-1.jpg)     |    ![Détails du modèle](docs/模型-2.jpg)     |

### 4. Étendre Pi

|           Skills installés           |        Collections et paquets         |
| :----------------------------------: | :-----------------------------------: |
| ![Skills installés](docs/技能-1.jpg) | ![Marché des Skills](docs/技能-2.jpg) |

### 5. Personnaliser l’espace de travail

![Réglages d’apparence et de mascotte](docs/设置.jpg)

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

- Node.js ≥ 22
- pnpm 9.12.1

## Développement

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Contrôles courants : pnpm typecheck, pnpm lint, pnpm test, pnpm compile et pnpm test:e2e:only. Ne stockez jamais de secrets dans des variables VITE_* : elles sont intégrées au bundle Renderer.

## Documentation

- [Historique des modifications](CHANGELOG.md)
- [Contribuer](CONTRIBUTING.md)

## Licence

Pi-Harness est distribué sous [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## Auteur

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
