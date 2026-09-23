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

<h3 align="center">Desktop Harness &amp; Control Center for Pi Coding Agent</h3>

<p align="center">
  <strong>Bring Pi Agent Harness into a visual desktop workspace.</strong>
</p>

<p align="center">Everything around Pi, in one place.</p>

<p align="center">
  Manage models · Run agents · Orchestrate teams · Inspect Harness state · Use Skills · Browse files · Control Git
</p>

<p align="center">
  <a href="#download"><strong>Download Pi-Harness</strong></a> ·
  <a href="https://github.com/earendil-works/pi">Pi Agent Harness</a> ·
  <a href="#current-screenshots">Screenshots</a>
</p>

<p align="center">
  <a href="https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0"><img alt="release v1.7.0" src="https://img.shields.io/badge/release-v1.7.0-4C8DFF?style=flat-square" /></a>
  <img alt="platform macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6B7280?style=flat-square" />
  <a href="LICENSE"><img alt="license AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-663399?style=flat-square" /></a>
  <a href="https://github.com/wangmiaozero/pi-harness/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/wangmiaozero/pi-harness?style=flat-square" /></a>
</p>

<p align="center">
  ⭐ <a href="https://github.com/wangmiaozero/pi-harness/stargazers">Star Pi-Harness</a> to follow the next Harness Console updates.
</p>

## Why Pi-Harness?

Pi-Harness is a visual Harness Console for Pi Coding Agent. Use Native Pi as-is, or discover and manage optional development methodologies, Skills, extensions, packages, and MCP tools.

[Pi Coding Agent](https://github.com/earendil-works/pi) already has a powerful Agent Harness. Much of its runtime state—context, tools, compaction, queues, and sessions—is naturally exposed through CLI and SDK behavior.

Pi-Harness makes those capabilities visible and manageable in a native desktop workspace, alongside the configuration and project tools needed to use Pi every day.

> **Pi runs the agent. Pi-Harness lets you see and control how it runs.**

Pi-Harness is not a wrapped web UI. It embeds no pi-web, Next.js server, or iframe, and it does not add a second Agent Runtime.

## Powered by Pi Agent Harness

[Pi](https://github.com/earendil-works/pi) already provides the Agent Harness that powers Pi Coding Agent.

Pi-Harness does not replace or reimplement that runtime. Pi Coding Agent and its Agent Harness remain responsible for the Agent Loop, tools, context, compaction, and session execution.

Pi-Harness provides the desktop control plane, visualization, configuration, and workspace around it:

- inspect runtime and context state
- start, resume, fork, and navigate sessions
- select models, Thinking levels, and tools
- control compaction, Steering, and Follow-up messages
- observe streaming output, Thinking, Tool Calls, and agent events
- work with files and Git beside the agent

**Powered by Pi Agent Harness.**

## What Pi-Harness already does

These are current capabilities, not roadmap claims: Pi-Harness can start and resume Pi-compatible sessions; stream responses, Thinking, and Tool Calls; show context usage and session statistics; switch models, Thinking levels, and tool presets; control compaction; send Steering and Follow-up messages; and Fork or navigate session history.

The surrounding desktop capabilities are summarized below.

## Core features

| Area               | What Pi-Harness does                                                  |
| ------------------ | --------------------------------------------------------------------- |
| Overview           | Shows environment, configuration, and current model status            |
| Workspace          | Runs Pi sessions beside project files, Git, and worktrees             |
| Pi Runtime         | Surfaces streaming, Thinking, Tool Calls, context, queues, and stats  |
| Orchestration      | Coordinates agent teams over tasks, dependencies, and handoffs        |
| Providers & Models | Manages Pi-compatible providers and models                            |
| Skills & Packages  | Manages supported Skills, Pi packages, and MCP-capable extensions     |
| Files              | Provides lightweight editing with explicit save and conflict handling |
| Diagnostics        | Reports application, environment, storage, and workspace health       |
| Updates            | Installs compatible application updates                               |
| Appearance         | Adds app icons, themes, density, and visual effects                   |

### Startup and appearance

Pi-Harness opens with a startup animation while it checks the npm registry, Node.js, npm, Pi Agent, and the active configuration. The animation remains visible for at least five seconds, uses a monochrome quantum particle effect by default, and follows the selected optional visual theme when one is active.

In **Settings → General**, choose the Classic, Ming, or Quantum app icon—or let Pi-Harness select one automatically—and control the window glow, screen glow, and input flame effect independently. Mascot-free builds keep the default startup animation and these appearance controls without loading optional mascot themes.

### Optional methodologies and add-ons

Native Pi remains the built-in default runtime and workflow. Pi-Harness does not replace it and does not silently install or enable third-party methodologies.

- [Superpowers](https://github.com/obra/superpowers) is the recommended optional add-on: a complete software development methodology for coding agents covering brainstorming, planning, TDD, systematic debugging, Git worktrees, subagent and parallel-agent workflows, code review, and verification. Install it explicitly from Capabilities with `pi install git:github.com/obra/superpowers`.
- [Odai](https://github.com/orziz/odai) remains an optional governance and adaptive-execution methodology for goal alignment, authorization boundaries, risk awareness, capability routing, evidence, and verification.

Both add-ons use the existing trusted capability/package management flows and can be updated or removed independently.

### Lightweight editor, not an IDE

Pi-Harness edits readable text with lazy syntax highlighting, line numbers, undo/redo, find, explicit save, unsaved-state indicators, and external-change conflict protection. Oversized, binary, media, and document files use read-only previews.

It deliberately does not include LSP/IntelliSense, semantic refactoring, a debugger, task runner, integrated terminal, or IDE extension compatibility.

## Architecture

Pi-Harness separates the desktop control plane from the growing visual Harness Console while keeping Pi Coding Agent as the only Agent Runtime.

```text
                         Pi-Harness

             ┌──────────────┴──────────────┐
             │                             │
       Control Plane                 Harness Console
             │                             │
        Providers                      Observe
        Models                         Runs · Trace · Replay
        Skills                         Diagnostics
        Packages                       Evaluation
        Environment                    Artifacts
        Config
        Updates                        Control
        Backups                        Policy · Budget
        Diagnostics                    Recovery · Checkpoints

                                       Orchestrate
                                       Tasks · Agents
                                       Teams · Dependencies
                                       Handoffs · Review gates
             │                             │
             └──────────────┬──────────────┘
                            ▼
                    Pi Agent Harness
                            │
                            ▼
                    Pi Coding Agent
                            │
                            ▼
                         Models
```

The Control Plane manages everything around Pi. The Harness Console observes and controls Pi Agent Harness state: it records Runs, enforces Policy at the Pi tool boundary, creates Checkpoints, evaluates finished runs from real evidence, and orchestrates agent teams over tasks with dependencies, handoffs, and budgets. Pi-Harness does not replace Pi Coding Agent: each agent still runs through Pi, and Pi-Harness provides orchestration, observability, policy, evaluation, recovery, and control. Sessions stay compatible with the Pi CLI JSONL under <code>~/.pi/agent/sessions/</code>.

On `main-tauri` the desktop host is Tauri 2: Vue talks only to the platform bridge, Rust supervises a Node sidecar, and the sidecar loads the Pi SDK. `origin/main-electron` remains the Electron product line. Do not merge the Tauri line into `main`. See [docs/architecture-rules.md](docs/architecture-rules.md).

## Current screenshots

The same six product surfaces are shown in both the default and Classical Chinese themes. The Classical Chinese theme includes snow and moon workspace variants.

### Default theme

|                          Workspace                           |                             Git                              |
| :----------------------------------------------------------: | :----------------------------------------------------------: |
|  ![Workspace in the default theme](docs/默认主题/Work.jpg)   |      ![Git in the default theme](docs/默认主题/Git.jpg)      |
|                        **Providers**                         |                          **Models**                          |
|  ![Providers in the default theme](docs/默认主题/APIs.jpg)   |   ![Models in the default theme](docs/默认主题/Model.jpg)    |
|                       **Capabilities**                       |                       **Preferences**                        |
| ![Capabilities in the default theme](docs/默认主题/Caps.jpg) | ![Preferences in the default theme](docs/默认主题/Prefs.jpg) |

### Classical Chinese theme

|                            Workspace (Snow)                             |                             Workspace (Moon)                             |
| :---------------------------------------------------------------------: | :----------------------------------------------------------------------: |
| ![Workspace in the Classical Chinese snow theme](docs/古风/Work-1.jpg)  |  ![Workspace in the Classical Chinese moon theme](docs/古风/Work-2.jpg)  |
|                                  Git                                    |                              **Providers**                               |
|      ![Git in the Classical Chinese theme](docs/古风/Git.jpg)           |    ![Providers in the Classical Chinese theme](docs/古风/APIs.jpg)       |
|                               **Models**                                |                            **Capabilities**                              |
|   ![Models in the Classical Chinese theme](docs/古风/Model.jpg)         |  ![Capabilities in the Classical Chinese theme](docs/古风/Caps.jpg)      |
|                            **Preferences**                              |                                                                          |
| ![Preferences in the Classical Chinese theme](docs/古风/Prefs.jpg)      |                                                                          |

## Coming Next

Pi-Harness has shipped its Harness Control Plane: Runs, Policy, Checkpoints, Evaluation, and a filterable Trace are live in the Harness Console.

Version 1.5 added Run Intelligence & Replay and Multi-Agent Orchestration: every run records a redacted trace you can replay (play/pause, step, 0.5x–4x/instant) and inspect as a span waterfall; forks, retries, and recoveries form a Run Tree; any two runs can be compared metric-by-metric with real diffs; deterministic Diagnostics explain failures with root-cause chains; project baselines flag regressions; artifacts (files, test/lint/build logs, checkpoints, git commits) are tracked per run; and project statistics summarize success, evaluation pass, and recovery rates over time. Agent teams can be coordinated on one plan — tasks with dependencies, priorities, and assignees; manual, sequential, or dependency-based scheduling with parallel dispatch; per-agent worktree isolation; artifact handoffs; review gates; orchestration budgets; and pause/resume/abort with retry, skip, and reassign.

The next phase focuses on session visualization and deeper context inspection without replacing the runtime that Pi already provides.

### Harness Console — shipped panels

```text
┌──────────────────────────────────────────────┐
│ HARNESS                                      │
│                                              │
│ ● Running                                    │
│                                              │
│ Runs                                         │
│ ───────────────────────────────────────────  │
│ ▸ #12  ship auth flow        ✓ success       │
│     74,120 tok · $0.42 · 23 tools · 4m 12s   │
│ ▸ #11  fix build            ✕ failed         │
│                                              │
│ Policy                                       │
│ ───────────────────────────────────────────  │
│ Git push         Ask      Budget  ∞ tokens   │
│ Files delete     Ask      Budget  ∞ cost     │
│ Shell default    Allow    Dangerous  Confirm │
│                                              │
│ Checkpoints                                   │
│ ───────────────────────────────────────────  │
│ ▸ pre-run #12   session · main @ a1b2c3d     │
│                                              │
│ Evaluation                                   │
│ ───────────────────────────────────────────  │
│ ✓ Run completed   ✓ No unhandled errors     │
│ ✓ Tests passed    ⚠ No lint executed        │
│ ✓ Git workspace clean                       │
│                                              │
│ Run Detail · Replay                          │
│ ▸ ▶ 0:42/4:12  speed 1x   fork · re-run      │
│ ! bash exited 1 → shell failure chain        │
│ ▲ tokens +150% vs baseline (regression)      │
└──────────────────────────────────────────────┘
```

### Harness Timeline — shipped with filters

```text
12:40:03  Session started
12:40:05  Run started: ship auth flow
12:40:07  Tool · read · src/auth.ts
12:40:10  Policy allowed · edit · src/auth.ts
12:40:23  Compaction started
12:40:25  Compaction completed
12:40:31  Run completed: success
12:40:32  Evaluation completed: passed
```

Filters: All · Runs · Tools · Policy · System. Every timeline entry derives from real Pi events — no mock UI.

### Run Intelligence — shipped with 1.5

```text
Run Tree          #12 ── fork ──▶ #13 (new session)
                  #12 ── retry ─▶ #14
Waterfall         ▐ model  ████████        3m 02s
                  ▐ tool   ██              41s
                  ▐ shell     ███          1m 10s
Diagnostics       1. bash exited with code 1
                  2. test stage failed → evaluation failed
Baseline          tokens +150% · cost +100% · duration ×2  (regression)
Artifacts         3 files · test-report · build-output · git-commit
Project · 30d     82% success · 71% eval pass · 45% recovery
```

All intelligence is deterministic and evidence-based: spans, cause chains, regression findings, and artifacts come from recorded events and real command output — never model guesses.

### Multi-Agent Orchestration — shipped with 1.5

```text
Team          Architect · Frontend · Backend · QA · Reviewer

Tasks         8 total · 2 running · 1 ready · 1 blocked · 4 done

Agents        Architect   ✓ completed   21,440 tok · $0.11
              Frontend    ▶ running     64,120 tok · $0.38   worktree
              Backend     ▶ running     58,301 tok · $0.35   worktree
              QA          ⏸ waiting on dependencies
              Reviewer    ⏸ waiting for review gate

Dependencies  design ──┬─▶ frontend ──┬─▶ integrate ─▶ review
                        └─▶ backend ──┘
Handoff       architecture.md → Backend
Conflict      Frontend and Backend both modified src/api.ts
Budget        $1.24 / $5.00 · pause when exceeded
Recovery      pause · resume · abort · retry · skip · reassign
```

Every agent executes through a real Pi session: orchestration adds coordination, not a second runtime.

## Roadmap

### Current

- Released desktop capabilities listed above
- Pi Agent Runtime integration and session controls
- Native project workspace and control plane

### Next

- Session Tree visualization
- Deeper Context and Queue inspectors
- Run intelligence beyond deterministic rules (opt-in, clearly separated from recorded evidence)

### Later

- Workspace permissions beyond the current file policy
- Verification and quality-check integrations
- Harness Profiles

## Pi-Harness compared

“Typical desktop client” describes common lightweight chat clients; individual products vary.

| Capability             | Pi CLI            | Typical desktop client | Pi-Harness                        |
| ---------------------- | ----------------- | ---------------------- | --------------------------------- |
| Chat and sessions      | Yes               | Usually                | Yes                               |
| Project workspace      | Terminal          | Basic                  | Native workspace                  |
| Provider management    | Config            | Limited                | Yes                               |
| Skills management      | CLI / files       | Limited                | Yes                               |
| Environment management | Manual            | Rare                   | Yes                               |
| Harness state          | CLI / SDK         | Limited                | Available and growing             |
| Runs and trace         | No visual console | Rare                   | Yes, live + history, filterable   |
| Tool policy and budget | Config files      | Rare                   | Yes, enforced at tool boundary    |
| Checkpoints / recovery | Manual git        | Rare                   | Resume, fork, retry last run      |
| Run evaluation         | Manual            | Rare                   | Evidence-based checks             |
| Agent orchestration    | Not built in      | Rare                   | Teams, tasks, handoffs, reviews   |
| Context inspection     | CLI / SDK         | Limited                | Basic now; full inspector planned |
| Tool inspection        | CLI / SDK         | Limited                | Selection now; inspector planned  |
| Compaction control     | CLI / SDK         | Limited                | Yes                               |
| Files and Git          | Terminal          | Varies                 | Yes                               |

## Download

Download Pi-Harness v1.7.0 from [GitHub Releases](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0).

| Platform            | Installer                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon | [`Pi-Harness-1.7.0-arm64.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0-arm64.dmg) |
| macOS Intel         | [`Pi-Harness-1.7.0.dmg`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.dmg)             |
| Windows x64         | [`Pi-Harness-Setup-1.7.0.exe`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-Setup-1.7.0.exe) |
| Linux x64           | [`Pi-Harness-1.7.0.AppImage`](https://github.com/wangmiaozero/pi-harness/releases/download/v1.7.0/Pi-Harness-1.7.0.AppImage)   |

> **Windows upgrade notice:** The first launch of the v1.7.0 installed app resets older Pi-Harness application data once, including app settings, its local credential vault, app backups, and caches. Reconfigure app preferences and credentials afterward. Pi Agent's separate data directory and project files are not reset.
>
> macOS community builds may be unsigned. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway**. See the [v1.7.0 installation notes](https://github.com/wangmiaozero/pi-harness/releases/tag/v1.7.0).

Packaged users do not need to clone the repository or install pnpm. Pi-Harness can detect, install, and repair Node.js, npm, PATH, and Pi Coding Agent where supported.

## How it works

1. Launch Pi-Harness and let Overview check Node.js, npm, PATH, and Pi.
2. Configure a Pi-compatible provider and choose a model.
3. Open a project in the native Workspace.
4. Start or resume a Pi session.
5. Work with streaming output, Tool Calls, files, and Git in one place.

```text
Install → Configure provider → Select model → Open project → Run Pi
```

## Requirements

For the packaged app:

- macOS Apple Silicon, macOS Intel, Windows x64, or Linux x64
- Pi Coding Agent, which Pi-Harness can install or repair from the app

For development from source:

- Node.js ≥ 22
- pnpm 9.12.1

## Development

```bash
pnpm install --frozen-lockfile
pnpm doctor
pnpm dev          # Electron shell
pnpm dev:tauri    # Tauri 2 shell on main-tauri
```

Without a local Pi installation, point **Settings → Config directory** at <code>fixtures/mock-pi/</code>, or copy <code>.env.example</code> to <code>.env</code> and set <code>PI_HARNESS_PI_CONFIG_DIR</code> to that fixture. Never store secrets in <code>VITE_*</code> variables; they are bundled into the renderer.

Common checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

## Follow the project

The next major step is the visual Harness Console shown above. Runtime and Context Inspectors, Tool inspection, Compaction controls, Session Tree visualization, and the Harness Timeline will continue to evolve.

If you want to follow that work, consider giving [Pi-Harness a ⭐](https://github.com/wangmiaozero/pi-harness/stargazers). It helps you find the project again and helps more Pi users discover it.

## Credits

Pi-Harness is a desktop project around the official [Pi Coding Agent and Pi Agent Harness](https://github.com/earendil-works/pi).

Created and maintained by [wangmiao](https://github.com/wangmiaozero) · [tuziling84@gmail.com](mailto:tuziling84@gmail.com).

See the [changelog](CHANGELOG.md) for released changes.

## License

Pi-Harness is free software licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (<code>AGPL-3.0-only</code>). You may use, modify, and redistribute it under the license terms. Modified versions made available over a network must offer their corresponding source to users as required by AGPL v3.

Copyright © 2026 [wangmiao](https://github.com/wangmiaozero).
