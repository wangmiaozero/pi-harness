# Capability Layer and featured skills

Pi-Harness remains a desktop control plane and workspace for Pi Coding Agent:

```text
Renderer → typed IPC → Main CapabilityService → Pi skill directories
                                              ↓
                                      Pi Coding Agent Runtime
```

Pi-Harness does not implement an agent loop, skill executor, session runtime, or provider for a capability. Pi discovers and executes installed skills.

## Domain model

The shared Capability model supports these types without creating separate incompatible registries:

- `skill`
- `extension`
- `package`
- `mcp`
- `preset`

The current implementation adapts local/package Skills and the trusted featured catalog. Extension, MCP, and Preset marketplace/runtime work is intentionally deferred.

Odai is catalog data with `type: skill`, sourced from `https://github.com/orziz/odai`. It has no special Runtime, Agent, Provider, Session, Executor, or IPC handler.

## Installation security

Renderer sends only a constrained `skillId`. Main resolves the corresponding source URL and selector from the trusted catalog. Zod rejects unknown fields, including renderer-supplied URLs, paths, sources, and targets.

For a trusted Skills CLI entry, Main:

1. Detects the active Pi configuration and explicitly selects its global `skills` root.
2. Executes npm/Skills CLI with an argument array and no interpolated shell command.
3. Starts from an environment allowlist, redirects `HOME`, `USERPROFILE`, and `XDG_CONFIG_HOME` to an isolated temporary directory, isolates npm config/cache, and disables package lifecycle scripts.
4. Locates the selected skill, requires `SKILL.md`, parses its metadata, and verifies the selector.
5. Copies it into a temporary sibling under the Pi root and atomically renames it into place.
6. Rescans Skills and reports success only when Pi-Harness can discover the installed skill.

One Main-process mutation lock exists per skill id. Progress and sanitized failure details cross a one-way event channel; raw secrets are never logged or rendered. Only a safe error code, action, and timestamp are persisted so a failed status can be restored after restart.

Skill reads and writes are constrained to discovered Pi skill/package roots using both lexical and real-path checks. External symlink targets are excluded from discovery and cannot be followed by write or destructive operations.

## Enable state and metadata

Pi-Harness does not invent an `enabled` field in Pi settings. Harness-only state is stored in Electron user-data `metadata.json` under `capabilities`.

Disabling a managed featured skill moves it to a hidden sibling directory inside the same validated Pi skill root. Enabling moves it back. This keeps the Pi-native configuration untouched while making discovery state explicit and reversible.

Metadata may contain `enabled`, `favorite`, `installSource`, `sourceUrl`, `installPath`, timestamps, category, and tags. It must not contain secrets.

## Backups and tests

Updates, uninstalls, local deletes, and import replacements copy the current skill directory to `capability-backups` under Pi-Harness user data before mutation. A failed capability replacement attempts to restore the snapshot; a failed local backup aborts the destructive operation.

Unit/integration tests use temporary directories. Electron E2E copies `fixtures/mock-pi` into a per-test user-data directory and uses `fixtures/capabilities`; no test writes to the developer's real Pi directories.
