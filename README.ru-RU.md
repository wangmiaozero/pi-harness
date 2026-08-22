# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong>Полноценный настольный Harness для <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Локальный настольный Harness · Electron · Vue 3 · TypeScript
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
  <img alt="version" src="https://img.shields.io/badge/version-1.0.7-4C8DFF?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-43853D?style=flat-square" />
</p>

Управляйте провайдерами, моделями, API-ключами, навыками, конфигурацией Pi, резервными копиями и диагностикой, а затем работайте с Pi Coding Agent над реальным проектом прямо в рабочей области приложения.

Секреты никогда не попадают в Renderer в открытом виде. macOS хранит их в системной связке ключей; Windows и Linux используют Electron `safeStorage`. Неизвестные поля Pi сохраняются.

## Скриншоты

| Обзор | Настройки |
| :---: | :---: |
| ![Обзор](docs/概览.jpg) | ![Настройки](docs/设置.jpg) |
| **Рабочая область — Сессии** | **Рабочая область — Редактор** |
| ![Сессии](docs/工作区-1.jpg) | ![Редактор](docs/工作区-2.jpg) |
| **Провайдеры — Список** | **Провайдеры — Детали** |
| ![Список провайдеров](docs/提供商-1.jpg) | ![Детали провайдера](docs/提供商-2.jpg) |
| **Модели — Список** | **Модели — Детали** |
| ![Список моделей](docs/模型-1.jpg) | ![Детали модели](docs/模型-2.jpg) |
| **Навыки — Установленные** | **Навыки — Маркет** |
| ![Установленные навыки](docs/技能-1.jpg) | ![Маркет навыков](docs/技能-2.jpg) |

## Возможности

| Модуль | Описание |
| --- | --- |
| **Обзор** | Активная модель, Pi CLI / каталог конфигурации, состояние среды и частые действия |
| **Рабочая область** | Проекты, сессии, потоковый чат, Thinking, Tool Call, лёгкое редактирование кода, Git Diff и Worktree |
| **Провайдеры** | Provider ≠ Protocol ≠ Model; учётные данные в Keychain / `safeStorage` |
| **Модели** | Флаги возможностей, активная модель, проверка соединения; после записи повторно читается `settings.json` |
| **Навыки** | Создание / импорт / правка / проверка `SKILL.md`; ограничение корневыми путями |
| **Конфигурация** | Редактор CodeMirror для `models.json` / `settings.json`; форматирование и показ в файловом менеджере |
| **Диагностика** | Отчёт о среде; при копировании данные очищаются (`apiKey` / `token` / `secret` и т. д.) |
| **Настройки** | 简体中文 / English / 한국어 / Русский / Français / Deutsch, тёмная / светлая тема, стандартная / компактная плотность, резервные копии |

Надёжность:

- Автобэкап перед записью; атомарная запись
- Обнаружение внешних изменений (mtime): Reload / Compare / Overwrite
- Сборки с установщиком поддерживают `electron-updater` (без тихой автоустановки)
- Только десктоп: внешние окна браузера и переход по URL вне приложения блокируются

## Требования

- Node.js ≥ 22 (проверяется при установке зависимостей)
- pnpm `9.12.1` (см. поле `packageManager`)
- Установленный [Pi Coding Agent](https://github.com/badlogic/pi-mono) либо установка / обновление из приложения

## Быстрый старт

```bash
pnpm install
pnpm dev
```

Без локального Pi укажите в настройках каталог `fixtures/mock-pi/` или:

```bash
cp .env.example .env
# PI_HARNESS_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

Не храните секреты в переменных `VITE_*` — они попадают в бандл Renderer.

## Команды

| Команда | Назначение |
| --- | --- |
| `pnpm typecheck` | Проверка типов Vue / TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Модульные тесты Vitest |
| `pnpm test:e2e` | Сборка, затем Playwright Electron smoke |
| `pnpm compile` | Сборка Vite в `out/` (без установщика) |
| `pnpm build` | Сборка и пакеты macOS / Windows / Linux → `release/` |
| `pnpm build:mac` | Только macOS |

## Архитектура

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentSession      проекты / сессии / потоковое выполнение
                                                ├─ Workspace         файлы / лёгкий редактор / Git
                                                ├─ PiConfigService   атомарная запись / конфликт mtime
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Домен отделён от нативного JSON Pi через Adapter. Неизвестные поля проходят насквозь. Логика не привязана к конкретному имени модели.

## Автор

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## Лицензия

Pi-Harness — свободное программное обеспечение под лицензией [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`). Использование, изменение и распространение разрешены на условиях лицензии. При предоставлении изменённой версии по сети пользователям необходимо предложить соответствующий исходный код согласно AGPL v3.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
