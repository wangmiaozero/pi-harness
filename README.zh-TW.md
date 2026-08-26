# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong><a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a> 一站式桌面工作台</strong><br />
  設定 Pi · 管理模型 · 安裝 Skills 與擴充套件 · 執行 Agent · 管理專案
</p>

<p align="center">
  將使用 Pi Coding Agent 所需的環境、Provider、模型、功能與工作區集中到一個原生桌面應用程式中。
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
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1"><img alt="v1.1.1 發行版" src="https://img.shields.io/badge/release-v1.1.1-4C8DFF?style=flat-square" /></a>
  <img alt="支援 macOS 和 Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only 授權" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

![Pi-Harness 概覽頁：環境狀態、目前模型和快速操作](docs/概览.jpg)

<p align="center">
  <a href="#下載">下載</a> ·
  <a href="#工作流程">工作流程</a> ·
  <a href="#介面預覽">介面預覽</a> ·
  <a href="#開發">開發</a>
</p>

## 為什麼選擇 Pi-Harness？

### 不只是 Pi 聊天介面

一般桌面用戶端解決的是「開啟 Pi 並開始聊天」。Pi-Harness 進一步將環境設定、Provider、模型、Skills、擴充套件、專案、檔案和 Git 集中到一個桌面工作區中。

```text
一般桌面用戶端                         Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness 不是網頁封裝：不嵌入 pi-web、Next.js 服務或 iframe，也不實作第二套 Agent Runtime。Pi Coding Agent 始終是唯一的 Agent Runtime，工作階段與 `~/.pi/agent/sessions/` 下的 Pi CLI JSONL 保持相容。

**設定 Pi。執行 Pi。擴充 Pi。**

## 下載

從 [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1) 下載 Pi-Harness v1.1.1。

| 平台                | 安裝程式                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon | [`Pi-Harness-1.1.1-arm64.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1-arm64.dmg) |
| macOS Intel         | [`Pi-Harness-1.1.1.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1.dmg)             |
| Windows x64         | [`Pi-Harness.Setup.1.1.1.exe`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness.Setup.1.1.1.exe) |

> macOS 社群組建可能未簽署。若系統阻擋首次啟動，請前往「系統設定 → 隱私權與安全性 → 仍要打開」。詳細說明請參閱 [v1.1.1 Release Notes](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1)。

安裝程式使用者不需要 clone 儲存庫，也不需要安裝 pnpm。Pi-Harness 可在支援的環境中偵測、安裝及修復 Node.js、npm、PATH 與 Pi Coding Agent。

## 您可以做什麼

### 工作區

開啟實際專案，建立或繼續 Pi 工作階段，讓 Thinking、Tool Call、串流回覆和修改中的檔案位於同一個工作區。

### Provider 與模型

使用 Pi 相容預設或自訂 API；在服務支援時取得模型目錄、測試連線，並選擇目前模型。

### Skills、擴充套件與 MCP

建立及管理本機 Skills 與 Pi Package，並透過支援的擴充套件連接 MCP。

### 執行環境

偵測 Node.js、npm、PATH 與 Pi Coding Agent，直接在桌面應用程式中安裝或修復常見環境問題。

### 檔案與 Git

瀏覽及上傳檔案、安全編輯可讀文字、查看 Git Diff，並使用專案 Worktree；定位仍是輕量工作區，而不是 IDE。

### 診斷與安全性

查看環境、儲存、工作區與功能健康狀態。

## 工作流程

1. **啟動 Pi-Harness**，在概覽頁檢查 Node.js、npm、PATH 與 Pi。
2. **設定 Provider**，選擇預設或填寫自己的 Pi 相容 API。
3. **選擇模型**，並執行連線測試。
4. **開啟專案**，進入原生工作區。
5. **建立或繼續 Pi 工作階段**，使用串流輸出、Tool Call、檔案和 Git 上下文完成工作。

```text
安裝 → 設定 Provider → 選擇模型 → 開啟專案 → 執行 Pi
```

## 介面預覽

### 1. 先確認環境已就緒

概覽頁集中顯示目前模型、Pi 環境、設定健康狀態與常用安裝操作。

![概覽](docs/概览.jpg)

### 2. 在實際專案中執行 Pi

專案、工作階段、串流回覆、Thinking、Tool Call、檔案和 Git 都位於同一個原生工作區中。

|             專案工作階段             |           檔案與輕量編輯           |
| :----------------------------------: | :--------------------------------: |
| ![工作區工作階段](docs/工作区-1.jpg) | ![工作區編輯器](docs/工作区-2.jpg) |

### 3. 設定 Provider 與模型

從預設或自訂 API 開始，測試連線、管理可用模型，再指定 Pi 使用的目前模型。

|          Provider 清單           |            Provider 設定             |
| :------------------------------: | :----------------------------------: |
| ![供應商清單](docs/提供商-1.jpg) | ![供應商詳細資料](docs/提供商-2.jpg) |
|           **模型清單**           |             **模型設定**             |
|   ![模型清單](docs/模型-1.jpg)   |   ![模型詳細資料](docs/模型-2.jpg)   |

### 4. 使用 Skills 與擴充套件擴充 Pi

管理本機 Skill、集合和 Pi Package。

|         已安裝 Skills          |       內建集合與擴充套件        |
| :----------------------------: | :-----------------------------: |
| ![已安裝技能](docs/技能-1.jpg) | ![Skills 市集](docs/技能-2.jpg) |

### 5. 調整工作區外觀

選擇跟隨系統、淺色或深色主題，並依需求啟用看板娘。

![外觀與看板娘設定](docs/设置.jpg)

## 核心功能

| 模組              | Pi-Harness 提供的功能                     |
| ----------------- | ----------------------------------------- |
| 概覽              | 顯示環境、設定和目前模型狀態              |
| 工作區            | 在專案檔案與 Git 上下文中執行 Pi 工作階段 |
| Provider 與模型   | 管理 Pi 相容 Provider 和模型              |
| Skills 與 Package | 管理支援的 Skills 和擴充套件              |
| 設定              | 編輯 Pi 設定並提供衝突保護                |
| 診斷              | 查看應用程式與環境健康狀態                |
| 更新              | 安裝相容的應用程式更新                    |
| 外觀              | 提供主題、密度和可選看板娘設定            |

### 輕量編輯器，而不是 IDE

Pi-Harness 可編輯可讀文字檔案，支援延遲載入語法醒目提示、行號、復原/重做、尋找、明確儲存、未儲存狀態和外部變更衝突保護。超大型檔案、二進位、媒體和文件使用唯讀預覽。

它不提供 LSP/IntelliSense、語意重構、偵錯工具、工作執行器、整合式終端機或 IDE 擴充功能相容性。

## 架構

Pi-Harness 將「管理 Pi、使用 Pi、擴充 Pi」分層，同時始終保持 Pi Coding Agent 是唯一的 Agent Runtime。

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       管理 Pi                使用 Pi             擴充 Pi

       Providers              Projects           Skills
       Models                 Sessions           Packages
       Environment            Agent              MCP adapters
       Config / Secrets       Streaming          Presets
       Backup / Diagnostics   Files / Git
       Updates                Worktree
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   ▼
                           Pi Coding Agent
```

桌面邊界固定為 `Vue Renderer → typed preload API → validated IPC → Main services → Pi SDK / 作業系統`。Domain Adapter 會保留 Pi 設定中的未知欄位。

## 環境需求

安裝程式使用者：

- macOS Apple Silicon、macOS Intel 或 Windows x64
- Pi Coding Agent，可直接在 Pi-Harness 中安裝或修復

從原始碼開發：

- Node.js ≥ 22
- pnpm `9.12.1`

## 開發

```bash
pnpm install --frozen-lockfile
pnpm dev
```

本機未安裝 Pi 時，可在「設定 → 設定目錄」中指向 `fixtures/mock-pi/`；也可以將 `.env.example` 複製為 `.env`，並將 `PI_HARNESS_PI_CONFIG_DIR` 指向該 fixture。請勿在 `VITE_*` 變數中存放金鑰，它們會被打包進 Renderer bundle。

常用檢查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

## 文件

- [更新記錄](CHANGELOG.md)

## 授權條款

Pi-Harness 採用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）發佈。您可以依照授權條款使用、修改和再散佈；透過網路向使用者提供修改版本時，必須依照 AGPL v3 要求向這些使用者提供對應原始碼。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero)。

## 作者

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
