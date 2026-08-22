# Pi-Harness

<p align="center">
  <img src="build/icon.png" width="96" alt="Pi-Harness" />
</p>

<p align="center">
  <strong><a href="https://github.com/badlogic/pi-mono">Pi Coding Agent</a>를 위한 로컬 우선 데스크톱 제어판 및 네이티브 작업 공간</strong><br />
  Pi 구성 · 프로젝트 세션 실행 · 로컬 파일 확인 및 편집
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

Pi-Harness는 Pi 제공자, 모델, 자격 증명, 스킬, 원본 구성, 백업 및 진단을 관리하고 네이티브 작업 공간에서 실제 프로젝트에 연결된 Pi Agent 세션을 실행합니다. 세션은 `~/.pi/agent/sessions/`의 Pi CLI JSONL과 호환되며 pi-web, Next.js 서버 또는 iframe을 내장하지 않습니다.

비밀 값은 Renderer에 평문으로 노출되지 않습니다. macOS는 시스템 키체인에 저장하고, Windows / Linux는 Electron `safeStorage`를 사용합니다. 알 수 없는 Pi 필드는 그대로 유지됩니다.

## v1.0.9 주요 변경 사항

- Assistant 응답은 명시적 태그/프로토콜 허용 목록을 통해 안전한 스트리밍 Markdown으로 렌더링됩니다.
- Tool Result는 기본적으로 접혀 있으며 제한된 높이의 스크롤 패널에서 펼쳐집니다.
- 전역 마스코트는 기본적으로 꺼져 있으며, 새로운 오피스 및 메이드 스타일을 포함한 6개 스타일을 선택할 수 있습니다.

## 화면 미리보기

|                 개요                 |            설정 — 마스코트             |
| :----------------------------------: | :------------------------------------: |
|        ![개요](docs/概览.jpg)        |    ![마스코트 설정](docs/设置.jpg)     |
|         **작업 공간 — 세션**         |         **작업 공간 — 편집기**         |
| ![작업 공간 세션](docs/工作区-1.jpg) | ![작업 공간 편집기](docs/工作区-2.jpg) |
|          **제공자 — 목록**           |           **제공자 — 상세**            |
|  ![제공자 목록](docs/提供商-1.jpg)   |   ![제공자 상세](docs/提供商-2.jpg)    |
|           **모델 — 목록**            |            **모델 — 상세**             |
|    ![모델 목록](docs/模型-1.jpg)     |     ![모델 상세](docs/模型-2.jpg)      |
|          **스킬 — 설치됨**           |            **스킬 — 마켓**             |
|   ![설치된 스킬](docs/技能-1.jpg)    |     ![스킬 마켓](docs/技能-2.jpg)      |

## 기능

| 모듈          | 설명                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| **개요**      | 활성 모델, 환경 상태, Node.js/Pi 설치 안내 및 Pi 원클릭 설치                                       |
| **작업 공간** | 네이티브 프로젝트와 Pi Session, 스트리밍 대화, Thinking / Tool Call, 경량 편집, Git Diff, Worktree |
| **제공자**    | 검색 가능한 Pi 호환 프리셋; Provider ≠ Protocol ≠ Model; Keychain / `safeStorage` 자격 증명        |
| **모델**      | 프리셋 또는 사용자 지정 모델 ID, 기능 메타데이터, 활성 모델 선택, 쓰기 후 검증                     |
| **스킬**      | `SKILL.md` 생성 / 가져오기 / 편집 / 검증; 경로 루트 제약                                           |
| **구성**      | CodeMirror로 `models.json` / `settings.json` 편집; 서식 지정 및 파일 관리자에서 표시               |
| **진단**      | 환경 보고서; 복사 시 민감 정보 제거 (`apiKey` / `token` / `secret` 등)                             |
| **설정**      | 简体中文 / English UI, 시스템/다크/라이트 테마, 밀도, 도구 프리셋, 복원 동작, 백업, 마스코트       |

안정성:

- 쓰기 전 자동 백업; 원자적 쓰기
- 외부 변경 감지(mtime), Reload / Compare / Overwrite
- 패키지 빌드는 백그라운드에서 업데이트를 확인·다운로드하고, 종료 시 또는 **설치 후 재시작**으로 설치합니다
- 데스크톱 전용: 임의 외부 이동을 차단하고 고정된 Node.js 공식 다운로드만 허용

## 경량 편집기 범위

작업 공간은 지연 구문 강조, 줄 번호, 실행 취소/다시 실행, 찾기, 명시적 저장, 미저장 표시 및 외부 변경 충돌 보호를 제공하며 읽을 수 있는 텍스트 파일을 편집합니다. 알 수 없는 텍스트 확장자는 일반 텍스트로 열리고, 대용량·바이너리·미디어·문서 파일은 읽기 전용 미리 보기를 사용합니다.

Pi-Harness는 범용 IDE가 아닙니다. LSP/IntelliSense, 시맨틱 리팩터링, 디버거, 태스크 러너, 통합 터미널 또는 IDE 확장 호환성을 제공하지 않습니다. [경량 편집기 설계 범위](docs/lightweight-code-editor.md)를 참고하세요.

## 요구 사항

- Node.js ≥ 22 (의존성 설치 시 강제)
- pnpm `9.12.1` (`packageManager` 필드 참고)
- [Pi Coding Agent](https://github.com/badlogic/pi-mono) 설치, 또는 앱에서 설치 / 업데이트

## 빠른 시작

```bash
pnpm install
pnpm dev
```

로컬 Pi가 없으면 설정에서 구성 디렉터리를 `fixtures/mock-pi/`로 지정하거나:

```bash
cp .env.example .env
# PI_HARNESS_PI_CONFIG_DIR=/absolute/path/to/fixtures/mock-pi
```

비밀 값을 `VITE_*`에 넣지 마세요. Renderer 번들에 포함됩니다.

## 명령

| 명령             | 설명                                                  |
| ---------------- | ----------------------------------------------------- |
| `pnpm typecheck` | Vue / TypeScript 타입 검사                            |
| `pnpm lint`      | ESLint                                                |
| `pnpm test`      | Vitest 단위 테스트                                    |
| `pnpm test:e2e`  | 컴파일 후 Playwright Electron smoke 실행              |
| `pnpm compile`   | Vite로 `out/`에 컴파일 (설치 패키지 없음)             |
| `pnpm build`     | 컴파일 후 macOS / Windows / Linux 패키지 → `release/` |
| `pnpm build:mac` | macOS만                                               |

## 아키텍처

```
Renderer (Vue 3)  --typed IPC-->  Preload  -->  Main
                                                ├─ AgentRuntime      Pi 세션 / 스트리밍 / 도구 이벤트
                                                ├─ Workspace         프로젝트 / 파일 / 경량 편집기 / Git
                                                ├─ PiConfigService   원자적 쓰기 / mtime 충돌
                                                ├─ Provider / Model / Skills / Backup / Diagnostics
                                                └─ SecretStore       Keychain / safeStorage
```

Domain은 Adapter를 통해 Pi 네이티브 JSON과 분리됩니다. 알 수 없는 필드는 그대로 전달되며, 특정 모델 이름에 로직을 고정하지 않습니다.

## 프로젝트 문서

- [변경 기록](CHANGELOG.md)
- [애플리케이션 업데이트 및 릴리스 산출물](docs/application-updates.md)
- [Pi 설치 및 Node.js 필수 조건](docs/pi-installation.md)
- [경량 코드 편집기 범위](docs/lightweight-code-editor.md)
- [마스코트 디자인 및 런타임 규칙](docs/mascot-design.md)

## 저자

[wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com) · [github.com/wangmiaozero/pi-harness](https://github.com/wangmiaozero/pi-harness)

## 라이선스

Pi-Harness는 [GNU Affero General Public License v3.0 only](./LICENSE)(`AGPL-3.0-only`)에 따라 배포되는 자유 소프트웨어입니다. 라이선스 조건에 따라 사용, 수정 및 재배포할 수 있습니다. 수정 버전을 네트워크를 통해 제공하는 경우 AGPL v3에 따라 해당 사용자에게 대응 소스 코드를 제공해야 합니다.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
