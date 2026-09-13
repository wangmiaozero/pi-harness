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
  <strong><a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a>를 위한 올인원 데스크톱 작업 공간</strong><br />
  Pi 구성 · 에이전트 실행 · 모델, Skills, 패키지, 프로젝트 관리
</p>

<p align="center">
  Pi Coding Agent를 구성하고 실행하며 확장하는 데 필요한 기능을 하나의 네이티브 데스크톱 앱에 모았습니다.
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.5.0"><img alt="release v1.5.0" src="https://img.shields.io/badge/release-v1.5.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

## 왜 Pi-Harness인가요?

### Pi 채팅 UI 그 이상

일반 데스크톱 클라이언트는 Pi를 열고 채팅을 시작합니다. Pi-Harness는 환경 설정, Provider, 모델, Skills, 패키지, 프로젝트, 파일, Git을 하나의 데스크톱 작업 공간에 모읍니다.

```text
일반 데스크톱 클라이언트              Pi-Harness

Pi → Chat                             Environment
                                      + Providers / Models
                                      + Skills / Packages / MCP adapters
                                      + Workspace / Sessions / Files / Git
                                      ↓
                                      Pi Coding Agent
```

Pi-Harness는 웹 UI 래퍼가 아닙니다. pi-web, Next.js 서버, iframe을 포함하지 않으며 두 번째 Agent Runtime을 만들지 않습니다. Pi Coding Agent가 유일한 Agent Runtime이고, 세션은 ~/.pi/agent/sessions/의 Pi CLI JSONL과 호환됩니다.

**Pi 구성. Pi 실행. Pi 확장.**

## 다운로드

[GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.5.0)에서 Pi-Harness v1.5.0을 다운로드하세요.

| 플랫폼              | 설치 파일                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.5.0-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.5.0/Pi-Harness-1.5.0-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.5.0.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.5.0/Pi-Harness-1.5.0.dmg)             |
| Windows x64         | [Pi-Harness-Setup-1.5.0.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.5.0/Pi-Harness-Setup-1.5.0.exe) |
| Linux x64           | [Pi-Harness-1.5.0.AppImage](https://github.com/wangmiaozero/pi-harness/releases/download/v1.5.0/Pi-Harness-1.5.0.AppImage)   |

> macOS 커뮤니티 빌드는 서명되지 않았을 수 있습니다. 첫 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 사용하세요. 자세한 내용은 [v1.5.0 릴리스 노트](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.5.0)를 참고하세요.

패키지 사용자는 저장소를 clone하거나 pnpm을 설치할 필요가 없습니다. Pi-Harness는 지원되는 환경에서 Node.js, npm, PATH, Pi Coding Agent를 감지하고 설치하거나 복구할 수 있습니다.

## 할 수 있는 일

- **Workspace:** 실제 프로젝트에서 Pi 세션을 시작하거나 이어서 실행하고, 스트리밍 응답, Thinking, Tool Call, 파일, Git을 함께 확인합니다.
- **Providers & Models:** Pi 호환 Provider와 모델을 구성하고 연결 테스트 후 활성 모델을 선택합니다.
- **Skills, Packages & MCP:** 로컬 Skills와 Pi 패키지를 관리하고 지원되는 패키지로 MCP를 연결합니다.
- **Environment:** Node.js, npm, PATH, Pi를 감지하고 일반적인 설치 문제를 데스크톱 앱에서 해결합니다.
- **Files & Git:** 파일을 탐색·업로드하고, 충돌 보호가 있는 경량 편집기를 사용하며, Git Diff와 Worktree를 확인합니다.
- **Diagnostics:** 애플리케이션과 환경 상태를 확인합니다.

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

|                    작업 공간 (설경)                     |                     작업 공간 (월야)                      |
| :-----------------------------------------------------: | :-------------------------------------------------------: |
| ![고전풍 테마 설경 작업 공간](docs/古风/Work-1.jpg)     | ![고전풍 테마 월야 작업 공간](docs/古风/Work-2.jpg)       |
|                          Git                            |                       **Provider**                        |
|     ![고전풍 테마 Git](docs/古风/Git.jpg)               | ![고전풍 테마 Provider](docs/古风/APIs.jpg)               |
|                        **모델**                         |                      **기능 센터**                        |
|  ![고전풍 테마 모델](docs/古风/Model.jpg)               | ![고전풍 테마 기능 센터](docs/古风/Caps.jpg)              |
|                        **설정**                         |                                                           |
|  ![고전풍 테마 설정](docs/古风/Prefs.jpg)               |                                                           |

## 편집기 범위

Pi-Harness는 구문 강조, 줄 번호, 실행 취소/다시 실행, 찾기, 명시적 저장, 미저장 상태, 외부 변경 충돌 보호를 갖춘 경량 텍스트 편집기를 제공합니다. 대용량·바이너리·미디어·문서 파일은 읽기 전용으로 미리 봅니다.

Pi-Harness는 IDE가 아닙니다. LSP/IntelliSense, 시맨틱 리팩터링, 디버거, 태스크 러너, 통합 터미널, IDE 확장 호환성을 제공하지 않습니다.

## 아키텍처

```text
                                Pi-Harness

              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       Control Plane          Workspace          Capability Layer
       Pi 관리                Pi 사용             Pi 확장

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

Pi Coding Agent는 유일한 Agent Runtime입니다.

## 요구 사항

패키지 앱:

- macOS Apple Silicon, macOS Intel 또는 Windows x64
- 앱에서 설치하거나 복구할 수 있는 Pi Coding Agent

소스 개발:

- Node.js ≥ 22
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
