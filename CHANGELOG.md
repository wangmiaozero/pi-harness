# Changelog

Public release notes contain only released, user-visible additions and fixes.

## 1.4.0

### Added

- Added the Harness Control Plane: unified Runs with per-run tokens, cost, tool calls, steps, and derived run events, merging live observation with history reconstructed from Pi session JSONL.
- Added Harness Policy: tool/file/git/network/shell decisions enforced at the Pi tool boundary, command allow/deny patterns, dangerous-command confirmation, and per-run budgets (tokens, cost, tool calls, duration) that abort runaway runs.
- Added Checkpoints and recovery: create, resume (session-tree navigation), fork, and retry-last-run, with optional pre-run checkpoints and pruning.
- Added evidence-based Run Evaluation: engineering checks over real run evidence (test/lint/build exit codes, tool results, git workspace state) with per-check evidence, plus evaluation status on every run.
- Added the Runs, Policy, Checkpoints, and Evaluation panels plus a filterable Timeline (runs/tools/policy/system) in the Harness Console.
- Added per-message usage (tokens and cost) to harness events and run statistics.
- Added a quarantine-repair app (「修复」) inside the macOS DMG to clear the "app is damaged" Gatekeeper flag on unsigned installs.

### Fixed

## 1.3.0 — 2026-08-30

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
