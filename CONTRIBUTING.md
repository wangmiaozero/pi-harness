# Contributing

Thank you for helping improve Pi-Harness. Open an issue before a large change so product boundaries and migration risk can be agreed first.

## Development setup

Use Node.js 22 or newer and pnpm 9.12.1.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Use `fixtures/mock-pi` for local development without a Pi installation. Never place real API keys in fixtures, tests, screenshots, logs, issues, or `VITE_*` environment variables.

## Verification

At minimum, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
```

Run `pnpm test:e2e` for changes to IPC, Main/Preload boundaries, navigation, Workspace, settings, capabilities, or packaging-sensitive UI.

## Authorship and commits

The project author and repository identity are wangmiao (`tuziling84@gmail.com`). Do not add AI systems, assistants, editors, or automation as authors, co-authors, maintainers, copyright holders, or commit trailers. In particular, do not add `Co-authored-by` or “made with” metadata for a tool. Accepted repository commits retain the configured wangmiao authorship identity.

Keep commit subjects concise, use `feat:` or `fix:`, and mention only the user-visible addition or fix.
