# Changelog

Public release notes contain only released, user-visible additions and fixes.

## 1.6.0 — 2026-09-19

### Added

- Added a Codex-aligned thinking slider in the workspace composer, including Ultra. Ultra stays a UI alias for the highest Pi thinking level the current model supports; Pi still only receives off/minimal/low/medium/high/xhigh/max.
- Remembered composer thinking level and tool preset locally, including per-session overrides, so the next launch restores the last selection.
- Added a Max/Ultra “You are using forbidden power” hint on the thinking slider.
- Added smart compaction: Compact stays clickable whenever a session exists (except while the agent is actually busy); low-content sessions ask for confirmation; compaction temporarily uses medium thinking and restores the previous level afterwards.
- Added a Git commit-activity details view with weekly trend, peak day, and committers, plus localized weekday/week labels.

### Fixed

- Turned provider quota and 429 dumps into a recoverable switch-model hint instead of crashing compaction or chat.
- Fixed themed chart tooltips rendering unreadable light-on-light text.
- Kept the main window focused after screen-motion overlay updates, so sending a message no longer makes the app appear to vanish.
- Stopped chat auto-scroll from yanking the transcript when the user has scrolled away from the latest message.

## 1.5.0 — 2026-09-13

### Added

- Added Run Replay: every run records a redacted trace (spans + events) that can be replayed with play/pause, step, and 0.5x–4x/instant speeds; runs without a recorded trace are replayed from the persisted session log.
- Added Trace Waterfall: per-run span timeline (model, tool, shell, git, compaction, checkpoint, recovery, evaluation) with durations and status.
- Added the Run Tree: forks, retries, recoveries, and re-runs branch off their parent runs across sessions.
- Added Run Compare: pick any two runs to diff model, tokens, cost, duration, tool calls, failures, evaluation stages, prompt, configuration, tools, and changed files.
- Added Diagnostics: deterministic root-cause chains and recommendations for failed runs (tool/shell/model/provider failures, timeouts, budget exceedance, policy blocks, evaluation failures), plus rule-based insights (token delta vs baseline, tool-failure hotspots, duration and model shares, context compaction).
- Added Regression Baselines: mark any run as the project baseline and get deterministic threshold findings (±25% warning, ±50% regression, duration ×1.5/×2) on later runs.
- Added Artifact Tracking: files, test/lint/build logs, checkpoints, and git commits recorded per run from real evidence, with a type filter.
- Added evaluation presets (fast/standard/strict/custom) with selectable custom stages, and a pipeline view per evaluation.
- Added project statistics: run/success/failure rates, sessions, average duration and tokens, evaluation pass rate, recovery rate, and top failure categories over today/7d/30d/all-time ranges.
- Added Fork & Re-run from any run (new session at that entry, or same-session re-execution) and run exports (JSON/Markdown) plus a redacted debug bundle — all exports strip secrets.
- Added run-history persistence with retention settings (7/30/90/forever) and per-run trace event caps.
- Added Multi-Agent Orchestration: coordinate a team of Pi agents on one plan — tasks with dependencies, priorities, assignees, and manual, sequential, or dependency-based scheduling with parallel dispatch under configurable agent/run concurrency.
- Added the Orchestration console: a dashboard with status, tokens, cost, and cost-by-agent shares, an Agents board, a Tasks board, and Teams & Templates panels. Every agent state comes from a real Pi session — no mocked status.
- Added agent templates, reusable teams, and built-in team presets, including reviewer roles that approve or reject task results before completion.
- Added artifact handoff between agents: downstream tasks receive the artifacts and results of their dependencies instead of full session history.
- Added per-agent Git worktree isolation plus same-file conflict detection across concurrently running agents.
- Added orchestration budgets (tokens and cost) with per-agent token budgets, pause on budget exceed, and cost-by-agent breakdowns.
- Added orchestration recovery: pause/resume/abort, retry failed tasks with reviewer feedback carried into the retry, skip, and reassign; interrupted orchestrations are detected after restart and remain resumable.
- Added dependency cycle detection, stuck-agent hints, and an orchestration timeline of task, agent, handoff, and review events.
- Added a native Git workspace with history and activity graphs, a commit panel, and AI commit-message generation.
- Added a cascading vendor-then-model picker in Workspace and the Git commit panel.

### Fixed

- Anchored live runs to their session entries before settling, so persisted runs always keep their prompt anchor and working directory for replay and project statistics.
- Fixed Harness and Orchestration console surfaces rendering translucent, so they now stay solid under every theme and visual skin.
- Fixed doubled focus outlines on console inputs and search fields.
- Fixed the Orchestration console navigation highlighting and dropdowns to follow the active theme.

## 1.4.0

### Added

- Added the Harness Control Plane: unified Runs with per-run tokens, cost, tool calls, steps, and derived run events, merging live observation with history reconstructed from Pi session JSONL.
- Added Harness Policy: tool/file/git/network/shell decisions enforced at the Pi tool boundary, command allow/deny patterns, dangerous-command confirmation, and per-run budgets (tokens, cost, tool calls, duration) that abort runaway runs.
- Added Checkpoints and recovery: create, resume (session-tree navigation), fork, and retry-last-run, with optional pre-run checkpoints and pruning.
- Added evidence-based Run Evaluation: engineering checks over real run evidence (test/lint/build exit codes, tool results, git workspace state) with per-check evidence, plus evaluation status on every run.
- Added the Runs, Policy, Checkpoints, and Evaluation panels plus a filterable Timeline (runs/tools/policy/system) in the Harness Console.
- Added per-message usage (tokens and cost) to harness events and run statistics.

### Fixed

- Preserved pasted images throughout live chat rendering, restored session history, and Markdown/HTML exports by keeping Pi-native image content blocks intact.
- Fixed macOS update checks for unsigned or ad-hoc-signed community builds: available releases now remain visible with a manual-download action instead of being overwritten by a misleading network error.
- Enabled optional Developer ID signing and notarization credentials in the macOS release workflow so signed builds can use native automatic installation.

## 1.3.0 — 2026-08-30

### Added

- Added **Capabilities**, a unified center for built-in and local Skills, installed packages, featured add-ons, and the live Pi package registry.
- Added Superpowers as a recommended opt-in methodology; Odai remains optional. Neither installs automatically.
- Added the complete Classical Chinese theme across windows, menus, dropdowns, and Harness surfaces.
- Completed the v1.3 interface localization in eight languages.
- Added a quarantine-repair app (「修复」) inside the macOS DMG to clear the "app is damaged" Gatekeeper flag on unsigned installs.

### Fixed

- Harness now switches the entire right-hand workspace from the Project/Harness selector instead of appearing as a closable conversation tab.
- Fixed nested borders inside search fields and improved Classical theme consistency for menus, dropdowns, and inputs.

## 1.2.0 — 2026-08-30

### Added

- Added the visual Harness console with session, tool, stats, and timeline panels.
- Added multi-root `.code-workspace` support, workspace search, and file explorer context actions.
- Added project export to Markdown/HTML and portrait mascot skins.
- Added mascot-free packaging mode for source builds.

### Fixed

- Fixed Pi self-update PATH resolution, model/provider protocol sync, and market package installs from GUI launches.

## 1.1.2 — 2026-08-27

### Added

- Added Starship Cockpit and Frost Navigator appearance, settings sections, and sidebar order.

### Fixed

- Fixed workspace chat stability, Git handling outside repositories, and cockpit appearance consistency.

## 1.1.1 — 2026-08-25

### Added

- Improved provider and model configuration workflows.

### Fixed

- Fixed compatibility and stability issues in environment detection, updates, and provider handling.

## 1.1.0 — 2026-08-24

### Added

- Added environment setup, Skills and package management, and workspace experience improvements.

### Fixed

- Fixed provider state handling and general runtime stability.

## 1.0.9 — 2026-08-22

### Added

- Added chat, appearance, update, and installation experience improvements.

### Fixed

- Fixed configuration and update-state compatibility issues.

## 1.0.8 — 2026-08-22

### Added

- Added provider and model configuration improvements.

### Fixed

- Fixed dialog, selection, and theme consistency issues.

## 1.0.7 — 2026-08-22

### Added

- Added project workspace and file workflows.

### Fixed

- Fixed path compatibility and workspace stability issues.

## 0.3.0 — 2026-08-12

### Added

- Added refreshed desktop themes and interface components.

### Fixed

- Fixed visual consistency and density issues.

## 0.2.0 — 2026-08-12

### Added

- Added configuration, provider, model, skill, diagnostics, and update workflows.

### Fixed

- Fixed configuration conflicts and validation behavior.

## 0.1.0

### Added

- Initial Pi-Harness release.
