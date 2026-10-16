# Runtime validation

Build Node (currently 22.22.2 in CI) is separate from the bundled Node runtime. The pinned runtime versions, upstream URLs, archive digests, checksum-list digests and tree hashes are in `src/main/runtime/catalog.json`. No host runtime may stand in for bundled execution.

```sh
pnpm runtime:prepare
pnpm runtime:verify
pnpm test:runtime
pnpm release:package
```

Preparation verifies cached downloads and executes native Pi/Node/npm/npx. Runtime tests use isolated configuration, managed-install and session directories, exercising independent selections, RPC persistence, concurrent sessions, managed activation, cancellation, recovery and rollback. The installer gate re-verifies and executes the final installed copies. Playwright's controlled PATH explicitly rejects system Node/npm/npx/Pi and verifies that MCP runs under the bundled Node. The provider responses are local deterministic fixtures; the shipped Pi/Node binaries and Electron processes are real.

`e2e/release-session.spec.ts` creates a real persisted Pi session, exits the application, starts the installed executable again with the same isolated profile, restores the session and continues it. Required installed suites reject skipped/flaky tests. Custom Node restart and invalid selections are also exercised. Unit/integration tests cover System/Custom selection; each native runner remains necessary to establish platform behavior.

Bundled resources are immutable. Runtime updates stage in the user's managed directory, verify provenance and startup, then activate an atomic version pointer. Custom/System selections are not silently replaced. Failures and rollback must preserve session/config data. Network/download/timeout/corruption failures are covered by dedicated integration regressions; see the run logs for actual results rather than inferring success from file presence.
