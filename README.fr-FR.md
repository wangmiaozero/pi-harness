# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>Console de contrôle locale et espace de travail natif pour <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Configurer Pi · Exécuter des sessions projet · Consulter et modifier les fichiers locaux
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

Pi-Harness gère les fournisseurs, modèles, identifiants, compétences, fichiers de configuration, sauvegardes et diagnostics de Pi, puis exécute des sessions Pi Agent liées à un projet dans un espace de travail natif. Les sessions restent compatibles avec les JSONL de Pi CLI sous `~/.pi/agent/sessions/` ; aucun pi-web, serveur Next.js ou iframe n’est intégré.

Les secrets n’apparaissent jamais en clair dans le Renderer. macOS les stocke dans le Trousseau ; Windows et Linux utilisent Electron `safeStorage`. Les champs Pi inconnus sont conservés.

## Points clés de la v1.0.9

- Les réponses Assistant utilisent un Markdown sécurisé en streaming avec une liste blanche explicite de balises et protocoles.
- Les Tool Result sont repliés par défaut et s’ouvrent dans une zone défilable à hauteur limitée.
- La mascotte globale est désactivée par défaut ; six styles sont disponibles, dont les nouveaux styles bureau et maid.

## Captures d’écran

|                    Aperçu                    |             Réglages — Mascotte              |
| :------------------------------------------: | :------------------------------------------: |
|           ![Aperçu](docs/概览.jpg)           |     ![Réglages mascotte](docs/设置.jpg)      |
|       **Espace de travail — Sessions**       |       **Espace de travail — Éditeur**        |
|        ![Sessions](docs/工作区-1.jpg)        |        ![Éditeur](docs/工作区-2.jpg)         |
|           **Fournisseurs — Liste**           |          **Fournisseurs — Détails**          |
| ![Liste des fournisseurs](docs/提供商-1.jpg) | ![Détails du fournisseur](docs/提供商-2.jpg) |
|             **Modèles — Liste**              |            **Modèles — Détails**             |
|    ![Liste des modèles](docs/模型-1.jpg)     |    ![Détails du modèle](docs/模型-2.jpg)     |
|         **Compétences — Installées**         |           **Compétences — Marché**           |
|  ![Compétences installées](docs/技能-1.jpg)  |  ![Marché des compétences](docs/技能-2.jpg)  |

## Fonctionnalités

| Module                | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Aperçu**            | Modèle actif, Pi CLI / répertoire de configuration, état de l’environnement et actions courantes                  |
| **Espace de travail** | Projets et sessions Pi natifs, chat en streaming, Thinking / Tool Call, édition légère, Git Diff et Worktree      |
| **Fournisseurs**      | Préréglages Pi compatibles et recherchables ; Provider ≠ Protocol ≠ Model ; Trousseau / `safeStorage`             |
| **Modèles**           | ID prédéfinis ou personnalisés, métadonnées de capacité, sélection active, vérification après écriture            |
| **Compétences**       | Créer / importer / modifier / valider `SKILL.md` ; contrainte de racine de chemin                                 |
| **Configuration**     | Éditeur CodeMirror pour `models.json` / `settings.json` ; formatage et affichage dans le gestionnaire de fichiers |
| **Diagnostics**       | Rapport d’environnement ; copie assainie (`apiKey` / `token` / `secret`, etc.)                                    |
| **Réglages**          | Interface 简体中文 / English, thème système/sombre/clair, densité, outils, restauration, sauvegardes, mascotte    |

Fiabilité :

- Sauvegarde automatique avant écriture ; écritures atomiques
- Détection des changements externes (mtime) : Reload / Compare / Overwrite
- Les builds packagés vérifient et téléchargent les mises à jour en arrière-plan, puis les installent à la fermeture ou via **Installer et redémarrer**
- Application de bureau : fenêtres de navigateur externes et redirections URL hors app bloquées

## Limites de l’éditeur léger

L’espace de travail modifie les fichiers texte lisibles avec coloration syntaxique paresseuse, numéros de ligne, annuler/rétablir, recherche, sauvegarde explicite, indicateurs de modifications et protection contre les changements externes. Les extensions texte inconnues sont ouvertes en texte brut ; les fichiers volumineux, binaires, multimédias et documents restent en lecture seule.

Pi-Harness n’est volontairement pas un IDE généraliste : pas de LSP/IntelliSense, refactorisation sémantique, débogueur, exécuteur de tâches, terminal intégré ni compatibilité avec les extensions IDE. Voir [les limites de l’éditeur léger](docs/lightweight-code-editor.md).

## Prérequis

- Node.js ≥ 22 (vérifié à l’installation des dépendances)
- pnpm `9.12.1` (voir le champ `packageManager`)
- [Pi Coding Agent](https://github.com/badlogic/pi-mono) installé, ou installation / mise à jour depuis l’application

## Démarrage rapide

```bash
pnpm install
pnpm dev
```

Sans Pi local, pointez Réglages → répertoire de configuration vers `fixtures/mock-pi/`, ou :

```bash
cp .env.example .env
# PI_HARNESS_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

Ne stockez pas de secrets dans des variables `VITE_*` — elles sont incluses dans le bundle Renderer.

## Commandes

| Commande         | Rôle                                                        |
| ---------------- | ----------------------------------------------------------- |
| `pnpm typecheck` | Vérification de types Vue / TypeScript                      |
| `pnpm lint`      | ESLint                                                      |
| `pnpm test`      | Tests unitaires Vitest                                      |
| `pnpm test:e2e`  | Compilation, puis smoke Playwright Electron                 |
| `pnpm compile`   | Compilation Vite vers `out/` (pas d’installateur)           |
| `pnpm build`     | Compilation et paquets macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | macOS uniquement                                            |

## Architecture

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentRuntime      sessions Pi / streaming / événements d’outils
                                                ├─ Workspace         projets / fichiers / éditeur léger / Git
                                                ├─ PiConfigService   écriture atomique / conflit mtime
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Le domaine reste découplé du JSON natif Pi via un Adapter. Les champs inconnus transitent tels quels. La logique n’est pas figée sur un nom de modèle.

## Documentation du projet

- [Historique des modifications](CHANGELOG.md)
- [Mises à jour de l’application et artefacts de version](docs/application-updates.md)
- [Limites de l’éditeur de code léger](docs/lightweight-code-editor.md)
- [Conception de la mascotte et règles d’exécution](docs/mascot-design.md)

## Auteur

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## Licence

Pi-Harness est un logiciel libre sous [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`). Son utilisation, sa modification et sa redistribution sont autorisées selon les conditions de la licence. Toute version modifiée mise à disposition via un réseau doit proposer à ses utilisateurs le code source correspondant, conformément à l’AGPL v3.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
