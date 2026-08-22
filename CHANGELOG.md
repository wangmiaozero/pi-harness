# Changelog

## Unreleased

## 1.0.8 — 2026-08-22

### Added

- **Pi-compatible provider presets.** Added a searchable catalog of 54 providers and 2,478 conversational text/code models merged from the local AgentDesk and WangmiaoGit-p catalogs. Media-only and utility endpoints are excluded; generated presets are limited to Pi-supported protocols.
- **Key-only provider setup.** Select a provider and model to prefill the provider key, display name, protocol, API base URL, authentication mode, and default model. Every generated field remains editable.
- **Shared model catalog.** The Models form reuses the selected provider's preset catalog while continuing to accept arbitrary vendor model IDs.

### Changed

- **Default model registration.** Saving a provider now registers the selected model with its display name, context window, and maximum output-token metadata when available.
- **Native theme synchronization.** Electron native context menus now follow the current light/dark theme immediately and after restart.
- **Session selection.** Replaced the crowded selected-row treatment with a compact accent dot and accent text.
- **Version source.** `APP_VERSION` is derived from `package.json`; the application version is no longer duplicated in source code.

### Fixed

- Provider dialogs no longer close when clicking the backdrop or pressing Escape. They close only through an explicit close/cancel action or after a successful save.
- Large provider/model comboboxes are scrollable and show the full option set when reopening an existing selection.

## 1.0.7 — 2026-08-22

### Added

- **Agent Workspace.** Native Projects / Sessions / Chat / Files / Git Worktree inside Pi-Harness. Pi Session JSONL under `~/.pi/agent/sessions/` is shared with the Pi CLI. AgentSession runs in Electron Main and streams over IPC — no pi-web iframe, Next.js, or HTTP server.
- **Workspace file workflow.** Multi-file upload with size validation and overwrite confirmation, manual refresh, and automatic file / preview / Git Diff refresh after agent completion or application refocus.

### Changed

- **AGPL license.** Relicensed the project under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).
- **Canonical path compatibility.** Allowed roots now recognize equivalent real paths (for example macOS `/var` → `/private/var`) without weakening sibling-prefix or parent-traversal protection.

## 0.3.0 — 2026-08-12

### Changed

- **Redesigned desktop visual system.** "Timeless Graphite · macOS Pro" — every surface, border, divider, button, and piece of typography now keys off a single token ladder. No more "Web Admin Dashboard" feel.
- **Refined Graphite theme.** Dark / Light now share the same 6-step surface ladder (`window → titlebar → sidebar → workspace → surface → surface-raised → hover → selected`). The delta between adjacent steps is intentionally small (2-5%) so the app reads as one continuous workspace.
- **Redesigned resource lists.** Providers and Models are no longer HTML DataTables inside Card chrome. They are macOS-style Resource Lists: compact rows, hairline separators, accent-tint on hover, accent indicator on the active row.
- **Refined Sidebar / TitleBar / Inspector.** Sidebar selected state uses a 2px accent indicator + soft accent tint (not a grey block). TitleBar is 36px tall with a single-line NSToolbar-style search field. The title bar's π icon and app name are restrained.
- **Unified desktop components.** Button (5 variants, 2 sizes), Input, Select (with custom caret), Switch (28×16 track, 14px thumb), Badge (5 tones + 4 capability tints), Dialog (Graphite with proper animations), EmptyState (compact, no illustration), IconButton, PropertyRow, InspectorSection, SearchField — all share one geometry and one color system.
- **CodeMirror Graphite theme.** Custom theme used in the Config editor, Skills editor, and Diagnostics raw-report viewer. Workspace-colored background, muted syntax, accent selection, 1px focus border.
- **macOS-style scrollbar.** 8px wide, transparent track, ~10% white thumb, hover brightens to ~20%. Never the OS default.
- **Density switch.** "Compact" mode (in Settings → Density) tightens row heights, button heights, and toolbar padding for users who want more density.
- **Removed Card chrome everywhere.** Diagnostics no longer has three Dashboard Cards (replaced by a single Status Strip + Inspector Property Table). Settings and Skills use Section Headers with Property Rows instead of Cards.

### Notes

- No business logic, IPC, domain, store, or service changes. This is a pure visual refactor.
- Light theme is supported and follows the same ladder structure. Density is the only user-controlled visual setting that changes layout geometry.

## 0.2.0 — 2026-08-12

### Reliability

- Unified **Configuration Conflict** dialog (Reload / Compare / Overwrite / Cancel) with line diff
- Provider / Model / Active Model writes now surface `CONFIG_CONFLICT` (first attempt without `overwrite`)
- `setActive` read-back verifies settings.json before updating UI
- Skills edit detects external `SKILL.md` mtime conflict (`SKILL_CONFLICT` → overwrite / reload)

### Skills

- Create / Edit / Import / Validate skills (`SKILL.md`)
- Path-root enforcement; import supports rename / replace (with local backup on replace)
- CodeMirror markdown editor; empty-list create uses Pi `skillsDirs`

### Provider / Model

- Provider advanced: timeout + custom headers JSON
- Model advanced: protocol override toggle + `thinkingLevelMap` editor
- Connection Test 2.0: richer status mapping, endpoint/protocol/model/latency display; resolves stored/env/command credentials in Main

### Config / Diagnostics / Updates

- Config editor: Format JSON, Reveal in Finder/Explorer, i18n actions
- Diagnostics: skillsDirs list, secret backend, copy sanitize
- `electron-updater` wired (packaged builds only; never auto-install)
- Mock fixtures under `fixtures/mock-pi/`
- Playwright Electron smoke E2E (`pnpm test:e2e`)
- `src-tauri/` ignored (legacy Tauri remnant)

### Tests

- Unit tests: diff, skill/provider schemas, api-key wire rules, skills path roots (20 passing)
- E2E smoke: launch + nav Providers/Models/Settings/Config

### Notes

- Signed GitHub Releases required for real auto-update end-to-end
- E2E requires Electron binary downloaded (`node_modules/electron`)

## 0.1.0

Initial Electron + Vue 3 desktop manager for Pi Coding Agent.
