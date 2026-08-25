# Testing

Pi-Harness uses three test layers.

## Unit

Vitest covers parsers, schemas, adapters, normalization, error serialization, redaction, environment resolution, path containment, package identity/health, capability lifecycle, and renderer stores/components.

```bash
pnpm test
pnpm test:watch
```

Security regressions should include a negative test: traversal, symlink escape, unknown IPC field, invalid identifier, oversized payload, or stale revision as appropriate.

## Integration

Service tests use temporary directories and real JSON stores where useful. They cover storage/config coordination, package and skill lifecycle, atomic replacement/rollback, external-change conflicts, durable workspace grants, and command execution behavior. Tests must not use the developer's Pi configuration or credentials.

## Electron E2E

Playwright launches the compiled Electron app with a fresh user-data directory, a copied mock Pi configuration, a missing mock CLI, isolated `PI_CODING_AGENT_DIR`, capability fixtures, and preauthorized temporary workspace roots. No real API key or external model request is required. The fixture binds to the main renderer and ignores the optional screen-motion overlay window.

```bash
pnpm test:e2e       # compile + all Electron tests
pnpm test:e2e:only  # reuse the current out/ build
```

`smoke.spec.ts` retains the broad navigation and Workspace golden flows while focused suites now own application shell, environment, Provider, Model, and Capability behavior. Continue migration by domain when a test is changed; do not split tests only to make the directory look symmetrical.

Prefer behavior and accessible roles/test IDs over CSS class assertions. Scope locators to the owning region so real session names or translated text do not create strict-locator collisions.

## Local quality gate

Run before handing off a change:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm compile
pnpm test:e2e:only
```

CI runs that full Linux quality/E2E gate. Windows and macOS additionally package installers as build smoke tests.
