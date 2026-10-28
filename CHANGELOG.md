# Changelog

Release notes describe user-visible additions and fixes. Entries under Unreleased are available in the development build and have not been published in a release.

## Unreleased

### Added

- Added a BigFish desktop pet: a transparent always-on-top companion that reacts to agent activity (thinking, coding, tool calls, waiting), with drag physics, status bubbles, multi-monitor support and per-monitor position memory. Off by default; enable it in Settings.
- Added third-party pet pack support: import pet packs as ZIP files or local folders from Settings, switch between installed packs live, and uninstall user packs. Imports are validated (manifest schema, frame counts, WebP integrity, preview images) and installed atomically so a failed import never leaves a broken state. Pack format: see `docs/desktop-pet/PET_PACK_FORMAT.md`.

## 2.3.4 — 2026-10-28

### Fixed

- Combined assistant replies into one response per prompt, with tool activity and context summaries collapsed until opened.
- Added two levels of detail for execution activity and kept the reading position when expanding output.
- Fixed title bar window controls and dragging and double-click resizing in empty title bar areas.
- Adjusted title bar icon sizing and simplified tool activity styling in portrait themes.
- Removed distracting input artwork and improved draft text visibility in the snowy palace theme.

## 2.3.3 — 2026-10-27

### Added

- Added the Everything Claude Code capability pack with install, update and uninstall controls.
- Installed capability packages can now be disabled and re-enabled without reinstalling.

### Fixed

- Cut-off replies now show a warning with controls to compact the conversation or enable automatic compaction.
- Conversation compaction failures are reported instead of appearing to complete successfully.
- Expanded the title bar drag area while keeping window controls and search clickable.

## 2.3.2 — 2026-10-27

### Added

- Session cleanup now has its own entry in Settings, at the same level as Workspace, instead of being embedded in the Workspace page.

## 2.3.1 — 2026-10-27

### Added

- Added session cleanup in Settings → Workspace: scan the current project, sessions older than 30 or 90 days, or the entire history, preview the exact number of sessions and disk space, and permanently delete them after a two-step confirmation. Running and pinned sessions are always protected.

### Fixed

- New prompts sent while the agent is busy are now queued and sent when the current run finishes instead of being rejected.
- Links in assistant messages are now clickable and open in the default browser.
- Fixed message copy not working, and moved the copy button next to the message bubble instead of the edge of the chat area.
- Image attachment metadata is no longer shown in the conversation.

## 2.3.0 — 2026-10-26

### Added

- Updated the built-in Pi engine to 1.4.0, bringing new models such as MiniMax-M3.1-Flash and refreshed defaults for the GitHub Copilot, NVIDIA and Xiaomi providers.

### Fixed

- Conversation compaction and summaries no longer fail when long reasoning uses most of the summary output budget.
- Parallel codemode scripts now wait for a free worker instead of failing immediately.
- Fixed sessions breaking after recovering from a response cut off at the output limit.
- Fixed resumed sessions leaving extension tools inactive when they were installed after the session started.
- Fixed @ file autocomplete returning no results for queries containing characters like [ or (.
- Fixed Markdown bold and italic not rendering next to CJK punctuation, including in HTML export.
- Fixed mcp.json files starting with a UTF-8 BOM being skipped, which removed their MCP servers.
- Improved Windows shell detection for Microsoft Store aliases and PowerShell installations outside PATH.

## 2.2.22 — 2026-10-25

### Added

- Added concise conversation titles based on the discussion, while preserving manually chosen names.
- Added previews for all standard themes and refreshed interface screenshots.

### Fixed

- Improved readability and consistency across light, dark and colored themes, controls and menus.
- Improved the conversation input layout and long-message scrolling.
- Prevented a light appearance from flashing when opening the app with a saved dark theme.
- Fixed intermittent failures when saving settings or switching models on Windows.

## 2.2.21 — 2026-10-25

### Added

- Added concise conversation titles based on the discussion, while preserving manually chosen names.
- Added previews for all standard themes and refreshed interface screenshots.

### Fixed

- Improved readability and consistency across light, dark and colored themes, controls and menus.
- Improved the conversation input layout and long-message scrolling.
- Prevented a light appearance from flashing when opening the app with a saved dark theme.

## 2.2.20 — 2026-10-25

### Fixed

- Kept the composer control bar on a single line, collapsing option buttons to icons when space is tight.
- Showed the stop button only for the conversation that is actually running a task.

## 2.2.18 — 2026-10-25

### Fixed

- Fixed sessions switching back and forth on their own after rapid switching in the sidebar.
- Speeded up session switching, opening conversations, and startup.

## 2.2.17 — 2026-10-25

### Fixed

- Enforced the selected permission mode in agent sessions so workspace write protection can no longer be bypassed.

## 2.2.16 — 2026-10-24

### Fixed

- Kept the stop button available while tasks are still running.
- Fixed duplicate user messages with image attachments during conversations and history reloads.
- Applied permission choices consistently and removed unnecessary approval prompts in full-access mode.
- Updated mode and permission menus with descriptions and clearer selection.

## 2.2.12 — 2026-10-24

### Fixed

- Removed unused DMG blockmap files from release downloads.

## 2.2.10 — 2026-10-24

### Added

- Added AI preferences, configurable shortcuts, and global or project instructions.
- Added workspace realtime voice with OpenAI Realtime, Gemini Live, and Codex Live, call controls, transcripts, and optional recent context sharing.
- Added MCP server management by scope, configuration scanning, 15 built-in templates, and official registry search.
- Added reusable subagent templates and task launch controls.
- Added remote host pairing, project and session browsing, conversations, and approval handling.
- Added workspace agent modes and permission choices, a conversation minimap, and adjustable conversation width.
- Added multilingual feature guides and refreshed product screenshots.

### Fixed

- Improved startup reliability for Harness plugins.
- Fixed closing Pi sessions on Windows.
- Improved detection and repair of outdated runtimes.
- Kept workspace composer controls compact with voice, agent modes, and permission choices.

## 2.2.9 — 2026-10-22

### Fixed

- Reissued community installers with the existing v2.2.6 feature set.

## 2.2.8 — 2026-10-22

### Fixed

- Reissued community installers without changes to existing features.

## 2.2.7 — 2026-10-22

### Fixed

- Reissued community installers with the same features as v2.2.6.

## 2.2.6 — 2026-10-21

### Added

- Added local Harness plugins for run metrics, custom evaluations, JSON trace exports and team templates.
- Added plugin management with explicit trust approval, permission details and diagnostics.
- Added plugin developer guides, a versioned SDK and three working examples.
- Refreshed both built-in Skills collections with the latest upstream instructions and resources.
- Updated the project homepage with product previews and clearer installation guidance.

### Fixed

- Preserved edits typed while an earlier file save is still completing.
- Restored access to the current app profile’s existing default workspace on startup.

## 2.2.5 — 2026-10-21

### Added

- Added a shared OpenCode Zen / Go setup with named API keys and automatic model loading.
- Added individual and batch model verification, with explicit permission for paid verification.
- Added model enablement controls and independently scrolling key and model lists.

## 2.2.4 — 2026-10-20

### Added

- Added verified update downloads with progress, cancellation, resume, and retry.
- Added release notes and an option to turn off automatic update checks.

### Fixed

- Kept unverified or incompatible update packages from being offered for installation.
- Improved guidance for installing downloaded updates manually.
- Fixed update status after restarting into a newly installed version.

## 2.2.1 — 2026-10-18

### Fixed

- Fixed duplicate Pi-Harness entries in macOS app search.

## 2.2.0 — 2026-10-17

### Added

- Added installed and latest version information in runtime settings, with manual update checks.

### Fixed

- Updated bundled Pi to 1.3.0 and improved runtime stability.
- Kept large workspaces responsive when opening projects and watching file changes.

## 2.1.1 — 2026-10-17

### Fixed

- Fixed missing application files after installation on Windows ARM64.

## 2.1.0 — 2026-10-17

### Added

- Bundled Node.js and Pi in community downloads for macOS, Windows, and Linux.
- Added conservative static dependency analysis for Python, Go, Java, and Rust, with visible coverage limits.
- Preserved traceable tool outcomes and historical file-change evidence in local task handoffs.

### Fixed

- Improved startup compatibility for community builds and opened official downloads for manual updates.
- Fixed task status updates when starting a new request after cancelling the previous one.
- Fixed duplicate user messages when sending the first message in a new conversation.
- Kept early replies visible and restored new conversations after refresh.
- Preserved Windows settings, workspace access and saved task history during upgrades.
- Improved navigation label spacing, architecture view resizing and repeated fullscreen transitions.
- Kept imported project folders active while the workspace opens.
- Kept glass themes responsive on computers without accelerated graphics.

## 2.0.0 — 2026-10-14

> **Breaking update:** Pi-Harness 2.0.0 adopts Pi 1.2.0’s breaking changes. Review older extensions and native terminal themes before upgrading. [Pi upgrade notes](https://github.com/earendil-works/pi/releases/tag/v1.2.0).

### Added

- Added project architecture analysis with interactive maps, source references, saved snapshots, and project information available to Pi. Local analysis uses no model tokens; AI descriptions are optional.
- Added JSON, offline HTML, and current-view PNG exports for project architecture.
- Added map pages, focused dependency views, package filters, entrypoints, and translated project analysis controls.
- Added fullscreen architecture maps with mouse-wheel and trackpad zoom, compact panels, and a floating toolbar for map navigation.
- Added theme-aware architecture backgrounds and frosted panels.
- Grouped Harness and Agents under Workspace Tools.

### Fixed

- Improved menu switching, history loading, file previews, and Skill editing responsiveness while preserving existing workflows.
- Made Dark the default theme for new installations while retaining existing appearance preferences.
- Fixed title-bar double-click resizing and translated sidebar ordering labels.
- Fixed access to default-workspace files and viewing stopped Harness sessions.
- Improved Pi tool execution, cancellation, session forks, failed-run reporting, and OpenRouter model discovery.
- Kept project analysis isolated between projects, with cancellable scans, retries, and stale source checks.
- Kept excluded analysis paths separate for each project and restored them from saved snapshots.

## 1.9.0 — 2026-10-11

### Added

- Added unified local conversation history for Claude Code, Codex, Cursor, Cursor Agent, Gemini CLI, OpenCode, and Pi, with search, project and date filters, and custom history folders.
- Added separate history viewing and task continuation with a local handoff preview and an editable next-step instruction. Original sessions remain read-only; browsing, local previews, and scan retries use no model tokens.
- Added optional AI handoff summaries using the configured model when requested.

### Fixed

- Improved Codex desktop history discovery and added scan retries that preserve previously imported history.
- Reused conversation project directories when continuing tasks and displayed continued chats under their projects, while keeping default chats under Sessions.
- Improved clickable history cards, readable conversation titles, date range selection, multilingual navigation labels, and rounded button states.
- Fixed chat errors with reasoning models, composer caret positioning, window controls, and model picker dismissal after selection.

## 1.8.1 — 2026-10-04

### Added

- Added `@Skill` autocomplete in the Workspace composer with search, keyboard navigation, scope-aware results, removable Skill chips, and Native Pi skill invocation.

### Fixed

- Kept expanded Skill prompts compact in conversations, full history, and restored session titles.
- Reduced visual density in Skill suggestions, file-panel view controls, and Workspace toolbar actions.
- Aligned the minimum Node.js requirement with the dependency floor at 22.22.2 so frozen installs and release builds remain reproducible.

## 1.8.0 — 2026-09-30

### Added

- Added macOS 27 Light and Dark themes with Liquid Ether, Lightfall, Lightning, Web Threads, and local-image backgrounds. New installations default to macOS 27 Dark with Liquid Ether.
- Added declarative custom skins: create a constrained starter project for Codex or Pi, then import its palette, preview, wallpaper, and optional portrait.
- Added customizable user and assistant display names with visually distinct conversation surfaces and role badges.
- Added standalone chats that do not require selecting a project first, plus unified Workspace navigation for chats and project sessions.
- Added an About settings page with author contact details, project links, and a GitHub Star action.

### Fixed

- Restored file-change artifacts and diffs from persisted write/edit tool calls, including older runs and newly written files.
- Hidden non-display and empty messages no longer leave blank entries in the conversation or full history.
- Kept project actions on project rows and chat actions on chat rows in the unified Workspace sidebar.
- Fixed opaque macOS 27 surfaces and nested input chrome so capability tabs and composite fields retain the intended liquid-glass appearance.

## 1.7.1 — 2026-09-26

### Added

- Defined Pi-Harness as the operational superset harness for Pi Coding Agent, with Native Pi remaining the execution foundation.
- Added image-model tasks on the Models page: text-to-image, or image editing when a PNG, JPEG, or WebP source up to 20 MB is attached. Results can be downloaded. Image models stay off Pi's active chat model, and SVG results are rasterized before display.
- Added show and hide for a saved provider API key. Provider Base URL values pasted with chat, messages, or images paths are normalized to the API root Pi expects.
- Updated the Pi SDK family and desktop dependencies to current compatible stable releases, including Pi SDK 0.87.1.

### Fixed

- Deleting the last provider now clears a dangling active model.
- Expanded runtime capability detection so unsupported Pi features degrade cleanly instead of being assumed.
- Aligned environment checks and CI with the Pi SDK requirement of Node.js 22.19.0 or newer.

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
