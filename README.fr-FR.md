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

## Native Pi et Pi-Harness

Pi-Harness est un surensemble opérationnel de Pi Coding Agent : aux fonctions de Native Pi s’ajoutent observation, contrôle, récupération, orchestration et espace de travail visuel.

| Fonction                 | Native Pi | Pi-Harness                    |
| ------------------------ | --------- | ----------------------------- |
| Agent Runtime            | Oui       | Native Pi                     |
| Agent Loop               | Oui       | Native Pi                     |
| Sessions                 | Oui       | Oui + gestion visuelle        |
| Context                  | Oui       | Oui + inspection              |
| Compaction               | Oui       | Oui + contrôle visuel         |
| Steering                 | Oui       | Oui                           |
| Follow-up                | Oui       | Oui                           |
| Models                   | Oui       | Oui + gestion                 |
| Thinking                 | Oui       | Oui + contrôle visuel         |
| Tools                    | Oui       | Oui + sélection et politiques |
| Skills                   | Oui       | Oui + gestion                 |
| Extensions               | Oui       | Oui + gestion                 |
| Packages                 | Oui       | Oui + gestion                 |
| MCP / Codemode           | Oui       | Oui + sélection et politiques |
| Runs                     | —         | Oui                           |
| Trace                    | —         | Oui                           |
| Replay                   | —         | Oui                           |
| Run Compare              | —         | Oui                           |
| Evaluation               | —         | Oui                           |
| Policy                   | —         | Oui                           |
| Budget                   | —         | Oui                           |
| Checkpoints              | —         | Oui                           |
| Recovery                 | —         | Oui                           |
| Diagnostics              | —         | Oui                           |
| Regression               | —         | Oui                           |
| Artifacts                | —         | Oui                           |
| Multi-Agent              | —         | Oui                           |
| Task DAG                 | —         | Oui                           |
| Handoff                  | —         | Oui                           |
| Review Gates             | —         | Oui                           |
| Worktree isolation       | —         | Oui                           |
| Project architecture map | —         | Oui                           |

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

#### Espace de travail

[![Espace de travail](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)

<details>
<summary>Git · Fournisseurs et modèles · Fonctionnalités · Harness · Architecture du projet</summary>

#### Git

[![Git](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)

#### Fournisseurs et modèles

[![Fournisseurs et modèles](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)

#### Fonctionnalités

[![Fonctionnalités](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)

#### Harness

[![Harness](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)

#### Architecture du projet

[![Architecture du projet](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)

</details>

### Interfaces Ming

<details>
<summary>Réglages généraux · Thèmes et habillages</summary>

#### Réglages généraux

[![Réglages généraux](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)

#### Thèmes et habillages

[![Thèmes et habillages](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)

</details>

### Galerie de thèmes

<details>
<summary>Ming · Dignitaire enneigé · Ming · Musicienne sous la neige · Ming · Lettrée au clair de lune · Starship Cockpit · macOS 27 · Liquid Ether</summary>

#### Ming · Dignitaire enneigé

[![Ming · Dignitaire enneigé](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)

#### Ming · Musicienne sous la neige

[![Ming · Musicienne sous la neige](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)

#### Ming · Lettrée au clair de lune

[![Ming · Lettrée au clair de lune](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)

#### Starship Cockpit

[![Starship Cockpit](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)

#### macOS 27 · Liquid Ether

[![macOS 27 · Liquid Ether](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)

</details>

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

### Contributeurs aux PR

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/HenryArch"><img src="https://avatars.githubusercontent.com/u/244436357?v=4" width="64" height="64" alt="HenryArch" /><br /><b>HenryArch</b></a><br />
      <a href="https://github.com/wangmiaozero/pi-harness/pull/8">PR #8</a>
    </td>
  </tr>
</table>

Les PR pour améliorer Pi-Harness sont les bienvenues. Merci à toutes les personnes qui contribuent à faire progresser le projet !

## Licence

Pi-Harness est distribué sous [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
