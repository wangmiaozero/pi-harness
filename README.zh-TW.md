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

<h3 align="center">Pi Coding Agent 的 Operational Superset</h3>

<p align="center">
  <strong>在 Native Pi 之上，提供視覺化工作區、執行控制、任務復原與多智慧體協作。</strong>
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="#download"><strong>下載</strong></a> ·
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>建立自訂皮膚</strong></a> ·
  <a href="#screenshots">介面預覽</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="已發行版本" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

## 為什麼選擇 Pi-Harness？

Pi-Harness 將 Pi Coding Agent 帶入 macOS、Windows 和 Linux 桌面工作區。在同一個應用程式中管理對話、專案、檔案、Git、模型和 Skills，並透過執行觀測、預算控制、任務復原與智慧體團隊完成工作。

Native Pi 負責執行智慧體。Pi 工作階段、設定、工具、Skills 與擴充套件保持相容，也可以繼續在桌面應用程式之外使用 Pi。

## 原生 Pi 與 Pi-Harness

Pi-Harness 是 Pi Coding Agent 的操作能力超集：以原生 Pi 能力為基礎，加入觀測、控制、復原、多智慧體編排與視覺化工作區。

| 能力                     | Native Pi | Pi-Harness        |
| ------------------------ | --------- | ----------------- |
| Agent Runtime            | 支援      | Native Pi         |
| Agent Loop               | 支援      | Native Pi         |
| Sessions                 | 支援      | 支援 + 視覺化管理 |
| Context                  | 支援      | 支援 + 檢查視圖   |
| Compaction               | 支援      | 支援 + 視覺化控制 |
| Steering                 | 支援      | 支援              |
| Follow-up                | 支援      | 支援              |
| Models                   | 支援      | 支援 + 管理器     |
| Thinking                 | 支援      | 支援 + 視覺化控制 |
| Tools                    | 支援      | 支援 + 選擇與策略 |
| Skills                   | 支援      | 支援 + 管理器     |
| Extensions               | 支援      | 支援 + 管理器     |
| Packages                 | 支援      | 支援 + 管理器     |
| MCP / Codemode           | 支援      | 支援 + 選擇與策略 |
| Runs                     | —         | 支援              |
| Trace                    | —         | 支援              |
| Replay                   | —         | 支援              |
| Run Compare              | —         | 支援              |
| Evaluation               | —         | 支援              |
| Policy                   | —         | 支援              |
| Budget                   | —         | 支援              |
| Checkpoints              | —         | 支援              |
| Recovery                 | —         | 支援              |
| Diagnostics              | —         | 支援              |
| Regression               | —         | 支援              |
| Artifacts                | —         | 支援              |
| Multi-Agent              | —         | 支援              |
| Task DAG                 | —         | 支援              |
| Handoff                  | —         | 支援              |
| Review Gates             | —         | 支援              |
| Worktree isolation       | —         | 支援              |
| Project architecture map | —         | 支援              |

## 功能介紹

### 工作區、檔案與 Git

可以直接開始獨立對話，也可以開啟專案並繼續 Pi 工作階段。集中查看串流回覆、思考過程、工具呼叫、圖片與檔案變更，選擇模型、思考等級與工具，或壓縮對話上下文。在工作區「工具」中開啟 Harness 和智慧體時，對話與未送出的草稿會保留。

支援檔案瀏覽與搜尋、媒體和文件預覽，以及具備語法高亮、行號、尋找、復原/重做、明確儲存和外部變更衝突保護的輕量文字編輯。Git 提供差異、提交歷史、活動圖、提交操作、可選 AI 提交訊息與 worktree。

### Provider 與模型

透過預設或自訂位址設定 Pi 相容 Provider，管理憑證、取得服務支援的模型清單、測試連線並選擇聊天模型。支援的影像模型可用於文字生圖或圖片編輯，結果可以下載。

### Skills、擴充套件、套件與 MCP

在能力中心瀏覽內建與本機 Skills、編輯 Skill，並管理 Pi 套件和擴充套件。在輸入框鍵入 `@`，即可搜尋並呼叫已安裝的 Skill。透過支援的套件連接 MCP；[Superpowers](https://github.com/obra/superpowers) 和 [Odai](https://github.com/orziz/odai) 等可選增強功能可按需安裝、更新或解除安裝。

### Harness：觀測、控制與復原

查看執行記錄、Trace、重播、時間軸與工具活動；比較不同執行，在執行樹中追蹤分支與重試，檢查 Token、費用、耗時、產物及專案統計。

設定工具策略與單次執行預算，建立檢查點，並復原、分支或重試任務。評估、診斷和回歸基準協助你依據實際執行記錄檢查結果、找出失敗原因。

### 智慧體團隊與任務編排

使用可重複使用的團隊與範本協調多個 Pi 智慧體，為任務指定相依關係、優先順序與負責人，支援手動、循序或平行排程、結果與產物交接、審核關卡。透過 worktree 隔離修改，並使用預算、衝突提示，以及暫停、繼續、中止、重試、跳過和重新指派來管理任務。

### 本機對話歷史

統一瀏覽 Claude Code、Codex（含桌面及封存對話）、Cursor、Cursor Agent、Gemini CLI、OpenCode 和 Pi 歷史，支援搜尋、來源/專案/日期範圍篩選及自訂歷史目錄。

原始對話唯讀；查看交接預覽、編輯下一步指令後，可以在同一專案下建立 Pi 對話繼續任務。瀏覽、本機預覽和掃描重試不消耗模型 Token；可選 AI 整理只在主動使用時呼叫已設定的模型。

### 專案架構

在工作區開啟「專案架構」，瀏覽模組、相依關係、入口檔案與原始碼引用。支援依套件篩選、模組聚焦、地圖翻頁、縮放與全螢幕，儲存分析快照並提示原始碼變更，可匯出 JSON、離線 HTML 或目前視圖 PNG。

本機分析不消耗模型 Token，AI 說明按需使用。JavaScript、TypeScript 和 Vue 提供本機匯入關係分析，其他支援語言提供檔案層級索引，分析結果會標示涵蓋範圍與限制。

### 主題與自訂皮膚

選擇經典配色、大明、星艦駕駛艙、macOS 27 背景或匯入自訂皮膚。新安裝預設使用深色主題；支援自訂聊天顯示名稱、應用程式圖示、本機背景圖，以及視窗光圈、螢幕光圈和輸入框火焰效果。啟動動畫伴隨環境檢查，無吉祥物版本保留一般外觀設定。

### 環境與應用程式設定

檢查 Node.js、npm、PATH、Pi Coding Agent 和目前設定，在支援的環境中安裝、更新或修復 Pi；查看環境診斷、管理設定備份並檢查應用程式更新。介面支援八種語言。

## 建立自訂皮膚

使用 [Pi-Harness 自訂皮膚範本](https://github.com/wangmiaozero/pi-harness-skin-starter)，製作你喜歡的視覺風格。

1. 使用範本儲存庫，或下載並解壓縮。
2. 以編碼智慧體開啟專案，透過內建提示詞描述你喜歡的風格。
3. 完成後從「設定 → 主題 → 匯入皮膚」匯入專案。

多語言範本提供配色、預覽圖、桌布與可選角色圖的製作說明。皮膚可以保存在獨立儲存庫中，單獨更新和分享。

<a id="screenshots"></a>

## 介面預覽

功能介面依主題分類，更多視圖請見[完整截圖索引](docs/README.md)。

### 經典主題

#### 工作區

[![工作區](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)

<details>
<summary>Git · Provider 與模型 · 能力中心 · Harness 工具 · 專案架構</summary>

#### Git

[![Git](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)

#### Provider 與模型

[![Provider 與模型](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)

#### 能力中心

[![能力中心](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)

#### Harness 工具

[![Harness 工具](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)

#### 專案架構

[![專案架構](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)

</details>

### 大明功能介面

<details>
<summary>一般設定 · 主題皮膚庫</summary>

#### 一般設定

[![一般設定](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)

#### 主題皮膚庫

[![主題皮膚庫](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)

</details>

### 主題展示

<details>
<summary>大明·雪境朝臣 · 大明·雪夜笛姬 · 大明·月城書姬 · 星艦駕駛艙 · macOS 27 · Liquid Ether</summary>

#### 大明·雪境朝臣

[![大明·雪境朝臣](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)

#### 大明·雪夜笛姬

[![大明·雪夜笛姬](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)

#### 大明·月城書姬

[![大明·月城書姬](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)

#### 星艦駕駛艙

[![星艦駕駛艙](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)

#### macOS 27 · Liquid Ether

[![macOS 27 · Liquid Ether](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)

</details>

<a id="download"></a>

## 下載

在 [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases) 下載已發行的安裝程式，選擇對應平台的檔案。

| 平台                | 安裝程式                  |
| ------------------- | ------------------------- |
| macOS Apple Silicon | `.dmg` · `arm64`          |
| macOS Intel         | `.dmg` · `x64`            |
| Windows x64         | `.exe` · Windows 安裝程式 |
| Linux x64           | `.AppImage`               |

安裝程式使用者無需複製儲存庫或安裝 pnpm。Pi-Harness 可以在支援的環境中協助安裝 Pi 並設定執行環境。

> macOS 社群組建可能未簽署。若系統阻擋首次啟動，請前往「系統設定 → 隱私權與安全性 → 仍要打開」。

## 開始使用

1. 啟動 Pi-Harness，在概覽頁檢查執行環境。
2. 設定 Provider、測試連線並選擇模型。
3. 直接建立對話，或開啟專案。
4. 建立或繼續 Pi 工作階段，在同一介面中處理對話、檔案和 Git。
5. 需要執行控制或團隊協作時，開啟工作區「工具」。

## 環境需求

桌面應用程式支援 macOS Apple Silicon、macOS Intel、Windows x64 和 Linux x64。支援的環境可在應用程式中安裝或修復 Pi Coding Agent。從原始碼執行需要 Node.js ≥ 22.22.2 和 pnpm 9.12.1。

## 文件

- [截圖分類索引](docs/README.md)
- [更新記錄](CHANGELOG.md)

## 致謝與作者

Pi-Harness 圍繞官方 [Pi Coding Agent 與 Pi Agent Harness](https://github.com/earendil-works/pi) 建立。

由 [wangmiao](https://github.com/wangmiaozero) 建立並維護 · [tuziling84@gmail.com](mailto:tuziling84@gmail.com)。

### PR 貢獻者

感謝 [@HenryArch](https://github.com/HenryArch) 透過 [PR #8](https://github.com/wangmiaozero/pi-harness/pull/8) 為專案作出貢獻。

## 授權條款

Pi-Harness 採用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）發佈。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
