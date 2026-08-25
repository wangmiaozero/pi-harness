# Architecture

Pi-Harness is an Electron desktop control plane and workspace. Pi Coding Agent is the only Agent Runtime; Pi-Harness does not implement a second agent loop.

## Process boundary

```text
Vue Renderer
  │ typed, allowlisted API only
  ▼
Preload (contextBridge)
  │ centralized IPC channels
  ▼
Electron Main
  ├─ AgentRuntime interface ── Pi SDK adapter
  ├─ Workspace ─────────────── sessions, files, Git, worktrees
  ├─ Pi configuration ──────── models/settings adapter and atomic writes
  ├─ Capability domain ─────── skills, packages, featured catalog
  ├─ Environment ───────────── Node/npm/pnpm/Pi discovery and repair
  ├─ Diagnostics ───────────── sanitized cross-domain health report
  └─ SecretStore ───────────── Keychain or safeStorage
```

The renderer has no direct Electron, filesystem, process, shell, or secret-store access. `contextIsolation` stays enabled and `nodeIntegration` stays disabled. Main accepts calls only from the current main window's main frame and validates renderer-controlled values at runtime.

## Agent Runtime

`src/main/agent/runtime.ts` is the application-facing runtime contract. Workspace IPC and diagnostics depend on that contract rather than Pi SDK implementation details. `AgentRuntimeService` is the Pi-backed implementation and owns session start, prompt, abort, stop, tool selection, state, and shutdown coordination.

Pi SDK imports remain in the Main process adapter/runtime area. Renderer stores and views consume normalized shared types and runtime events.

## Configuration and domain adapters

Provider and Model domain objects are adapted to Pi-native `models.json` and `settings.json`. Pi-Harness preserves unknown Pi fields during read/modify/write operations.

Core configuration writes follow this sequence:

```text
Read baseline → detect external change → backup → validate → temporary write → atomic rename
```

The same conflict baseline is refreshed after a restore, so a later edit cannot silently overwrite an external change.

## Capability domain

Skills, Extensions, Packages, MCP entries, and Presets share one Capability model. Current adapters expose local skills, Pi packages, built-in collections, and trusted featured skills. A featured skill is catalog data, not a new runtime or provider.

Package lifecycle work is separated into source identity, inspection/health, permissions, and lifecycle coordination. Built-in skill source validation and hashing are separate from installation ownership and mutation coordination.

See [Capability Layer](capability-layer.md), [Package lifecycle](package-lifecycle.md), and [Built-in Skills](builtin-skills.md).

## Workspace and lightweight editor

Workspace file, Git, worktree, and Agent operations share one allowed-roots gate. Explicit OS picker and native drop actions create durable Main-owned grants. Restoring UI state can reuse a grant but cannot create one.

The editor remains a lightweight text editor and read-only preview surface. It is isolated from Agent execution and intentionally excludes LSP, debugger, task runner, terminal, and IDE extension compatibility. See [Lightweight editor boundary](lightweight-code-editor.md).

## UI and pet state

Views coordinate stores and domain actions; focused dialogs/components own their own presentation lifecycle. The Skills editor, import, confirmation, market detail, and CodeMirror lifecycle live in feature components rather than one monolithic view.

Pet state is a read-only visualization adapter. Durable resolution remains in the shared resolver, temporary animation sequencing remains in the Pet Store, and missing visual resources fall back locally without affecting Agent execution.
