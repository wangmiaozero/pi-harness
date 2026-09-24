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
  <strong>Native Pi의 모든 기능에 관측, 제어, 복구, 평가, Multi-Agent 오케스트레이션을 더합니다.</strong>
</p>

<p align="center">Native Pi, 더 강력하게.</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0"><img alt="release v1.7.0" src="https://img.shields.io/badge/release-v1.7.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## 왜 Pi-Harness인가요?

Pi-Harness는 Pi Coding Agent의 Operational Superset입니다. Native Pi를 유일한 Agent Runtime으로 유지하고 호환되는 Sessions, Tools, Models, Skills, Extensions, Context, Compaction 위에 Observe, Control, Recovery, Evaluation, Multi-Agent Orchestration을 추가합니다.

> **Pi가 Agent를 실행하고, Pi-Harness가 이를 관측·제어·복구·오케스트레이션 가능한 엔지니어링 시스템으로 만듭니다.**

Pi-Harness는 Pi의 Agent Runtime을 대체하거나 다시 구현하지 않습니다.

## “Superset”의 의미

Native Pi는 항상 실제 실행 경로 안에 있으며, Pi-Harness는 그 바깥에 Harness Control Plane과 Visual Engineering Workspace를 추가합니다.

## Pi와 Pi-Harness 기능 매트릭스

| 기능                                 | Native Pi | Pi-Harness                 |
| ------------------------------------ | --------- | -------------------------- |
| Agent Runtime / Loop                 | 지원      | Native Pi                  |
| Sessions / Context / Compaction      | 지원      | 지원 + 시각적 관리 및 제어 |
| Steering / Follow-up / Thinking      | 지원      | 지원 + 시각적 제어         |
| Models / Tools / Skills / Extensions | 지원      | 지원 + Manager / Policy    |
| Runs / Trace / Replay / Compare      | —         | 지원                       |
| Policy / Budget / Evaluation         | —         | 지원                       |
| Checkpoint / Recovery / Diagnostics  | —         | 지원                       |
| Regression / Artifacts               | —         | 지원                       |
| Multi-Agent / Task DAG / Handoff     | —         | 지원                       |
| Review Gates / Worktree isolation    | —         | 지원                       |

## 다운로드

[GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0)에서 Pi-Harness v1.7.0을 다운로드하세요.

| 플랫폼              | 설치 파일                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.7.0-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.7.0.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.7.0.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-Setup-1.7.0.exe) |
| Linux x64           | [Pi-Harness-1.7.0.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.AppImage)   |

> **Windows 업그레이드 안내:** v1.7.0 설치 앱을 처음 실행하면 이전 Pi-Harness 앱 데이터(앱 설정, 로컬 자격 증명 저장소, 앱 백업, 캐시)가 한 번 초기화됩니다. 이후 앱 설정과 자격 증명을 다시 구성해야 합니다. Pi Agent의 별도 데이터 디렉터리와 프로젝트 파일은 초기화되지 않습니다.
>
> macOS 커뮤니티 빌드는 서명되지 않았을 수 있습니다. 첫 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 사용하세요. 자세한 내용은 [v1.7.0 릴리스 노트](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0)를 참고하세요.

패키지 사용자는 저장소를 clone하거나 pnpm을 설치할 필요가 없습니다. Pi-Harness는 지원되는 환경에서 Node.js, npm, PATH, Pi Coding Agent를 감지하고 설치하거나 복구할 수 있습니다.

## 할 수 있는 일

- **Workspace:** 실제 프로젝트에서 Pi 세션을 시작하거나 이어서 실행하고, 스트리밍 응답, Thinking, Tool Call, 파일, Git을 함께 확인합니다.
- **Providers & Models:** Pi 호환 Provider와 모델을 구성하고 연결 테스트 후 활성 모델을 선택합니다.
- **Skills, Packages & MCP:** 로컬 Skills와 Pi 패키지를 관리하고 지원되는 패키지로 MCP를 연결합니다.
- **Environment:** Node.js, npm, PATH, Pi를 감지하고 일반적인 설치 문제를 데스크톱 앱에서 해결합니다.
- **Files & Git:** 파일을 탐색·업로드하고, 충돌 보호가 있는 경량 편집기를 사용하며, Git Diff와 Worktree를 확인합니다.
- **Diagnostics:** 애플리케이션과 환경 상태를 확인합니다.
- **시작 및 모양:** 시작 시 npm 레지스트리, Node.js, npm, Pi Agent와 설정을 검사하면서 단색 퀀텀 입자 애니메이션을 최소 5초 동안 표시합니다. 일반 설정에서 클래식, Ming, 퀀텀 앱 아이콘과 창·화면 글로우, 입력창 불꽃 효과를 선택할 수 있습니다. 마스코트 없는 빌드도 선택형 마스코트 테마를 로드하지 않고 기본 시작 애니메이션과 모양 설정을 유지합니다.

## 사용 흐름

1. Pi-Harness를 실행하고 환경 상태를 확인합니다.
2. Provider를 구성합니다.
3. 모델을 선택하고 연결을 테스트합니다.
4. 프로젝트를 엽니다.
5. Pi 세션을 시작하거나 이어서 실행합니다.

```text
설치 → Provider 구성 → 모델 선택 → 프로젝트 열기 → Pi 실행
```

## 화면 미리보기

동일한 주요 화면을 기본 테마와 고전풍 테마로 각각 보여 줍니다. 고전풍 테마 작업 공간에는 설경과 월야 두 가지가 있습니다.

### 기본 테마

|                   작업 공간                    |                    Git                     |
| :--------------------------------------------: | :----------------------------------------: |
| ![기본 테마 작업 공간](docs/默认主题/Work.jpg) |  ![기본 테마 Git](docs/默认主题/Git.jpg)   |
|                  **Provider**                  |                  **모델**                  |
| ![기본 테마 Provider](docs/默认主题/APIs.jpg)  | ![기본 테마 모델](docs/默认主题/Model.jpg) |
|                 **기능 센터**                  |                  **설정**                  |
| ![기본 테마 기능 센터](docs/默认主题/Caps.jpg) | ![기본 테마 설정](docs/默认主题/Prefs.jpg) |

### 고전풍 테마

|                  작업 공간 (설경)                   |                  작업 공간 (월야)                   |
| :-------------------------------------------------: | :-------------------------------------------------: |
| ![고전풍 테마 설경 작업 공간](docs/古风/Work-1.jpg) | ![고전풍 테마 월야 작업 공간](docs/古风/Work-2.jpg) |
|                         Git                         |                    **Provider**                     |
|        ![고전풍 테마 Git](docs/古风/Git.jpg)        |     ![고전풍 테마 Provider](docs/古风/APIs.jpg)     |
|                      **모델**                       |                    **기능 센터**                    |
|      ![고전풍 테마 모델](docs/古风/Model.jpg)       |    ![고전풍 테마 기능 센터](docs/古风/Caps.jpg)     |
|                      **설정**                       |                                                     |
|      ![고전풍 테마 설정](docs/古风/Prefs.jpg)       |                                                     |

## 편집기 범위

Pi-Harness는 구문 강조, 줄 번호, 실행 취소/다시 실행, 찾기, 명시적 저장, 미저장 상태, 외부 변경 충돌 보호를 갖춘 경량 텍스트 편집기를 제공합니다. 대용량·바이너리·미디어·문서 파일은 읽기 전용으로 미리 봅니다.

Pi-Harness는 IDE가 아닙니다. LSP/IntelliSense, 시맨틱 리팩터링, 디버거, 태스크 러너, 통합 터미널, IDE 확장 호환성을 제공하지 않습니다.

## 아키텍처

Native Pi는 대체되지 않고 Pi-Harness 실행 아키텍처 내부에 포함됩니다.

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

데스크톱 경계는 `Vue Renderer → typed preload API → validated IPC → Main services → Pi compatibility layer → Native Pi SDK`입니다. Session은 <code>~/.pi/agent/sessions/</code>의 Pi CLI JSONL과 호환됩니다.

## Harness Control Plane

Runs, Trace, Replay, Run Tree, Run Compare, Policy, Budget, Checkpoints, Recovery, Permissions, Evaluation, Diagnostics, Regression, Artifacts가 출시되었습니다. 데이터는 실제 Pi Event, Session 및 명령 결과를 사용합니다.

## Multi-Agent 오케스트레이션

Agents, Teams, Tasks, Dependencies, Handoffs, Review Gates, Budget, Worktree 격리와 pause, resume, abort, retry, skip, reassign을 지원합니다. 각 Agent는 실제 Pi Session으로 실행됩니다.

## Pi Superset Contract

Pi-Harness는 Pi Coding Agent의 operational superset입니다. Native Pi의 Agent Runtime과 호환성을 유지하면서 관측성, 거버넌스, 오케스트레이션, 복구, 평가 및 시각적 엔지니어링 작업 공간을 추가합니다.

- Native Pi 기능을 의도적으로 줄이지 않으며 기술적으로 가능한 범위에서 Pi 네이티브 형식과 호환됩니다.
- Native Pi가 항상 실행 Runtime입니다. Agent Loop, Context, Compaction, Tools, Skills 또는 Extensions를 다시 구현하지 않습니다.
- Pi 네이티브 Session과 설정은 독립적으로 사용할 수 있고 Harness 전용 상태는 별도로 저장합니다.
- 기능은 기본적으로 추가 방식이며 Pi의 새 기능은 먼저 호환성 계층을 통해 노출합니다.
- capability detection, graceful degradation 및 best-effort forward compatibility를 사용합니다.

## Roadmap

- Session Tree 시각화와 더 깊은 Context / Queue inspectors
- 고급 Workspace 권한과 검증 통합
- Harness Profiles와 더 스마트한 Run Analysis

## 요구 사항

패키지 앱:

- macOS Apple Silicon, macOS Intel 또는 Windows x64
- 앱에서 설치하거나 복구할 수 있는 Pi Coding Agent

소스 개발:

- Node.js ≥ 22.19.0
- pnpm 9.12.1

## 개발

```bash
pnpm install --frozen-lockfile
pnpm dev
```

일반 확인 명령은 pnpm typecheck, pnpm lint, pnpm test, pnpm compile, pnpm test:e2e:only입니다. 비밀 값은 Renderer 번들에 포함되는 VITE_* 변수에 저장하지 마세요.

## 문서

- [변경 기록](CHANGELOG.md)

## 라이선스

Pi-Harness는 [GNU Affero General Public License v3.0 only](LICENSE)(AGPL-3.0-only)에 따라 배포됩니다.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## 저자

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
