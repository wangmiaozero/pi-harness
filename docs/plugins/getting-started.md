# Develop and install a Harness Plugin

Read [security](security.md) first. Plugins are local and opt-in. You do not need a remote marketplace or an account.

To connect an MCP server, use **Settings → MCP** and its marketplace. For voice, instructions, subagents, and remote hosts, see the [agent settings guide](../agent-settings.md). Harness Plugins are managed separately under **Workspace → Tools → Harness → Harness Plugins**.

## Try the examples

The repository includes three self-contained examples:

| Example           | Installation directory                                                                                       | What to try                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run Metrics       | [`examples/harness-plugins/run-metrics`](../../examples/harness-plugins/run-metrics/plugin.json)             | Enable, run a normal Pi task, then refresh diagnostics to see observed duration/tool statistics. These best-effort counts are explicitly non-authoritative.                   |
| Quality Evaluator | [`examples/harness-plugins/quality-evaluator`](../../examples/harness-plugins/quality-evaluator/plugin.json) | Select a settled run, evaluate it and inspect the structured result. The same example also exports minimized JSON traces.                                                     |
| Team Template     | [`examples/harness-plugins/team-template`](../../examples/harness-plugins/team-template/plugin.json)         | Approve its template permission, create a draft in a chosen project, inspect Development → Test → Review in Agents, then decide whether to start it. No plugin code executes. |

1. Build/run the desktop app from this branch using the repository's existing development commands (`pnpm install --frozen-lockfile`, `pnpm dev`).
2. Open **Workspace → Tools → Harness → Harness Plugins**. A Pi session is not required to install a plugin.
3. Click **Install local plugin** and choose one of the directories above. Installation validates/copies it but leaves it disabled.
4. Inspect the ID, author, versions and requested permissions, then click **Enable**. Canceling the native dialog grants nothing. For executable examples, first review `main.mjs` and explicitly accept the code-trust warning.
5. Use the contribution buttons. Disable cleans subscriptions/registrations; uninstall also removes installed files, approvals and saved plugin evaluation results.

Running a normal Pi task can incur your configured model provider's charges. Installing examples, viewing data and creating a pending team do not start model requests. The automated example tests use isolated local fixtures and do not require a real API key.

## Build your own

1. Start with an example folder and choose a globally distinctive lowercase ID.
2. Edit `plugin.json`: exact plugin version, supported SDK range and the smallest set of permissions/contributions.
3. For code, implement `activate(api)` and optional `deactivate()`, retaining and disposing subscriptions/registrations. Use only the public [SDK contract](../../packages/harness-plugin-sdk/index.ts).
4. Type-check against a local installation of `packages/harness-plugin-sdk` if authoring TypeScript. Bundle dependencies into one `.mjs` file; the MVP does not install dependencies or run package scripts.
5. Check inputs/results against [manifest](manifest.md) and [API](api-reference.md), then install a local copy and enable it through the native approval flow.
6. Test failure and disposal paths as well as success. To update installed bytes or requested permissions, uninstall/reinstall and obtain new approval.

## Common failures

| Diagnostic / symptom          | Resolution                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Incompatible API              | Set an API range supported by the app; do not force loading.                                                                         |
| Duplicate plugin ID           | Choose a different ID, or explicitly uninstall the old plugin first.                                                                 |
| Permission/code trust denied  | Review the request; enable only when you agree. A manifest cannot grant itself permission.                                           |
| Content changed               | Reinstall the reviewed bytes. Existing trust is bound to a content digest.                                                           |
| `PLUGIN_ACTIVATION_FAILED`    | Check the default export, manifest registrations and declared permissions. Syntax errors and module load exceptions fail activation. |
| `PLUGIN_PROCESS_EXIT`         | Inspect your plugin for explicit exits/crashes and retry only after fixing it.                                                       |
| `PLUGIN_TIMEOUT`              | Reduce callback work; synchronous loops and unresolved promises are terminated.                                                      |
| `PLUGIN_EVENT_QUEUE_OVERFLOW` | Reduce event work/subscriptions. Dropped telemetry is not replayed automatically.                                                    |
| No evaluation/trace           | Select a settled run in the current session; a trace must actually exist.                                                            |
| Unsafe path/file              | Use regular local files, not symlinks, hard links, traversal paths or oversized entries.                                             |

The host intentionally does not return plugin stack traces or sensitive raw input. Reproduce with your own local plugin tests and harmless fixtures. Do not add live credentials to diagnostics, screenshots or issues.

## Validation commands

The existing project commands remain authoritative: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm compile` and `pnpm test:e2e:only`. Focused plugin tests are under `src/shared/harness-plugins` and `src/main/harness/plugins`; Electron plugin coverage is in `e2e/harness-plugins.spec.ts`. Harness regression tests remain under `src/main/harness`.
