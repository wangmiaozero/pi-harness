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
  <strong>Единое настольное рабочее пространство для <a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a></strong><br />
  Настройка Pi · Запуск агента · Управление моделями, Skills, пакетами и проектами
</p>

<p align="center">
  Всё необходимое для настройки, запуска и расширения Pi Coding Agent в одном нативном настольном приложении.
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0"><img alt="release v1.7.0" src="https://img.shields.io/badge/release-v1.7.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## Зачем нужен Pi-Harness?

### Больше, чем чат-интерфейс для Pi

Обычный настольный клиент позволяет открыть Pi и начать чат. Pi-Harness объединяет среду, провайдеры, модели, Skills, пакеты, проекты, файлы и Git в одном рабочем пространстве.

```text
Обычный настольный клиент             Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness — не обёртка над веб-интерфейсом. В нём нет встроенного pi-web, сервера Next.js или iframe, а также второй среды выполнения агента. Pi Coding Agent остаётся единственным Agent Runtime; сессии совместимы с JSONL Pi CLI в ~/.pi/agent/sessions/.

**Настроить Pi. Запустить Pi. Расширить Pi.**

## Скачать

Скачайте Pi-Harness v1.7.0 из [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0).

| Платформа           | Установщик                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.7.0-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.7.0.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.7.0.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-Setup-1.7.0.exe) |
| Linux x64           | [Pi-Harness-1.7.0.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.AppImage)   |

> **Примечание об обновлении Windows:** при первом запуске установленной версии v1.7.0 старые данные приложения Pi-Harness — настройки, локальное хранилище учётных данных, резервные копии и кэш — сбрасываются один раз. После этого заново настройте параметры и учётные данные. Отдельный каталог данных Pi Agent и файлы проектов не сбрасываются.
>
> Сборки сообщества для macOS могут быть не подписаны. Если система блокирует первый запуск, используйте **Системные настройки → Конфиденциальность и безопасность → Всё равно открыть**. Подробности — в [примечаниях к v1.7.0](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0).

Пользователям готового приложения не нужно клонировать репозиторий или устанавливать pnpm. Pi-Harness может обнаружить, установить и восстановить Node.js, npm, PATH и Pi Coding Agent в поддерживаемой среде.

## Возможности

- **Рабочее пространство:** запуск и продолжение Pi-сессий в реальном проекте; потоковые ответы, Thinking, Tool Call, файлы и Git рядом.
- **Провайдеры и модели:** настройка Pi-совместимых провайдеров и моделей, проверка подключения и выбор активной модели.
- **Skills, пакеты и MCP:** управление локальными Skills и пакетами Pi, подключение MCP через поддерживаемые пакеты.
- **Среда:** обнаружение и восстановление Node.js, npm, PATH и Pi прямо из настольного приложения.
- **Файлы и Git:** просмотр и загрузка файлов, лёгкий редактор с защитой от конфликтов, Git Diff и Worktree.
- **Диагностика:** проверка состояния приложения и среды.
- **Запуск и внешний вид:** при запуске проверяются реестр npm, Node.js, npm, Pi Agent и конфигурация, а одноцветная квантовая анимация частиц отображается не менее пяти секунд. В общих настройках доступны значки Classic, Ming и Quantum, свечение окна и экрана, а также эффект пламени в поле ввода. Сборка без маскота сохраняет стандартную стартовую анимацию и эти настройки, не загружая дополнительные темы маскота.

## Как это работает

1. Запустите Pi-Harness и проверьте среду.
2. Настройте Provider.
3. Выберите модель и проверьте подключение.
4. Откройте проект.
5. Начните или продолжите Pi-сессию.

```text
Установка → Provider → Модель → Проект → Запуск Pi
```

## Скриншоты

Основные экраны показаны в стандартной теме и в теме в стиле династии Мин. Рабочая область в теме Мин включает зимний и ночной варианты.

### Стандартная тема

|                         Рабочая область                          |                           Git                            |
| :--------------------------------------------------------------: | :------------------------------------------------------: |
|  ![Рабочая область в стандартной теме](docs/默认主题/Work.jpg)   |     ![Git в стандартной теме](docs/默认主题/Git.jpg)     |
|                          **Провайдеры**                          |                        **Модели**                        |
|     ![Провайдеры в стандартной теме](docs/默认主题/APIs.jpg)     |  ![Модели в стандартной теме](docs/默认主题/Model.jpg)   |
|                      **Центр возможностей**                      |                      **Настройки**                       |
| ![Центр возможностей в стандартной теме](docs/默认主题/Caps.jpg) | ![Настройки в стандартной теме](docs/默认主题/Prefs.jpg) |

### Тема в стиле династии Мин

|                     Рабочая область (снег)                      |                      Рабочая область (ночь)                       |
| :-------------------------------------------------------------: | :---------------------------------------------------------------: |
| ![Рабочая область зимой в теме династии Мин](docs/古风/Work-1.jpg) | ![Рабочая область ночью в теме династии Мин](docs/古风/Work-2.jpg) |
|                              Git                                |                          **Провайдеры**                           |
|      ![Git в теме династии Мин](docs/古风/Git.jpg)              |  ![Провайдеры в теме династии Мин](docs/古风/APIs.jpg)            |
|                           **Модели**                            |                      **Центр возможностей**                       |
|  ![Модели в теме династии Мин](docs/古风/Model.jpg)             | ![Центр возможностей в теме династии Мин](docs/古风/Caps.jpg)     |
|                         **Настройки**                           |                                                                   |
| ![Настройки в теме династии Мин](docs/古风/Prefs.jpg)           |                                                                   |

## Граница редактора

Pi-Harness редактирует читаемые текстовые файлы с подсветкой синтаксиса, номерами строк, отменой/повтором, поиском, явным сохранением и защитой от внешних изменений. Большие, бинарные, медиафайлы и документы доступны только для просмотра.

Это не IDE: нет LSP/IntelliSense, семантического рефакторинга, отладчика, запуска задач, встроенного терминала или совместимости с расширениями IDE.

## Архитектура

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       Управление Pi          Работа с Pi        Расширение Pi

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

Pi Coding Agent остаётся единственным Agent Runtime.

## Требования

Готовое приложение:

- macOS Apple Silicon, macOS Intel или Windows x64
- Pi Coding Agent, который можно установить или восстановить из Pi-Harness

Разработка из исходного кода:

- Node.js ≥ 22
- pnpm 9.12.1

## Разработка

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Основные проверки: pnpm typecheck, pnpm lint, pnpm test, pnpm compile, pnpm test:e2e:only. Не храните секреты в переменных VITE_* — они попадают в бандл Renderer.

## Документация

- [История изменений](CHANGELOG.md)

## Лицензия

Pi-Harness распространяется по лицензии [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only).

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## Автор

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
