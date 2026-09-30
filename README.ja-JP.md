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
  <strong>Native Pi のすべてに、可視性、制御、復旧、評価、Multi-Agent オーケストレーションを。</strong>
</p>

<p align="center">Native Pi を、さらに強力に。</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.8.0"><img alt="release v1.8.0" src="https://img.shields.io/badge/release-v1.8.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## Why Pi-Harness?

Pi-Harness は Pi Coding Agent の Operational Superset です。Native Pi を唯一の Agent Runtime として維持し、互換性のある Sessions、Tools、Models、Skills、Extensions、Context、Compaction に、Observe、Control、Recovery、Evaluation、Multi-Agent Orchestration を追加します。

> **Pi が Agent を実行し、Pi-Harness がそれを可視化・制御・復旧・編成可能なエンジニアリングシステムにします。**

Pi-Harness は Pi の Agent Runtime を置き換えたり再実装したりしません。

## 「Superset」とは

Native Pi は常に実際の実行経路の内側にあり、Pi-Harness はその外側に Harness Control Plane と Visual Engineering Workspace を追加します。

## Pi と Pi-Harness の機能マトリクス

| 機能                                 | Native Pi | Pi-Harness              |
| ------------------------------------ | --------- | ----------------------- |
| Agent Runtime / Loop                 | 対応      | Native Pi               |
| Sessions / Context / Compaction      | 対応      | 対応 + 可視化管理・制御 |
| Steering / Follow-up / Thinking      | 対応      | 対応 + 可視化制御       |
| Models / Tools / Skills / Extensions | 対応      | 対応 + Manager / Policy |
| Runs / Trace / Replay / Compare      | —         | 対応                    |
| Policy / Budget / Evaluation         | —         | 対応                    |
| Checkpoint / Recovery / Diagnostics  | —         | 対応                    |
| Regression / Artifacts               | —         | 対応                    |
| Multi-Agent / Task DAG / Handoff     | —         | 対応                    |
| Review Gates / Worktree isolation    | —         | 対応                    |

## ダウンロード

[GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.8.0) から Pi-Harness v1.8.0 をダウンロードしてください。

| プラットフォーム    | インストーラー                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.8.0-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-1.8.0-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.8.0.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-1.8.0.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.8.0.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-Setup-1.8.0.exe) |
| Linux x64           | [Pi-Harness-1.8.0.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.8.0/Pi-Harness-1.8.0.AppImage)   |

> macOS のコミュニティビルドは署名されていない場合があります。初回起動がブロックされた場合は、**システム設定 → プライバシーとセキュリティ → このまま開く**を使用してください。詳細は [v1.8.0 リリースノート](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.8.0)を参照してください。

パッケージ版の利用者は、リポジトリの clone や pnpm のインストールを行う必要はありません。Pi-Harness は、対応環境で Node.js、npm、PATH、Pi Coding Agent を検出し、インストールまたは修復できます。

## できること

- **Workspace:** 実際のプロジェクトで Pi セッションを開始または再開し、ストリーミング応答、Thinking、Tool Call、ファイル、Git を同じ場所で扱えます。
- **Providers & Models:** Pi 互換の Provider とモデルを設定し、接続テストと使用モデルの選択を行えます。
- **Skills, Packages & MCP:** ローカル Skills と Pi パッケージを管理し、対応パッケージ経由で MCP に接続できます。
- **Environment:** Node.js、npm、PATH、Pi を検出し、よくあるインストール問題をデスクトップアプリから解決できます。
- **Files & Git:** ファイルの閲覧とアップロード、競合保護付きの軽量編集、Git Diff、Worktree を利用できます。
- **Diagnostics:** アプリケーションと環境の状態を確認できます。
- **起動と外観:** 起動時に npm レジストリ、Node.js、npm、Pi Agent、設定を確認しながら、単色の量子粒子アニメーションを 5 秒以上表示します。一般設定では、クラシック・Ming・量子のアプリアイコン、ウィンドウと画面のグロー、入力欄の炎エフェクトを選択できます。マスコットなしビルドでも、任意のマスコットテーマを読み込まずに標準の起動アニメーションと外観設定を利用できます。

## 利用の流れ

1. Pi-Harness を起動し、環境の状態を確認します。
2. Provider を設定します。
3. モデルを選択し、接続をテストします。
4. プロジェクトを開きます。
5. Pi セッションを開始または再開します。

```text
インストール → Provider を設定 → モデルを選択 → プロジェクトを開く → Pi を実行
```

## スクリーンショット

デフォルトテーマでは主要機能を紹介します。v1.8.0 の外観ギャラリーは、ワークスペーステーマと機能画面に分類しています。

### デフォルトテーマ

|                        ワークスペース                         |                         Git                         |
| :-----------------------------------------------------------: | :-------------------------------------------------: |
| ![クラシックテーマのワークスペース](docs/经典主题/工作区.jpg) |  ![クラシックテーマの Git](docs/经典主题/Git.jpg)   |
|                       **機能センター**                        |                     **モデル**                      |
| ![クラシックテーマの機能センター](docs/经典主题/能力中心.jpg) | ![クラシックテーマのモデル](docs/经典主题/模型.jpg) |
|                           **設定**                            |                                                     |
|       ![クラシックテーマの設定](docs/经典主题/设置.jpg)       |                                                     |

### v1.8.0 外観ギャラリー

#### ワークスペーステーマ

|                                  Ming · 雪景の官人                                   |                         Ming · 雪夜の笛奏者                         |
| :----------------------------------------------------------------------------------: | :-----------------------------------------------------------------: |
|          ![Ming 雪景の官人ワークスペース](docs/主题展示/大明/雪境朝臣.jpg)           | ![Ming 雪夜の笛奏者ワークスペース](docs/主题展示/大明/雪夜笛姬.jpg) |
|                                **Ming · 月城の書姫**                                 |                        **Starship Cockpit**                         |
|          ![Ming 月城の書姫ワークスペース](docs/主题展示/大明/月城书姬.jpg)           | ![Starship Cockpit ワークスペース](docs/主题展示/星舰/霜星领航.jpg) |
|                             **macOS 27 · Liquid Ether**                              |                      **宣言型カスタムスキン**                       |
| ![macOS 27 Liquid Ether ワークスペース](docs/主题展示/macOS%2027/Liquid%20Ether.jpg) |   ![宣言型カスタムスキン](docs/主题展示/自定义皮肤/夏日海岸.jpg)    |

#### 機能画面

|                        一般設定                        |                       テーマギャラリー                        |
| :----------------------------------------------------: | :-----------------------------------------------------------: |
|      ![一般外観設定](docs/功能界面/通用设置.jpg)       | ![組み込みテーマとカスタムテーマ](docs/功能界面/主题图库.jpg) |
|                    **機能センター**                    |                     **Provider とモデル**                     |
| ![Capabilities マーケット](docs/功能界面/能力中心.jpg) |  ![Provider とモデル管理](docs/功能界面/Provider与模型.jpg)   |
|                        **Git**                         |                                                               |
|      ![Git ワークスペース](docs/功能界面/Git.jpg)      |                                                               |

## エディターの範囲

Pi-Harness は、シンタックスハイライト、行番号、元に戻す／やり直し、検索、明示的な保存、未保存状態、外部変更との競合保護を備えた軽量テキストエディターを提供します。大容量ファイル、バイナリ、メディア、ドキュメントは読み取り専用でプレビューします。

Pi-Harness は IDE ではありません。LSP/IntelliSense、セマンティックリファクタリング、デバッガー、タスクランナー、統合ターミナル、IDE 拡張機能との互換性は提供しません。

## アーキテクチャ

Native Pi は Pi-Harness の実行アーキテクチャに内包され、置き換えられることはありません。

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

デスクトップ境界は `Vue Renderer → typed preload API → validated IPC → Main services → Pi compatibility layer → Native Pi SDK` です。Session は <code>~/.pi/agent/sessions/</code> の Pi CLI JSONL と互換性を維持します。

## Harness Control Plane

Runs、Trace、Replay、Run Tree、Run Compare、Policy、Budget、Checkpoints、Recovery、Permissions、Evaluation、Diagnostics、Regression、Artifacts はリリース済みです。データは実際の Pi Event、Session、コマンド結果に基づきます。

## Multi-Agent オーケストレーション

Agents、Teams、Tasks、Dependencies、Handoffs、Review Gates、Budget、Worktree 分離と、pause、resume、abort、retry、skip、reassign をサポートしています。各 Agent は実際の Pi Session で動作します。

## Pi Superset Contract

Pi-Harness は Pi Coding Agent の operational superset です。Native Pi の Agent Runtime と互換性を保ち、その上に可観測性、ガバナンス、オーケストレーション、復旧、評価、視覚的なエンジニアリングワークスペースを追加します。

- Native Pi の機能を意図的に減らさず、技術的に可能な範囲で Pi のネイティブ形式との互換性を維持します。
- Native Pi が常に実行 Runtime です。Agent Loop、Context、Compaction、Tools、Skills、Extensions を再実装しません。
- Pi ネイティブの Session と設定は単独でも利用でき、Harness 固有の状態は分離して保存します。
- 機能追加は原則として加算的に行い、Pi の新機能はまず互換レイヤー経由で公開します。
- capability detection、graceful degradation、best-effort forward compatibility を採用します。

## Roadmap

- Session Tree の可視化と、より詳細な Context / Queue inspectors
- 高度な Workspace 権限と検証連携
- Harness Profiles と、より高度な Run Analysis

## 必要環境

パッケージ版：

- macOS Apple Silicon、macOS Intel、または Windows x64
- Pi-Harness からインストールまたは修復できる Pi Coding Agent

ソースから開発する場合：

- Node.js ≥ 22.19.0
- pnpm 9.12.1

## 開発

```bash
pnpm install --frozen-lockfile
pnpm dev
```

主なチェックコマンドは、pnpm typecheck、pnpm lint、pnpm test、pnpm compile、pnpm test:e2e:only です。Renderer バンドルに含まれるため、VITE_* 変数に秘密情報を保存しないでください。

## ドキュメント

- [変更履歴](CHANGELOG.md)

## ライセンス

Pi-Harness は [GNU Affero General Public License v3.0 only](LICENSE)（AGPL-3.0-only）の下で公開されています。

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## 作者

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
