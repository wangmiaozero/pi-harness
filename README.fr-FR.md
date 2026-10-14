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

<h3 align="center">L’Operational Superset de Pi Coding Agent</h3>

<p align="center">
  <strong>Native Pi avec un espace de travail visuel, le contrôle des exécutions, la récupération et des équipes d’agents.</strong>
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="#download"><strong>Télécharger</strong></a> ·
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>Créer un habillage</strong></a> ·
  <a href="#screenshots">Captures d’écran</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="Versions publiées" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

## Pourquoi Pi-Harness ?

Pi-Harness propose Pi Coding Agent dans un espace de travail de bureau pour macOS, Windows et Linux. Gérez conversations, projets, fichiers, Git, modèles et Skills au même endroit, avec des outils pour examiner les exécutions, contrôler les budgets, reprendre le travail et coordonner des équipes d’agents.

Native Pi exécute les agents. Vos sessions, configurations, outils, Skills et extensions restent compatibles avec Pi, que vous pouvez aussi utiliser en dehors de l’application.

## Fonctionnalités

### Espace de travail, fichiers et Git

Commencez une conversation indépendante ou ouvrez un projet pour reprendre une session Pi. Consultez les réponses en streaming, le raisonnement, les appels d’outils, les images et les fichiers modifiés ; choisissez modèle, niveau de raisonnement et outils, ou compactez la conversation. Les outils de l’espace de travail donnent accès à Harness et aux agents en conservant la conversation et le brouillon.

Parcourez et recherchez les fichiers, prévisualisez médias et documents, et modifiez le texte avec coloration syntaxique, numéros de ligne, recherche, annuler/rétablir, enregistrement explicite et protection contre les conflits de modifications externes. Git propose différences, historique, graphiques d’activité, commits, messages de commit IA facultatifs et worktrees.

### Fournisseurs et modèles

Configurez des fournisseurs compatibles Pi à partir de préréglages ou d’adresses personnalisées. Gérez les identifiants, récupérez les modèles lorsque le service le permet, testez la connexion et choisissez le modèle de conversation. Les modèles d’image compatibles permettent de générer ou modifier des images, puis de télécharger les résultats.

### Skills, extensions, paquets et MCP

Parcourez et modifiez les Skills intégrés et locaux, et gérez les paquets et extensions Pi dans le centre de fonctionnalités. Saisissez `@` pour rechercher et invoquer un Skill installé. Connectez MCP via les paquets compatibles. Les compléments [Superpowers](https://github.com/obra/superpowers) et [Odai](https://github.com/orziz/odai) peuvent être installés, mis à jour ou supprimés à votre demande.

### Harness : observer, contrôler et récupérer

Examinez Runs, Trace, Replay, les chronologies et l’activité des outils. Comparez les exécutions, suivez les branches et les nouvelles tentatives dans Run Tree, et consultez tokens, coût, durée, artefacts et statistiques du projet.

Définissez les politiques des outils et les budgets d’exécution, créez des points de contrôle, puis reprenez, créez une branche ou relancez le travail. Évaluation, diagnostic et références de régression aident à vérifier les résultats et à expliquer les échecs à partir des données enregistrées.

### Équipes d’agents et orchestration des tâches

Coordonnez les agents Pi avec des équipes et modèles réutilisables. Affectez dépendances, priorités et responsables, lancez les tâches manuellement, en séquence ou en parallèle, transmettez résultats et artefacts et utilisez des étapes de revue. Les worktrees séparent les modifications ; budgets, alertes de conflit, pause, reprise, arrêt, nouvelle tentative, saut et réaffectation permettent de gérer le travail.

### Historique local des conversations

Consultez ensemble les historiques de Claude Code, Codex (bureau et archives compris), Cursor, Cursor Agent, Gemini CLI, OpenCode et Pi. Recherchez, filtrez par source, projet ou dates, et ajoutez vos dossiers d’historique.

La conversation originale reste en lecture seule. Vérifiez l’aperçu de transmission et modifiez la prochaine instruction avant de continuer dans un nouveau chat Pi du même projet. Consultation, aperçus locaux et nouvelles tentatives de scan ne consomment aucun token de modèle. Les synthèses IA facultatives utilisent votre modèle configuré uniquement à votre demande.

### Architecture du projet

Ouvrez Architecture dans l’espace de travail pour explorer modules, dépendances, points d’entrée et références au code. Filtrez par paquet, ciblez un module, changez de page, zoomez ou passez en plein écran. Enregistrez les analyses, repérez les changements des sources et exportez JSON, HTML hors ligne ou la vue actuelle en PNG.

L’analyse locale ne consomme aucun token de modèle ; les descriptions IA sont facultatives. Les imports JavaScript, TypeScript et Vue sont analysés localement ; les autres langages compatibles disposent d’un index par fichier. L’analyse indique sa couverture et ses limites.

### Thèmes et habillages personnalisés

Choisissez les palettes classiques, Ming, Starship Cockpit, les fonds macOS 27 ou un habillage importé. Les nouvelles installations démarrent en mode sombre. Personnalisez les noms du chat, l’icône, les images de fond locales, les halos de fenêtre et d’écran et l’effet de flamme du champ de saisie. Une animation accompagne la vérification de l’environnement au démarrage ; les versions sans mascotte conservent les réglages généraux d’apparence.

### Environnement et réglages

Vérifiez Node.js, npm, PATH, Pi Coding Agent et la configuration active. Installez, mettez à jour ou réparez Pi dans les environnements compatibles ; consultez le diagnostic, gérez les sauvegardes de configuration et vérifiez les mises à jour de l’application. L’interface est disponible en huit langues.

## Créer votre habillage

Utilisez le [modèle d’habillage Pi-Harness](https://github.com/wangmiaozero/pi-harness-skin-starter) pour créer le style souhaité.

1. Utilisez le dépôt comme modèle ou téléchargez-le.
2. Ouvrez-le avec votre agent de programmation et décrivez le style dans le prompt fourni.
3. Importez le projet terminé depuis **Paramètres → Thème → Importer un thème**.

Le modèle multilingue propose des indications pour les couleurs, aperçus, fonds et portraits facultatifs. Conservez l’habillage dans son propre dépôt pour le mettre à jour et le partager indépendamment.

<a id="screenshots"></a>

## Captures d’écran

Les interfaces sont classées par thème. Consultez l’[index complet des captures](docs/README.md) pour les autres vues.

### Thème classique

|                            Espace de travail                            |                               Git                                |
| :---------------------------------------------------------------------: | :--------------------------------------------------------------: |
|         ![Espace de travail](docs/功能界面/经典主题/工作区.png)         |              ![Git](docs/功能界面/经典主题/Git.png)              |
|                       **Fournisseurs et modèles**                       |                       **Fonctionnalités**                        |
| ![Fournisseurs et modèles](docs/功能界面/经典主题/Provider与模型-1.png) |    ![Fonctionnalités](docs/功能界面/经典主题/能力中心-1.png)     |
|                               **Harness**                               |                    **Architecture du projet**                    |
|          ![Harness](docs/功能界面/经典主题/工具Harness-1.png)           | ![Architecture du projet](docs/功能界面/经典主题/项目架构-1.png) |

### Interfaces Ming

|                   Réglages généraux                   |                    Thèmes et habillages                    |
| :---------------------------------------------------: | :--------------------------------------------------------: |
| ![Réglages généraux](docs/功能界面/大明/通用设置.png) | ![Thèmes et habillages](docs/功能界面/大明/主题皮肤库.png) |

### Galerie de thèmes

|                      Ming · Dignitaire enneigé                      |                   Ming · Musicienne sous la neige                   |
| :-----------------------------------------------------------------: | :-----------------------------------------------------------------: |
|    ![Ming · Dignitaire enneigé](docs/主题展示/大明/雪境朝臣.png)    | ![Ming · Musicienne sous la neige](docs/主题展示/大明/雪夜笛姬.png) |
|                 **Ming · Lettrée au clair de lune**                 |                        **Starship Cockpit**                         |
| ![Ming · Lettrée au clair de lune](docs/主题展示/大明/月城书姬.png) |        ![Starship Cockpit](docs/主题展示/星舰/霜星领航.png)         |

<p align="center">
  <strong>macOS 27 · Liquid Ether</strong><br>
  <img src="docs/主题展示/macOS%2027/Liquid%20Ether.png" alt="macOS 27 · Liquid Ether" width="80%" />
</p>

<a id="download"></a>

## Télécharger

Téléchargez un installateur publié sur [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) en choisissant le fichier adapté à votre plateforme.

| Plateforme          | Installateur                  |
| ------------------- | ----------------------------- |
| macOS Apple Silicon | `.dmg` · `arm64`              |
| macOS Intel         | `.dmg` · `x64`                |
| Windows x64         | `.exe` · Installateur Windows |
| Linux x64           | `.AppImage`                   |

Avec l’application empaquetée, inutile de cloner le dépôt ou d’installer pnpm. Pi-Harness vous aide à installer Pi et son environnement lorsque cette fonction est disponible.

> Les builds communautaires macOS peuvent ne pas être signés. Si le premier lancement est bloqué, utilisez **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**.

## Premiers pas

1. Lancez Pi-Harness et vérifiez l’environnement dans la vue d’ensemble.
2. Configurez un fournisseur, testez la connexion et choisissez un modèle.
3. Commencez une conversation indépendante ou ouvrez un projet.
4. Lancez ou reprenez une session Pi pour travailler avec conversations, fichiers et Git.
5. Ouvrez les outils de l’espace de travail pour les contrôles Harness ou les équipes d’agents.

## Prérequis

L’application prend en charge macOS Apple Silicon, macOS Intel, Windows x64 et Linux x64. Pi Coding Agent peut être installé ou réparé depuis l’application dans les environnements compatibles. L’exécution depuis les sources nécessite Node.js ≥ 22.22.2 et pnpm 9.12.1.

## Documentation

- [Index des captures](docs/README.md)
- [Historique des modifications](CHANGELOG.md)

## Remerciements et auteur

Pi-Harness est construit autour des projets officiels [Pi Coding Agent et Pi Agent Harness](https://github.com/earendil-works/pi).

Créé et maintenu par [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

## Licence

Pi-Harness est distribué sous [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
