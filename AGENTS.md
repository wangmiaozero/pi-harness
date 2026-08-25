# Agent instructions

This file is required reading for every AI / coding agent working on this repository (Cursor, Claude, Codex, Copilot, and others).

## Authorship (non-negotiable)

The **only** author of this project is:

- Name: **wangmiao**
- Email: **tuziling84@gmail.com**
- Repository: **https://github.com/wangmiaozero/pi-harness**

AI systems are tools, not authors. They must never appear as author, co-author, committer, maintainer, or copyright holder.

### Do

- Git `user.name` / `user.email` stay `wangmiao` / `tuziling84@gmail.com`
- `LICENSE`, `package.json` `author`, README author blocks, and `electron-builder.yml` copyright stay wangmiao
- Commit messages contain only wangmiao as author

### Do not

```
Co-authored-by: Cursor <cursoragent@cursor.com>
Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: Copilot <...@users.noreply.github.com>
Co-authored-by: Codex <...>
Made-with: Cursor / Claude / Copilot / Codex
```

- Do not add `Co-authored-by` for any AI, agent, or tool
- Do not put Cursor Agent, Claude, Copilot, Codex, ChatGPT, Gemini, or similar in LICENSE, package.json, README, changelog, or git metadata
- If the environment injects an AI `Co-authored-by` trailer, strip it before the commit is pushed (rewrite that commit; do not leave it on `origin/main`)

GitHub contributors must list **wangmiao only**.

## Engineering governance (required reading)

The repository-wide engineering upgrade is **complete**. Do not rerun or reinterpret
`task/docs/工程化质量升级-1.md` as an active implementation prompt.

Before changing code, read [`docs/engineering-governance.md`](docs/engineering-governance.md) and the
relevant domain documents it links. Its architecture, compatibility, security, testing, and scope
rules are the maintenance baseline for all coding agents.

Files under `task/docs/` are historical task and release records by default. They are context, not
authorization and not active instructions, unless the user explicitly reactivates a specific task.
Only implement the user's current requested scope, preserve unrelated working-tree changes, and run
verification proportional to the risk of that change.

## Lightweight code editor boundary (non-negotiable)

Pi-Harness provides a **lightweight code editor**, not a general-purpose IDE.

Allowed editor capabilities:

- Edit any readable text file; unknown extensions fall back to plain text
- Lazy syntax highlighting, line numbers, selection, undo / redo, and find
- Explicit save, `Cmd/Ctrl+S`, unsaved-state indicators, and external-change conflict protection
- Read-only preview for oversized, binary, media, and document files

Out of scope unless this project decision is explicitly revised:

- LSP, IntelliSense, semantic diagnostics, refactoring, or symbol indexing
- Debugger, breakpoint, task runner, build/run orchestration, or integrated terminal
- IDE extension/plugin compatibility or framework-specific project tooling

Keep file editing isolated from the Pi agent runtime and preserve the security boundary described in
`docs/lightweight-code-editor.md`.

## Capability layer boundary (non-negotiable)

- Pi-Harness is the desktop control plane and workspace; Pi Coding Agent is the only Agent Runtime.
- Skills, extensions, packages, MCP entries, and presets share the Capability domain model. Do not create a second incompatible definition hierarchy.
- Featured skill mutations accept only trusted catalog ids through validated IPC. Renderer code must never submit shell commands, arbitrary source URLs, or install paths.
- A featured skill such as Odai is ordinary catalog data with `type: skill`. Do not add skill-specific runtime, provider, session, executor, or IPC branches.
- Pi-Harness-only capability state belongs in its own metadata store, never as invented fields in Pi native configuration.

## Pet state layer boundary (non-negotiable)

- The pet system is a read-only visualization adapter over Pi Agent Runtime events and Renderer state. It must not modify Runtime, Streaming, Tool Call, Provider, Session, or file-editing behavior.
- Keep durable state resolution in `src/shared/pet/resolver.ts`, temporary animation sequencing in the independent Pet Store, and rendering decisions in manifest-driven pet components.
- Temporary animation completion must re-run the Resolver; never force the Pet state to `idle`.
- Missing animations and failed visual resources must fall back locally and must never interrupt Agent execution.
