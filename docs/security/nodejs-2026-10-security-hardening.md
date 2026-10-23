# Node.js October 2026 security hardening

Evidence reviewed: 2026-10-23. Outcome: implementation and merge validation PASS; release verification BLOCKED by missing Electron backport evidence. No release was published.

## Official sources

- [Node.js October 21 security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Node.js 24.22.1 release notes](https://nodejs.org/en/blog/release/v24.22.1)
- [Official release index](https://nodejs.org/dist/index.json)
- [Official checksum list](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt)
- [Node.js lifecycle schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
- [Electron release versions](https://releases.electronjs.org/?channel=stable)
- [Electron 44.9.0](https://releases.electronjs.org/release/v44.9.0)
- [Electron 44.9.3](https://github.com/electron/electron/releases/tag/v44.9.3)
- [Electron advisory GHSA-3qxv-5xgr-q7w9](https://github.com/electron/electron/security/advisories/GHSA-3qxv-5xgr-q7w9)

## Runtime inventory and changes

| Runtime                          | Before                              | Candidate                          | Evidence                                                           |
| -------------------------------- | ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| CI/build/test Node               | CI 22.22.2; development pin 22.19.0 | 24.22.1 LTS                        | Official native build Node executed; workflow pins updated         |
| Bundled Node                     | 24.22.0                             | 24.22.1                            | All six archives and trees verified                                |
| Bundled npm/npx                  | 11.19.1                             | 11.19.1                            | Read from every official archive; native version commands executed |
| Electron                         | 44.9.0                              | 44.9.0                             | Actual binary versions probed independently                        |
| Electron internal Node           | 24.22.0                             | 24.22.0                            | NOT_VERIFIED for complete October advisory coverage                |
| Pi Binary and seven SDK packages | 1.3.0                               | 1.3.0                              | SDK matrix and real standalone execution                           |
| System/Custom Node               | Owner-selected                      | Owner-selected, security validated | No system replacement or configuration migration                   |

The Pi package build script uses `bun build --compile`; the installed Pi binary also runs with Node absent from PATH. This establishes independent Pi execution. Its exact embedded Bun revision was not independently measured. It must not be treated as the external Node runtime or as Electron Node.

## Six-platform resource evidence

Official base URL: `https://nodejs.org/dist/v24.22.1/`. Checksum-list SHA-256: `fdfbffc969c0f604beff0124d409b33a43b53f5c681d6220f80023e0d6df9dc4`.

Every archive was downloaded from the official Node distribution site, matched against its official checksum entry, safely extracted, checked for platform/architecture and npm version, and inventoried to calculate a new complete tree digest. Old tree digests were not reused.

| Platform     | Archive / tree verification | Native execution                         |
| ------------ | --------------------------- | ---------------------------------------- |
| darwin-arm64 | PASS                        | PASS: Node/npm/npx                       |
| darwin-x64   | PASS                        | PASS: native CI runtime/installer checks |
| linux-arm64  | PASS                        | PASS: native CI runtime/installer checks |
| linux-x64    | PASS                        | PASS: native CI runtime/installer checks |
| win32-arm64  | PASS                        | PASS: native CI runtime/installer checks |
| win32-x64    | PASS                        | PASS: native CI runtime/installer checks |

| Platform     | Archive SHA-256                                                    | Tree SHA-256                                                       |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| darwin-arm64 | `89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7` | `98bc32d74e1432e70713480c2ffa98db5de7c88422f758d0ddf524157f596ac2` |
| darwin-x64   | `d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035` | `89ac3f5c0d2833c4aac3ce75b29d4cb98d43f68030d1417d6eb53d67531557e7` |
| linux-arm64  | `33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3` | `dfd04ee35595bb358ae0dcbb694fa74c39f1475aaa07f38b830ef2b9f01ee02e` |
| linux-x64    | `eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c` | `1a2b77bd65f4cb73833574f79ca53ceb432a27077815a74f2b980f0462d2f713` |
| win32-arm64  | `a0c807319fede24c4a0d8f84564c82a619bd313b16b10c007c383c2609e99171` | `f5e4e5e937debfd9e0f53592511171c51b3c09cedeb2e13a61b6023528fd143d` |
| win32-x64    | `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5` | `b40f6d7aab07639e3535318ecff2f89217c127ccda1657a6755aaf59dfa8e722` |

Full archive names and pinned values are maintained in `src/main/runtime/catalog.json`. The update command is `node scripts/runtime/update-node-catalog.mjs --node-version=24.22.1 --write`; `--curl` is an explicit official-HTTPS transport alternative. Both transports perform identical digest checks.

## Security and lifecycle policy

Functional compatibility, advisory patch state, lifecycle and execution eligibility are separate fields. The current functional minimum remains 22.19.0; functional compatibility alone never authorizes execution.

| Major | Required patch baseline | Official end of maintenance |
| ----- | ----------------------- | --------------------------- |
| 22    | 22.23.4                 | 2027-04-30                  |
| 24    | 24.22.1                 | 2028-04-30                  |
| 26    | 26.12.1                 | 2029-04-30                  |

Node 24 is the build and bundled default. Security-patched Node 22 remains a permitted owner-selected runtime while maintained. Node 26 passes security version policy only at its baseline and still undergoes native identity/version validation plus an actual required-API probe; complete Node 26 application compatibility has not been certified. Prereleases, malformed versions and unknown future majors are UNVERIFIED. EOL lines, including 20, 23 and 25, are rejected. Larger major numbers are not evidence of security.

Statuses: SUPPORTED, OUTDATED, VULNERABLE, END_OF_LIFE and UNVERIFIED. Rejected executable probes retain the actual version, reason, patch baseline and recommended official version. Settings display the risk and remediation. Cached runtime metadata is reassessed for lifecycle eligibility before use.

The shared policy protects runtime selection, npm/npx execution, npm Pi entry points, package operations and architecture rendering. Agent-start preflight rejects ordinary Node/npm/npx MCP dependencies when the selected Node is unavailable or unsafe. It reads global and project candidates without rewriting configuration. SDK mode additionally validates the Node inherited by its transport, since a valid selected Node does not establish the identity of a bare command on Main PATH. RPC resolves project trust in the child, so preflight conservatively checks both global-only and project-merged possibilities until trust is resolved.

Native/Python/Docker/remote-only MCP and standalone Pi remain independent of external Node. No session, Provider credential, MCP configuration, extension configuration or system Node installation is migrated or deleted.

This is an execution preflight, not an OS sandbox. Explicit foreign executables, user-supplied shell scripts, MCP PATH overrides, trusted extensions registering commands after startup and configuration edits/reconnects during a running session remain user-controlled execution boundaries. They are not claimed to be comprehensively confined by this patch.

## Official CVE impact matrix

Affected branches below follow the October advisory. “Fixed” applies to official external Node versions at or above the maintained branch baseline; it is not an Electron backport determination.

| CVE             | Severity | Affected maintained branches | Node 24.22.1             |
| --------------- | -------- | ---------------------------- | ------------------------ |
| CVE-2026-111497 | high     | 22, 24, 26                   | Fixed                    |
| CVE-2026-105482 | high     | 22, 24, 26                   | Fixed                    |
| CVE-2026-105483 | high     | 24, 26                       | Fixed                    |
| CVE-2026-106069 | high     | 22, 24, 26                   | Fixed                    |
| CVE-2026-105481 | medium   | 22, 24, 26                   | Fixed                    |
| CVE-2026-106072 | medium   | 22, 24, 26                   | Fixed                    |
| CVE-2026-106074 | medium   | 22, 24, 26                   | Fixed                    |
| CVE-2026-106070 | low      | 26                           | Not affected by this CVE |
| CVE-2026-106071 | low      | 26                           | Not affected by this CVE |
| CVE-2026-106073 | low      | 22, 24, 26                   | Fixed                    |

Eight advisory CVEs apply to Node 24. CVE-2026-106070 and CVE-2026-106071 apply only to Node 26. No exploit payload was created; validation uses official patched releases, archive integrity, policy boundary tests and legitimate runtime/transport fixtures.

## Application boundary review

| Area                            | Review result / limit                                                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brotli and HTTP keep-alive      | No direct application Brotli decoder use identified; Node-based HTTP clients can use runtime networking/decompression. Official external Node patch coverage applies to that runtime, while Electron networking remains separately unverified.      |
| DNS and TLS hostnames           | Default platform certificate validation is retained. No new `rejectUnauthorized:false`, hostname bypass, custom CA bypass or insecure download mirror was introduced.                                                                               |
| Provider endpoints and MCP HTTP | User-configured local endpoints remain supported. A desktop user choosing a local Provider is not automatically a remote SSRF vulnerability. This patch does not claim a complete endpoint/redirect/proxy security audit or modify authentication.  |
| Proxy and SSRF                  | Runtime downloads stay fixed to official HTTPS sources. Arbitrary user-defined tool/network access remains a trusted-code boundary; upgrading Node does not constrain it.                                                                           |
| Snapshots/randomness            | No application Node user-land startup snapshot/SEA construction path was found. This does not establish Electron or Bun CVE immunity.                                                                                                               |
| Permission Model                | No application reliance on Node Permission Model was identified. Existing IPC, workspace containment and capability permission tests remain the application controls.                                                                               |
| Electron IPC                    | Existing context isolation, disabled renderer Node integration, typed preload, sender validation and input schemas are preserved. ESM-preload windows retain their existing sandbox setting; the isolated architecture viewer retains sandbox:true. |

## Electron independent review

Actual installed Electron 44.9.0 reports Node 24.22.0, Chromium 152.0.7977.167, V8 15.2.124.43-electron.0 and module ABI 149. The actual official Node 24.22.1 build executable reports module ABI 137 and N-API 10. These must not be substituted for Electron ABI 149.

The published frame-subscription advisory is patched in Electron 44.4.3 and therefore does not identify 44.9.0 as affected. The evaluated 44.9.3 patch includes Chromium/V8-family backports, but the official release table still lists Node 24.22.0 and complete October Node backport coverage was not established. No unverified Electron major upgrade was made.

Electron status remains NOT_VERIFIED. `src/shared/runtime/electron-security-review.json` has no approved exact-version entry. A formal release gate refuses publication until an exact Electron version has supporting upstream patch sources and application regression evidence. Node version-string comparison alone cannot grant Electron PASS.

## Verification record

| Command / evidence                                                       | Result                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --offline` under official Node 24.22.1   | PASS                                                                                                                                                                                           |
| `pnpm typecheck`                                                         | PASS; repeated after execution-guard changes                                                                                                                                                   |
| `pnpm lint`                                                              | PASS; repeated after execution-guard changes                                                                                                                                                   |
| `pnpm compile`                                                           | PASS on the final guard code                                                                                                                                                                   |
| `pnpm exec vitest run --maxWorkers=2`                                    | 1,545 PASS, 10 platform/variant skips on the final code including bridge cleanup                                                                                                               |
| Guard/runtime/process focused tests                                      | 152 PASS, 3 platform skips in runtime/agent/process focused suites; the final complete run also passes                                                                                         |
| Real Pi RPC including ordinary-MCP rejection and remote-MCP-without-Node | 17 PASS                                                                                                                                                                                        |
| `pnpm audit --prod --audit-level high`                                   | PASS: 451 production dependencies, zero reported advisories                                                                                                                                    |
| `pnpm runtime:prepare --offline` / `pnpm runtime:verify`                 | PASS: Pi 1.3.0, Node 24.22.1, npm/npx 11.19.1                                                                                                                                                  |
| `pnpm test:runtime`                                                      | PASS on the final local candidate: 79 passed, 1 platform skip; all native CI runtime gates also PASS                                                                                           |
| `pnpm runtime:check --offline --native`                                  | PASS; pinned SDK matrix and native runtime integrity/execution                                                                                                                                 |
| `pnpm security:node --all-platforms --online --audit`                    | Initial local report: Node checks and audit PASS; NOT_VERIFIED for Electron and foreign execution. Later native CI covers all six execution targets; Electron remains NOT_VERIFIED             |
| Complete existing Electron E2E                                           | 111 PASS, 4 intended variant/installer skips, 1 login-profile fixture failure in the initial full run; corrected navigation fixture and final-build MCP/Provider/session suites all PASS (4/4) |
| `pnpm release:package` / installed app checks                            | PASS on macOS arm64: standard 12/12 and nomascot 13/13 installed E2E; actual installed Node 24.22.1 integrity/execution PASS; runtime security remains NOT_VERIFIED                            |
| Windows and other foreign native runners                                 | PASS: six native platform package jobs and six retained-profile upgrade jobs in CI run 39876511657                                                                                             |

The first complete E2E attempt found the navigation-performance fixture selecting an unsafe developer login-shell Node. The fixture now uses an isolated shell and the test runner’s actual verified Node, retaining real executable/version probing. This is a test-isolation correction, not a production security bypass. The focused rerun passed on the final compiled build. The initial local 30-minute run is retained as 111 passes, 4 expected skips and the one repaired fixture failure. The final Linux CI run then completed the full suite with 111 passes and 5 intended platform/variant skips.

Streaming, Provider registration, images, session persistence/resume, native tool execution, Node/npm/npx MCP, remote MCP, source switching and Pi rollback are covered by existing runtime fixtures using temporary config and local mock servers. Arbitrary third-party extensions/native modules and real paid Provider accounts were not certified.

## CI, release and rollback

Existing quality, audit, native package and upgrade matrices remain in place. The initial local macOS arm64 package evidence has `sourceStable: true` and source digest `ccd646081d201fd4b144ae248ff43570ae572726918b51dfe9c0454f27741a9f`. Both variants report build/installer/runtime/E2E PASS and runtimeSecurity NOT_VERIFIED. `out/community-packages/darwin-arm64/evidence.json` and the per-variant reports under `out/community-validation/darwin-arm64/` retain those results. Package readiness describes local installer verification only; it does not authorize a security release. All setup-node pins and the development pin now select 24.22.1; package engines restrict build/development to Node 24 LTS at or above that patch. Source compilation and packaging reject an unsupported build Node. Native jobs verify real package runtimes and both community variants. Existing signing, checksum collection, historical-release protection and manual-update policy remain intact.

Machine reports are written to `out/security/node-runtime.json`. FAIL exits nonzero for unsafe build/catalog Node, bad provenance, wrong actual binary version or integrity failure. Missing external evidence remains NOT_VERIFIED. `--release` also rejects an overall result other than PASS. Build Preview remains available; strict release enforcement applies to formal tag release runs. Installers were uploaded only as CI workflow artifacts. No tag, public Release publication or historical release overwrite was performed.

Prepared resources use version-specific archive/checksum caches. Real stale-resource verification also rejected a legacy archive copied under the new cache name, preserved the original 24.22.0 directory on failure, and then prepared/verified 24.22.1 from the correct official offline cache. The result is recorded in `out/security/upgrade-transaction.json`. A stale receipt triggers fresh candidate preparation and full verification before directory activation. `--verify` is read-only; `--refresh` forces re-preparation. A failed download, checksum or activation preserves/restores the prior directory. Runtime selection and managed update pointers retain existing atomic writes, idle-session checks and validated rollback. An old known-vulnerable runtime is not authorized merely because its bytes were restored during transaction recovery.

For users: choose Bundled and use the existing verified-runtime install/repair action, or explicitly install a maintained official System/Custom Node patch and verify it in Settings. The app does not silently replace system Node. Preserve user data and use the existing manual application upgrade/rollback route; native CI has now completed retained-profile installer upgrades using locally built 2.2.9 → 2.2.10 fixtures on all six platforms. An upgrade from a historical published installer containing Node 24.22.0 remains NOT_VERIFIED. This does not enable automatic installation or grant Electron security approval.

Future maintenance: review the official security advisory and schedule; update the shared branch minima/CVE matrix and exact Electron review; regenerate all official catalog hashes; update CI/development pins together; then run native runtime, installer, retained-profile and MCP regression gates. Do not turn an unavailable audit, missing runner or absent backport statement into PASS.

## Merge verification on 2026-10-23

[CI run 39876511657](https://github.com/wangmiaozero/pi-harness/actions/runs/39876511657) completed successfully for code commit `c75bd702b2f9f2b2c6d8ea8e36f9d542d4ffbb13`: all 13 jobs passed. This includes source quality and full Electron regression, standard/nomascot installed packages on darwin arm64/x64, Windows arm64/x64 and Linux arm64/x64, and real retained-profile manual upgrades using locally built 2.2.9 → 2.2.10 fixtures on those same six native targets. Windows x64 and ARM64 each passed 186 environment/process/plugin regressions with 7 intended platform skips, followed by real runtime and both installed-app variant gates.

The initial Windows native run exposed concurrent bridge cleanup from process exit and explicit session stop, producing `EPERM` when both removed the same temporary directory. Cleanup now shares one promise and uses bounded filesystem retries. A real-socket regression failed before the fix and passed afterward; it is included in every native runtime gate. No runtime security enforcement or native verification was skipped to obtain the successful rerun.

The report-only update following that tested code changes no executable source. Electron October advisory coverage remains NOT_VERIFIED and the formal release gate remains blocked. A successful merge-validation matrix does not establish security release readiness.

## Changed files

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.nvmrc`
- `README.de-DE.md`
- `README.fr-FR.md`
- `README.ja-JP.md`
- `README.ko-KR.md`
- `README.md`
- `README.ru-RU.md`
- `README.zh-CN.md`
- `README.zh-TW.md`
- `docs/security/nodejs-2026-10-security-hardening.md`
- `e2e/dual-runtime.spec.ts`
- `e2e/fixtures.ts`
- `e2e/navigation-performance.spec.ts`
- `package.json`
- `scripts/release/native-package.mjs`
- `scripts/runtime/before-pack.mjs`
- `scripts/runtime/prepare-runtime.mjs`
- `scripts/runtime/prepared-runtime.d.mts`
- `scripts/runtime/prepared-runtime.mjs`
- `scripts/runtime/update-node-catalog.mjs`
- `scripts/runtime/verify-sdk.mjs`
- `scripts/runtime/test-runtime.mjs`
- `scripts/security/check-node-runtime.mjs`
- `src/main/agent/agent-runtime-service.ts`
- `src/main/agent/desktop-bridge.ts`
- `src/main/agent/desktop-bridge.test.ts`
- `src/main/agent/pi-rpc-runtime.test.ts`
- `src/main/agent/pi-rpc-runtime.ts`
- `src/main/environment/environment-manager.test.ts`
- `src/main/environment/environment-manager.ts`
- `src/main/environment/node-installer-archive.test.ts`
- `src/main/environment/node-installer.test.ts`
- `src/main/environment/node-installer.ts`
- `src/main/intelligence/archify.ts`
- `src/main/pi/environment.ts`
- `src/main/pi/install-service.ts`
- `src/main/pi/node-environment.test.ts`
- `src/main/pi/node-environment.ts`
- `src/main/pi/node-runtime.test.ts`
- `src/main/process/pi-process.test.ts`
- `src/main/process/pi-process.ts`
- `src/main/runtime/catalog.json`
- `src/main/runtime/mcp-compatibility.ts`
- `src/main/runtime/node-execution-guard.test.ts`
- `src/main/runtime/node-execution-guard.ts`
- `src/main/runtime/prepared-runtime.test.ts`
- `src/main/runtime/runtime-manager.test.ts`
- `src/main/runtime/runtime-manager.ts`
- `src/main/runtime/runtime-versions.ts`
- `src/main/runtime/validator-security.test.ts`
- `src/main/runtime/validator.ts`
- `src/renderer/src/components/settings/RuntimeSettingsSection.vue`
- `src/shared/ipc/api-types.ts`
- `src/shared/runtime/electron-security-review.json`
- `src/shared/runtime/node-security-policy.d.mts`
- `src/shared/runtime/node-security-policy.json`
- `src/shared/runtime/node-security-policy.mjs`
- `src/shared/runtime/node-security-policy.test.ts`
- `src/shared/runtime/schema.ts`
