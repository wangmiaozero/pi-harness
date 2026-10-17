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

<h3 align="center">Pi Coding Agent의 Operational Superset</h3>

<p align="center">
  <strong>Native Pi에 시각적 작업 공간, 실행 제어, 복구, 에이전트 팀을 더합니다.</strong>
</p>

<p align="center"><code>Pi Coding Agent ⊂ Pi-Harness</code></p>

<p align="center">
  <a href="#download"><strong>다운로드</strong></a> ·
  <a href="https://github.com/wangmiaozero/pi-harness-skin-starter"><strong>커스텀 스킨 만들기</strong></a> ·
  <a href="#screenshots">화면 미리보기</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="출시 버전" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

## 왜 Pi-Harness인가요?

Pi-Harness는 Pi Coding Agent를 macOS, Windows, Linux 데스크톱 작업 공간으로 가져옵니다. 대화, 프로젝트, 파일, Git, 모델, Skills를 한곳에서 관리하고 실행 확인, 예산 제어, 작업 복구, 에이전트 팀 협업 도구를 이용합니다.

에이전트는 Native Pi로 실행됩니다. Pi 세션, 설정, 도구, Skills, 확장 기능과의 호환성을 유지하며 데스크톱 앱 밖에서도 Pi를 계속 사용할 수 있습니다.

## Native Pi와 Pi-Harness

Pi-Harness는 Pi Coding Agent의 운영 기능 상위 집합입니다. Native Pi 기능을 기반으로 관측, 제어, 복구, 에이전트 조율, 시각적 작업 공간을 더합니다.

| 기능                     | Native Pi | Pi-Harness         |
| ------------------------ | --------- | ------------------ |
| Agent Runtime            | 지원      | Native Pi          |
| Agent Loop               | 지원      | Native Pi          |
| Sessions                 | 지원      | 지원 + 시각적 관리 |
| Context                  | 지원      | 지원 + 확인 화면   |
| Compaction               | 지원      | 지원 + 시각적 제어 |
| Steering                 | 지원      | 지원               |
| Follow-up                | 지원      | 지원               |
| Models                   | 지원      | 지원 + 관리 화면   |
| Thinking                 | 지원      | 지원 + 시각적 제어 |
| Tools                    | 지원      | 지원 + 선택과 정책 |
| Skills                   | 지원      | 지원 + 관리 화면   |
| Extensions               | 지원      | 지원 + 관리 화면   |
| Packages                 | 지원      | 지원 + 관리 화면   |
| MCP / Codemode           | 지원      | 지원 + 선택과 정책 |
| Runs                     | —         | 지원               |
| Trace                    | —         | 지원               |
| Replay                   | —         | 지원               |
| Run Compare              | —         | 지원               |
| Evaluation               | —         | 지원               |
| Policy                   | —         | 지원               |
| Budget                   | —         | 지원               |
| Checkpoints              | —         | 지원               |
| Recovery                 | —         | 지원               |
| Diagnostics              | —         | 지원               |
| Regression               | —         | 지원               |
| Artifacts                | —         | 지원               |
| Multi-Agent              | —         | 지원               |
| Task DAG                 | —         | 지원               |
| Handoff                  | —         | 지원               |
| Review Gates             | —         | 지원               |
| Worktree isolation       | —         | 지원               |
| Project architecture map | —         | 지원               |

## 기능

### 작업 공간, 파일, Git

독립 대화를 시작하거나 프로젝트를 열어 Pi 세션을 이어서 실행합니다. 스트리밍 응답, 사고 과정, 도구 호출, 이미지, 파일 변경을 확인하고 모델, 사고 수준, 도구를 선택하거나 대화 컨텍스트를 압축합니다. 작업 공간 도구에서 Harness와 에이전트를 열어도 대화와 보내지 않은 초안은 유지됩니다.

파일 탐색과 검색, 미디어·문서 미리보기, 구문 강조, 줄 번호, 찾기, 실행 취소/다시 실행, 명시적 저장, 외부 변경 충돌 보호를 갖춘 경량 텍스트 편집을 지원합니다. Git에서는 차이, 이력, 활동 그래프, 커밋, 선택형 AI 커밋 메시지, worktree를 이용합니다.

### Provider와 모델

프리셋이나 사용자 지정 주소로 Pi 호환 Provider를 설정하고 인증 정보, 지원 서비스의 모델 목록, 연결 테스트, 대화 모델 선택을 관리합니다. 지원하는 이미지 모델로 텍스트에서 이미지를 생성하거나 이미지를 편집하고 결과를 다운로드합니다.

### Skills, 확장 기능, 패키지, MCP

능력 센터에서 내장·로컬 Skills를 찾아 편집하고 Pi 패키지와 확장 기능을 관리합니다. 입력창에서 `@`를 입력해 설치된 Skill을 검색하고 호출합니다. 지원 패키지로 MCP를 연결하며 [Superpowers](https://github.com/obra/superpowers), [Odai](https://github.com/orziz/odai) 등의 선택형 기능을 원할 때 설치, 업데이트, 제거할 수 있습니다.

### Harness: 관측, 제어, 복구

Runs, Trace, Replay, 타임라인, 도구 활동을 확인합니다. 실행을 비교하고 Run Tree에서 분기와 재시도를 추적하며 토큰, 비용, 소요 시간, 결과물, 프로젝트 통계를 살펴봅니다.

도구 정책과 실행별 예산을 설정하고 체크포인트를 만들어 작업을 재개, 분기, 재시도합니다. 평가, 진단, 회귀 기준선으로 기록된 실행 근거에서 결과와 실패 원인을 확인합니다.

### 에이전트 팀과 작업 조율

재사용 가능한 팀과 템플릿으로 Pi 에이전트를 조율합니다. 작업의 의존성, 우선순위, 담당자를 설정하고 수동·순차·병렬 실행, 결과와 산출물 인계, 검토 관문을 이용합니다. worktree로 변경을 분리하고 예산, 충돌 알림, 일시 정지, 재개, 중단, 재시도, 건너뛰기, 재할당으로 작업을 관리합니다.

### 로컬 대화 기록

Claude Code, Codex(데스크톱과 보관된 대화 포함), Cursor, Cursor Agent, Gemini CLI, OpenCode, Pi 기록을 함께 봅니다. 검색, 출처·프로젝트·날짜 범위 필터와 사용자 지정 기록 폴더를 지원합니다.

원본 대화는 읽기 전용입니다. 인계 미리보기와 다음 지시를 확인·편집한 뒤 같은 프로젝트의 새 Pi 대화에서 이어갈 수 있습니다. 기록 보기, 로컬 미리보기, 스캔 재시도는 모델 토큰을 소비하지 않습니다. 선택형 AI 요약은 직접 요청할 때만 설정된 모델을 사용합니다.

### 프로젝트 아키텍처

작업 공간의 Architecture에서 모듈, 의존성, 진입점, 소스 참조를 탐색합니다. 패키지 필터, 모듈 집중 보기, 맵 페이지 전환, 확대·축소, 전체 화면을 지원합니다. 분석 스냅샷을 저장하고 소스 변경 알림을 확인하며 JSON, 오프라인 HTML, 현재 화면의 PNG를 내보냅니다.

로컬 분석은 모델 토큰을 사용하지 않으며 AI 설명은 선택 사항입니다. JavaScript, TypeScript, Vue의 가져오기 관계를 로컬에서 분석하고 다른 지원 언어는 파일 단위 색인을 제공합니다. 분석 범위와 한계도 표시합니다.

### 테마와 커스텀 스킨

클래식 색상, Ming, Starship Cockpit, macOS 27 배경, 가져온 커스텀 스킨을 선택합니다. 새 설치는 다크 테마로 시작합니다. 대화 표시 이름, 앱 아이콘, 로컬 배경 이미지, 창·화면 글로우, 입력창 불꽃 효과를 설정합니다. 환경 검사 중 시작 애니메이션이 표시되며 마스코트 없는 빌드도 일반 모양 설정을 유지합니다.

### 환경과 앱 설정

Node.js, npm, PATH, Pi Coding Agent, 현재 설정을 확인합니다. 지원 환경에서 Pi를 설치, 업데이트, 복구하고 환경 진단, 설정 백업, 앱 업데이트 확인을 이용합니다. 인터페이스는 여덟 언어를 지원합니다.

## 커스텀 스킨 만들기

[Pi-Harness 커스텀 스킨 스타터](https://github.com/wangmiaozero/pi-harness-skin-starter)로 원하는 스타일을 만들 수 있습니다.

1. 스타터 저장소를 템플릿으로 사용하거나 다운로드합니다.
2. 코딩 에이전트로 열고 포함된 프롬프트에 원하는 스타일을 설명합니다.
3. 완성된 프로젝트를 **설정 → 테마 → 스킨 가져오기**에서 가져옵니다.

다국어 스타터는 색상, 미리보기, 배경화면, 선택형 캐릭터 이미지 안내를 제공합니다. 스킨은 별도 저장소에서 독립적으로 업데이트하고 공유할 수 있습니다.

<a id="screenshots"></a>

## 화면 미리보기

기능 화면은 테마별로 분류했습니다. 추가 화면은 [전체 스크린샷 목록](docs/README.md)에서 확인하세요.

### 클래식 테마

#### 작업 공간

[![작업 공간](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)

<details>
<summary>Git · Provider와 모델 · 능력 센터 · Harness · 프로젝트 아키텍처</summary>

#### Git

[![Git](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Git.png)

#### Provider와 모델

[![Provider와 모델](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/Provider%E4%B8%8E%E6%A8%A1%E5%9E%8B-1.png)

#### 능력 센터

[![능력 센터](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%83%BD%E5%8A%9B%E4%B8%AD%E5%BF%83-1.png)

#### Harness

[![Harness](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-1.png)

#### 프로젝트 아키텍처

[![프로젝트 아키텍처](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-1.png)

</details>

### Ming 기능 화면

<details>
<summary>일반 설정 · 테마와 스킨</summary>

#### 일반 설정

[![일반 설정](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E9%80%9A%E7%94%A8%E8%AE%BE%E7%BD%AE.png)

#### 테마와 스킨

[![테마와 스킨](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E5%A4%A7%E6%98%8E/%E4%B8%BB%E9%A2%98%E7%9A%AE%E8%82%A4%E5%BA%93.png)

</details>

### 테마 갤러리

<details>
<summary>Ming · 눈 속의 관리 · Ming · 눈밤의 피리 연주자 · Ming · 달빛의 서생 · Starship Cockpit · macOS 27 · Liquid Ether</summary>

#### Ming · 눈 속의 관리

[![Ming · 눈 속의 관리](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A2%83%E6%9C%9D%E8%87%A3.png)

#### Ming · 눈밤의 피리 연주자

[![Ming · 눈밤의 피리 연주자](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E9%9B%AA%E5%A4%9C%E7%AC%9B%E5%A7%AC.png)

#### Ming · 달빛의 서생

[![Ming · 달빛의 서생](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E5%A4%A7%E6%98%8E/%E6%9C%88%E5%9F%8E%E4%B9%A6%E5%A7%AC.png)

#### Starship Cockpit

[![Starship Cockpit](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E6%98%9F%E8%88%B0/%E9%9C%9C%E6%98%9F%E9%A2%86%E8%88%AA.png)

#### macOS 27 · Liquid Ether

[![macOS 27 · Liquid Ether](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/macOS%2027/Liquid%20Ether.png)

</details>

<a id="download"></a>

## 다운로드

[GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases)에서 출시된 설치 파일 중 플랫폼에 맞는 파일을 다운로드하세요.

| 플랫폼              | 설치 파일                      |
| ------------------- | ------------------------------ |
| macOS Apple Silicon | `.dmg` · `arm64`               |
| macOS Intel         | `.dmg` · `x64`                 |
| Windows x64         | `.exe` · Windows 설치 프로그램 |
| Linux x64           | `.AppImage`                    |

패키지 사용자는 저장소를 복제하거나 pnpm을 설치할 필요가 없습니다. 지원 환경에서는 앱에서 Pi와 실행 환경을 설정할 수 있습니다.

> macOS 커뮤니티 빌드는 서명되지 않았을 수 있습니다. 첫 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 사용하세요.

## 시작하기

1. Pi-Harness를 실행하고 개요에서 환경을 확인합니다.
2. Provider를 설정하고 연결을 테스트한 뒤 모델을 선택합니다.
3. 독립 대화를 시작하거나 프로젝트를 엽니다.
4. Pi 세션을 시작하거나 이어서 실행하며 대화, 파일, Git을 사용합니다.
5. 실행 제어나 팀 협업에는 작업 공간 도구를 엽니다.

## 요구 사항

macOS Apple Silicon, macOS Intel, Windows x64, Linux x64를 지원합니다. 지원 환경에서는 앱에서 Pi Coding Agent를 설치하거나 복구할 수 있습니다. 소스에서 실행하려면 Node.js ≥ 22.22.2와 pnpm 9.12.1이 필요합니다.

## 문서

- [스크린샷 분류 목록](docs/README.md)
- [변경 기록](CHANGELOG.md)

## 감사의 말과 저자

공식 [Pi Coding Agent와 Pi Agent Harness](https://github.com/earendil-works/pi)를 중심으로 만들었습니다.

제작·유지 관리: [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

### PR 기여자

[PR #8](https://github.com/wangmiaozero/pi-harness/pull/8)에 기여해 주신 [@HenryArch](https://github.com/HenryArch)님께 감사드립니다.

## 라이선스

Pi-Harness는 [GNU Affero General Public License v3.0 only](LICENSE)(`AGPL-3.0-only`)로 배포됩니다.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
