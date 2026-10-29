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
  <a href="#features">기능</a> ·
  <a href="#agent-settings">에이전트 설정</a> ·
  <a href="#harness-plugins">Harness Plugins</a> ·
  <a href="#documentation">문서</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases"><img alt="출시 버전" src="https://img.shields.io/github/v/release/wangmiaozero/pi-harness?style=flat-square" /></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="https://github.com/wangmiaozero/pi-harness/actions/workflows/ci.yml"><img alt="CI (main)" src="https://github.com/wangmiaozero/pi-harness/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

<a id="product-preview"></a>

## 화면 미리보기

데모 워크스페이스로 현재 화면을 소개합니다. 이미지를 클릭하면 확대할 수 있습니다.

### 워크스페이스

[![워크스페이스](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA.png)

### Harness

[![Harness](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-2.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E5%85%B7Harness-2.png)

### 멀티 에이전트

실행 전 구성 예시입니다. 에이전트는 대기 중이며 작업은 아직 실행되지 않았습니다.

[![멀티 에이전트](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%A4%9A%E6%99%BA%E8%83%BD%E4%BD%93-%E5%9B%A2%E9%98%9F.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%A4%9A%E6%99%BA%E8%83%BD%E4%BD%93-%E5%9B%A2%E9%98%9F.png)

[![멀티 에이전트](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%A4%9A%E6%99%BA%E8%83%BD%E4%BD%93-%E4%BB%BB%E5%8A%A1%E4%BE%9D%E8%B5%96.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%A4%9A%E6%99%BA%E8%83%BD%E4%BD%93-%E4%BB%BB%E5%8A%A1%E4%BE%9D%E8%B5%96.png)

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

<a id="features"></a>

## 기능

### 작업 공간, 파일, Git

독립 대화를 시작하거나 프로젝트를 열어 Pi 세션을 이어서 실행합니다. 스트리밍 응답, 사고 과정, 도구 호출, 이미지, 파일 변경을 확인하고 모델, 사고 수준, 도구를 선택하거나 대화 컨텍스트를 압축합니다. 작업 공간 도구에서 Harness와 에이전트를 열어도 대화와 보내지 않은 초안은 유지됩니다.

파일 탐색과 검색, 미디어·문서 미리보기, 구문 강조, 줄 번호, 찾기, 실행 취소/다시 실행, 명시적 저장, 외부 변경 충돌 보호를 갖춘 경량 텍스트 편집을 지원합니다. Git에서는 차이, 이력, 활동 그래프, 커밋, 선택형 AI 커밋 메시지, worktree를 이용합니다.

### Provider와 모델

프리셋이나 사용자 지정 주소로 Pi 호환 Provider를 설정하고 인증 정보, 지원 서비스의 모델 목록, 연결 테스트, 대화 모델 선택을 관리합니다. 지원하는 이미지 모델로 텍스트에서 이미지를 생성하거나 이미지를 편집하고 결과를 다운로드합니다.

### Skills, 확장 기능, 패키지, MCP

능력 센터에서 내장·로컬 Skills를 찾아 편집하고 Pi 패키지와 확장 기능을 관리합니다. 입력창에서 `@`를 입력해 설치된 Skill을 검색하고 호출합니다. MCP 서버는 **설정 → MCP**에서 관리합니다. [Superpowers](https://github.com/obra/superpowers), [Odai](https://github.com/orziz/odai) 등의 선택형 기능을 원할 때 설치, 업데이트, 제거할 수 있습니다.

<a id="desktop-companion"></a>

### 데스크톱 동반자

**설정 → 데스크톱 펫**에서 BigFish를 활성화하면 생각 중, 도구 실행, 입력 대기, 작업 완료 상태를 데스크톱에서 확인할 수 있습니다. 기본적으로 꺼져 있으며 메인 창을 최소화해도 표시할 수 있습니다.

대기 중에는 검색 가능한 우클릭 메뉴에서 101가지 동작을 선택할 수 있습니다. 작업 중에는 수동 상호작용을 멈추고 드래그해도 작업 애니메이션을 유지합니다. 로컬 펫 팩을 가져오고 크기, 불투명도, 말풍선 설정을 슬라이더로 조절할 수 있습니다.

[![펫 설정 및 슬라이더](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%A1%8C%E5%AE%A0%E8%AE%BE%E7%BD%AE.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%A1%8C%E5%AE%A0%E8%AE%BE%E7%BD%AE.png)

<a id="agent-settings"></a>

### 에이전트 설정

**v2.2.10 이상에서 사용할 수 있습니다.** **AI, 실시간 음성, 단축키, 지침, MCP, 하위 에이전트, 원격 호스트**의 일곱 설정 페이지를 제공합니다. 설치 파일의 지원 여부는 해당 버전의 릴리스 노트를 확인하세요.

**설정 → AI**에서 기본 사고 수준, 자동 압축, 오류 재시도와 작업 공간 기본 설정을 조정합니다. 단축키 설정에서는 명령 팔레트, 설정 열기, 새 세션, 탭 닫기의 키 조합을 기록하거나 기본값으로 복원합니다. **설정 → 지침**에서 전역 또는 프로젝트 지침을 편집합니다.

**설정 → 하위 에이전트**에서 역할, 지침, 모델, 사고 수준과 도구를 지정한 재사용 템플릿을 만듭니다. 공유 작업 공간이나 격리된 worktree를 선택한 뒤 작업을 시작하거나 팀에서 재사용합니다.

<a id="realtime-voice"></a>

### 작업 공간 실시간 음성

**설정 → 실시간 음성**에서 **OpenAI Realtime, Gemini Live 또는 Codex Live**를 설정한 뒤 입력창 옆의 파형 버튼으로 시작합니다. 지원 서비스 계정이나 별도 API 키를 사용할 수 있습니다. Codex Live는 Pi의 기존 Codex 로그인을 사용합니다. 이용 가능 여부와 요금은 계정에 따라 다릅니다.

통화 전에 대상 대화를 확인합니다. 최근 대화 공유는 기본적으로 꺼져 있습니다. 켜면 최근 여섯 개의 일반 텍스트 메시지만 공유하며 첨부 파일과 도구 결과는 제외합니다. 다른 페이지로 이동해도 플로팅 컨트롤에서 음소거, 통화 종료와 전사 확인이 가능합니다. 음성 작업 요청은 확인한 뒤 작업 대화로 전송합니다.

<a id="mcp-marketplace"></a>

### MCP 서버와 마켓

**설정 → MCP**에서 로컬 명령 또는 HTTP 서버를 추가합니다. **전체 / 전역 / 프로젝트**로 필터링하고 프로젝트를 선택해 각 범위의 서버를 편집하거나 활성화합니다. 다른 도구의 설정을 스캔하고 검토한 뒤 가져올 수도 있습니다.

마켓에는 Memory, Context7, Playwright, Filesystem, GitHub 등 **15개의 내장 서버 템플릿**이 있으며 공식 MCP 레지스트리 검색과 페이지 이동도 지원합니다. 저장 전에 설정과 대상 범위를 확인합니다. 템플릿은 필요에 따라 설치하며 모두 활성화되어 있는 것은 아닙니다. 가져온 항목과 공식 레지스트리 항목은 비활성 상태로 저장되므로 설정을 완료한 뒤 활성화하세요.

<a id="remote-hosts"></a>

### 원격 호스트

**설정 → 원격 호스트**에서 **pi-host**를 실행하는 호스트의 주소와 페어링 토큰을 입력합니다. 연결과 해제, 프로젝트 및 세션 탐색, 대화 조회, 프롬프트 전송과 승인 요청 처리가 가능합니다. 원격 서비스가 미리 실행되어 있고 연결 가능해야 합니다.

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

### 데스크톱 동반자

[![우클릭 메뉴](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%A1%8C%E5%AE%A0%E8%8F%9C%E5%8D%95.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%A1%8C%E5%AE%A0%E8%8F%9C%E5%8D%95.png)

[![동작 검색 및 선택](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%A1%8C%E5%AE%A0%E5%8A%A8%E4%BD%9C.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%A1%8C%E5%AE%A0%E5%8A%A8%E4%BD%9C.png)

### 대화 기록

[![대화 기록](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E4%BC%9A%E8%AF%9D%E5%8E%86%E5%8F%B2.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E4%BC%9A%E8%AF%9D%E5%8E%86%E5%8F%B2.png)

### 세션 정리

[![세션 정리](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E4%BC%9A%E8%AF%9D%E6%B8%85%E7%90%86.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E4%BC%9A%E8%AF%9D%E6%B8%85%E7%90%86.png)

### 클래식 테마

#### 가벼운 파일 편집

[![가벼운 파일 편집](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E4%BB%A3%E7%A0%81%E7%BC%96%E8%BE%91.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E4%BB%A3%E7%A0%81%E7%BC%96%E8%BE%91.png)

<details>
<summary>에이전트 설정 · 작업 공간 음성 · MCP</summary>

#### 작업 공간 음성

통화 전 설정 및 준비 화면:

[![작업 공간 음성](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA%E8%AF%AD%E9%9F%B3.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%B7%A5%E4%BD%9C%E5%8C%BA%E8%AF%AD%E9%9F%B3.png)

#### MCP 마켓

[![MCP 마켓](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/MCP%E5%B8%82%E5%9C%BA.png)](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/MCP%E5%B8%82%E5%9C%BA.png)

| 설정 페이지           | 스크린샷                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| AI 기본 설정          | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/AI.png)                                   |
| 실시간 음성           | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%AE%9E%E6%97%B6%E8%AF%AD%E9%9F%B3.png) |
| 단축키                | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%BF%AB%E6%8D%B7%E9%94%AE.png)          |
| 전역 및 프로젝트 지침 | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E6%8C%87%E4%BB%A4.png)                   |
| MCP 서버              | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/MCP%E6%9C%8D%E5%8A%A1%E5%99%A8.png)       |
| 하위 에이전트         | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E5%AD%90%E6%99%BA%E8%83%BD%E4%BD%93.png) |
| 원격 호스트 페어링    | [보기](docs/%E5%8A%9F%E8%83%BD%E7%95%8C%E9%9D%A2/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/%E8%BF%9C%E7%A8%8B%E4%B8%BB%E6%9C%BA.png) |

</details>

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

[![macOS 27 · Liquid Ether](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/macos27.png)](docs/%E4%B8%BB%E9%A2%98%E5%B1%95%E7%A4%BA/%E7%BB%8F%E5%85%B8%E4%B8%BB%E9%A2%98/macos27.png)

</details>

<a id="harness-plugins"></a>

## Harness Plugins — 컨트롤 플레인 확장

Plugin SDK v1.0.0 · Pi-Harness v2.2.6부터 제공됩니다. 이벤트 구독, 사용자 정의 평가, JSON Trace 내보내기 및 팀 템플릿을 제공합니다. 실행 코드는 명시적인 신뢰 승인이 필요하며 별도 프로세스는 보안 샌드박스가 아닙니다.

[개발 및 설치](docs/plugins/getting-started.md) · [Architecture](docs/plugins/architecture.md) · [SDK API](docs/plugins/api-reference.md) · [Security](docs/plugins/security.md) · [Examples](examples/harness-plugins/)

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

### 음성 대화 시작

실시간 음성 대화를 시작하려면:

1. **설정 → 실시간 음성**에서 음성을 켜고 서비스와 계정을 선택해 저장합니다.
2. 작업 공간 대화로 돌아가 입력창 옆의 파형 버튼을 누릅니다.
3. 대상 대화와 선택적 공유 설정을 확인하고 **실시간 음성 시작**을 선택한 뒤 마이크 접근을 허용합니다.
4. 통화 컨트롤에서 음소거, 상세 정보와 통화 종료를 사용합니다. 작업 요청은 확인한 뒤 코딩 에이전트에 전송합니다.

## 요구 사항

macOS Apple Silicon, macOS Intel, Windows x64, Linux x64를 지원합니다. 지원 환경에서는 앱에서 Pi Coding Agent를 설치하거나 복구할 수 있습니다. 소스에서 실행하려면 Node.js 24 LTS (≥ 24.22.1)와 pnpm 9.12.1이 필요합니다.

<a id="documentation"></a>

## 문서

- [에이전트 설정](docs/agent-settings.md)
- [스크린샷 분류 목록](docs/README.md)
- [변경 기록](CHANGELOG.md)

## 감사의 말과 저자

공식 [Pi Coding Agent와 Pi Agent Harness](https://github.com/earendil-works/pi)를 중심으로 만들었습니다.

제작·유지 관리: [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

### PR 기여자

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/HenryArch"><img src="https://avatars.githubusercontent.com/u/244436357?v=4" width="64" height="64" alt="HenryArch" /><br /><b>HenryArch</b></a><br />
      <a href="https://github.com/wangmiaozero/pi-harness/pull/8">PR #8</a>
    </td>
  </tr>
</table>

Pi-Harness를 더 나은 프로젝트로 만들기 위한 PR을 환영합니다. 함께 개선해 주시는 모든 기여자분께 감사드립니다!

## 라이선스

Pi-Harness는 [GNU Affero General Public License v3.0 only](LICENSE)(`AGPL-3.0-only`)로 배포됩니다.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
