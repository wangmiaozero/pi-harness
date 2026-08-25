# Contributing

Thank you for helping improve Pi-Harness. Open an issue before a large change so product boundaries and migration risk can be agreed first.

## Development setup

Use Node.js 22 or newer and pnpm 9.12.1.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Use `fixtures/mock-pi` for local development without a Pi installation. Never place real API keys in fixtures, tests, screenshots, logs, issues, or `VITE_*` environment variables.

## Change boundaries

- Pi-Harness is the desktop control plane; Pi Coding Agent remains the only Agent Runtime.
- Keep Skills, Extensions, Packages, MCP entries, and Presets in the shared Capability domain.
- Keep the editor lightweight. Do not add LSP, debugger, task runner, integrated terminal, or IDE plugin compatibility without an explicit product decision.
- Pet state is visualization only and must not mutate Agent, streaming, tool, provider, session, or file behavior.
- Preserve unknown Pi configuration fields and the backup/validation/atomic-write pipeline.

## Implementation expectations

- Renderer code uses the typed preload API only. Add centralized channels, shared request/response types, and Main runtime schemas together.
- Validate paths lexically and through real paths; destructive operations need tests for traversal and symlink behavior.
- Use executable/argument arrays for processes. Do not interpolate renderer data into shell commands.
- Use the shared error hierarchy and logger redaction. Do not log secrets or return them to the renderer.
- Keep services and views cohesive. Extract a component/module when it owns a clear lifecycle or domain responsibility, not merely to reduce line count.

## Verification

Follow [the testing guide](docs/testing.md). At minimum, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
```

Run `pnpm test:e2e` for changes to IPC, Main/Preload boundaries, navigation, Workspace, settings, capabilities, or packaging-sensitive UI.

## Authorship and commits

The project author and repository identity are wangmiao (`tuziling84@gmail.com`). Do not add AI systems, assistants, editors, or automation as authors, co-authors, maintainers, copyright holders, or commit trailers. In particular, do not add `Co-authored-by` or “made with” metadata for a tool. Accepted repository commits retain the configured wangmiao authorship identity.

Keep commits focused and explain user-visible or security-sensitive behavior in the pull request description.
