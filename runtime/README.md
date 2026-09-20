# Pi-Harness Runtime

Node.js sidecar runtime for the Pi-Harness desktop host. The renderer never
talks to this process directly — the Rust host (src-tauri) supervises it and
proxies a JSONL JSON-RPC style protocol over stdin/stdout.

## Layout

```
runtime/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts            entry: stdin/stdout JSONL loop
    ├── version.ts          runtime + protocol version constants
    ├── protocol/
    │   ├── messages.ts     typed protocol messages + validation
    │   └── dispatch.ts     method registry (runtime.*)
    └── transport/
        └── jsonl.ts        line reader / writer, stderr diagnostics
```

Planned module growth (one migration phase at a time, see
`docs/tauri-migration/migration-plan.md`): `agent/`, `harness/`,
`orchestration/`, `sessions/`, `skills/`, `providers/`, `models/`,
`workspace/` — each migrating the matching `src/main/<domain>` service from
the Electron main process into runtime RPC methods. Do not migrate more than
one domain per phase.

## Build

From the repository root:

```bash
pnpm runtime:build      # tsc -p runtime  -> runtime/dist
pnpm runtime:typecheck  # tsc -p runtime --noEmit
```

The runtime has no runtime dependencies; it only uses Node built-ins so the
sidecar stays small and startable by the Rust host with any Node >= 22.

## Protocol summary

- stdin: `{"id":"req_1","method":"runtime.ping","params":{}}` (one JSON per line)
- stdout: `{"id":"req_1","result":{...}}` / `{"id":"req_1","error":{"code":"...","message":"..."}}`
- stdout events: `{"type":"event","event":"runtime.ready","payload":{...}}`
- stderr: free-form diagnostics (never protocol data)

Implemented methods (protocol version 1):

- `runtime.ping` → `{ pong: true, timestamp }`
- `runtime.version` → `{ runtimeVersion, protocolVersion, nodeVersion }`
- `runtime.status` → `{ running, pid, uptimeMs, runtimeVersion, protocolVersion }`
- `runtime.shutdown` → `{ stopping: true }` (graceful exit)

Full contract: `docs/tauri-migration/protocol.md`.

## Constraints

- stdout is protocol-only; any log/diagnostic on stdout corrupts the stream.
- Answers are exactly once per request id, including error paths.
- The process must exit 0 on graceful shutdown so the host can distinguish
  clean stops from crashes.
