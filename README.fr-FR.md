# Pi-Switch

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Switch" />
</p>

<p align="center">
  <strong>Gestionnaire de bureau tout-en-un pour <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Gestionnaire de configuration local-first · Electron · Vue 3 · TypeScript
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
  <img alt="version" src="https://img.shields.io/badge/version-0.3.0-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

Gérez les fournisseurs, modèles, clés API, compétences, configuration brute Pi, sauvegardes et diagnostics depuis une interface de bureau — sans éditer à la main `~/.pi/agent/*.json`.

Les secrets n’apparaissent jamais en clair dans le Renderer. macOS les stocke dans le Trousseau ; Windows et Linux utilisent Electron `safeStorage`. Les champs Pi inconnus sont conservés.

## Captures d’écran

| Aperçu | Fournisseurs |
| :---: | :---: |
| ![Overview](docs/1.jpg) | ![Providers](docs/2.jpg) |
| **Modèles** | **Compétences** |
| ![Models](docs/3.jpg) | ![Skills](docs/4.jpg) |

## Fonctionnalités

| Module | Description |
| --- | --- |
| **Aperçu** | Modèle actif, Pi CLI / répertoire de configuration, état de l’environnement et actions courantes |
| **Fournisseurs** | Provider ≠ Protocol ≠ Model ; identifiants dans le Trousseau / `safeStorage` |
| **Modèles** | Capacités, modèle actif, test de connexion ; relecture de `settings.json` après écriture |
| **Compétences** | Créer / importer / modifier / valider `SKILL.md` ; contrainte de racine de chemin |
| **Configuration** | Éditeur CodeMirror pour `models.json` / `settings.json` ; formatage et affichage dans le gestionnaire de fichiers |
| **Diagnostics** | Rapport d’environnement ; copie assainie (`apiKey` / `token` / `secret`, etc.) |
| **Réglages** | 简体中文 / English / 한국어 / Русский / Français / Deutsch, sombre / clair, densité standard / compacte, sauvegardes |

Fiabilité :

- Sauvegarde automatique avant écriture ; écritures atomiques
- Détection des changements externes (mtime) : Reload / Compare / Overwrite
- Les builds packagés prennent en charge `electron-updater` (jamais d’installation silencieuse)
- Application de bureau : fenêtres de navigateur externes et redirections URL hors app bloquées

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
# PI_SWITCH_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

Ne stockez pas de secrets dans des variables `VITE_*` — elles sont incluses dans le bundle Renderer.

## Commandes

| Commande | Rôle |
| --- | --- |
| `pnpm typecheck` | Vérification de types Vue / TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Tests unitaires Vitest |
| `pnpm test:e2e` | Compilation, puis smoke Playwright Electron |
| `pnpm compile` | Compilation Vite vers `out/` (pas d’installateur) |
| `pnpm build` | Compilation et paquets macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | macOS uniquement |

## Architecture

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ PiConfigService   écriture atomique / conflit mtime
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Le domaine reste découplé du JSON natif Pi via un Adapter. Les champs inconnus transitent tels quels. La logique n’est pas figée sur un nom de modèle.

## Auteur

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-switch](https://github.com/wangmiaozero/pi-switch)

## Licence

[MIT](./LICENSE) © 2026 wangmiao
