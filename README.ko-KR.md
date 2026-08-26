# Pi-Harness

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
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja-JP.md">日本語</a> ·
  <a href="README.ko-KR.md">한국어</a> ·
  <a href="README.ru-RU.md">Русский</a> ·
  <a href="README.fr-FR.md">Français</a> ·
  <a href="README.de-DE.md">Deutsch</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1"><img alt="release v1.1.1" src="https://img.shields.io/badge/release-v1.1.1-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
</p>

![환경 상태, 활성 모델, 빠른 작업을 보여 주는 Pi-Harness 개요](docs/概览.jpg)

## 왜 Pi-Harness인가요?

### Pi 채팅 UI 그 이상

일반 데스크톱 클라이언트는 Pi를 열고 채팅을 시작합니다. Pi-Harness는 실행 환경을 준비하고, Provider와 모델을 관리하고, Skills와 Pi 패키지를 설치하며, 세션·파일·Git을 하나의 프로젝트 작업 공간에 연결합니다.

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

[GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1)에서 Pi-Harness v1.1.1을 다운로드하세요.

| 플랫폼              | 설치 파일                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [Pi-Harness-1.1.1-arm64.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1-arm64.dmg) |
| macOS Intel         | [Pi-Harness-1.1.1.dmg](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness-1.1.1.dmg)             |
| Windows x64         | [Pi-Harness.Setup.1.1.1.exe](https://github.com/wangmiaozero/pi-harness/releases/download/v1.1.1/Pi-Harness.Setup.1.1.1.exe) |

> macOS 커뮤니티 빌드는 서명되지 않았을 수 있습니다. 첫 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 사용하세요. 자세한 내용은 [v1.1.1 릴리스 노트](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.1.1)를 참고하세요.

패키지 사용자는 저장소를 clone하거나 pnpm을 설치할 필요가 없습니다. Pi-Harness는 지원되는 환경에서 Node.js, npm, PATH, Pi Coding Agent를 감지하고 설치하거나 복구할 수 있습니다.

## 할 수 있는 일

- **Workspace:** 실제 프로젝트에서 Pi 세션을 시작하거나 이어서 실행하고, 스트리밍 응답, Thinking, Tool Call, 파일, Git을 함께 확인합니다.
- **Providers & Models:** Pi 호환 프리셋 또는 사용자 지정 API를 구성하고, 가능한 경우 모델 목록을 가져오며, 연결 테스트 후 활성 모델을 선택합니다.
- **Skills, Packages & MCP:** 로컬 Skills, 신뢰할 수 있는 추천 항목, 내장 컬렉션, Pi 패키지를 관리하고 지원되는 패키지로 MCP를 연결합니다.
- **Environment:** Node.js, npm, PATH, Pi를 감지하고 일반적인 설치 문제를 데스크톱 앱에서 해결합니다.
- **Files & Git:** 파일을 탐색·업로드하고, 충돌 보호가 있는 경량 편집기를 사용하며, Git Diff와 Worktree를 확인합니다.
- **Diagnostics & Security:** 환경과 기능 상태를 진단합니다. 자격 증명은 Keychain 또는 Electron safeStorage에 보관되고 복사한 진단 정보는 정리됩니다.

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

### 1. 준비 상태 확인

![개요](docs/概览.jpg)

### 2. 실제 프로젝트에서 Pi 실행

|            프로젝트 세션             |            파일과 경량 편집            |
| :----------------------------------: | :------------------------------------: |
| ![작업 공간 세션](docs/工作区-1.jpg) | ![작업 공간 편집기](docs/工作区-2.jpg) |

### 3. Provider와 모델 구성

|              Provider               |            Provider 설정            |
| :---------------------------------: | :---------------------------------: |
| ![Provider 목록](docs/提供商-1.jpg) | ![Provider 상세](docs/提供商-2.jpg) |
|              **모델**               |            **모델 설정**            |
|    ![모델 목록](docs/模型-1.jpg)    |    ![모델 상세](docs/模型-2.jpg)    |

### 4. Skills와 패키지로 Pi 확장

|           설치된 Skills           |      내장 컬렉션과 패키지       |
| :-------------------------------: | :-----------------------------: |
| ![설치된 Skills](docs/技能-1.jpg) | ![Skills 마켓](docs/技能-2.jpg) |

### 5. 작업 공간 꾸미기

![외형과 마스코트 설정](docs/设置.jpg)

## 편집기 범위

Pi-Harness는 구문 강조, 줄 번호, 실행 취소/다시 실행, 찾기, 명시적 저장, 미저장 상태, 외부 변경 충돌 보호를 갖춘 경량 텍스트 편집기를 제공합니다. 대용량·바이너리·미디어·문서 파일은 읽기 전용으로 미리 봅니다.

Pi-Harness는 IDE가 아닙니다. LSP/IntelliSense, 시맨틱 리팩터링, 디버거, 태스크 러너, 통합 터미널, IDE 확장 호환성을 제공하지 않습니다. [경량 코드 편집기 범위](docs/lightweight-code-editor.md)를 참고하세요.

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

Pi Coding Agent는 유일한 Agent Runtime입니다. 구현 세부 사항은 [아키텍처](docs/architecture.md), [Capability Layer](docs/capability-layer.md), [보안 모델](docs/security.md)을 참고하세요.

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

- [아키텍처](docs/architecture.md)
- [보안](docs/security.md)
- [테스트](docs/testing.md)
- [애플리케이션 업데이트](docs/application-updates.md)
- [Pi 설치](docs/pi-installation.md)
- [Capability Layer](docs/capability-layer.md)
- [Package 및 Skill 수명 주기](docs/package-lifecycle.md)
- [변경 기록](CHANGELOG.md)
- [기여 안내](CONTRIBUTING.md)

## 라이선스

Pi-Harness는 [GNU Affero General Public License v3.0 only](LICENSE)(AGPL-3.0-only)에 따라 배포됩니다.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).

## 저자

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)
