# Harness Plugin SDK API 1.0

Types are exported by [`@pi-harness/plugin-sdk`](../../packages/harness-plugin-sdk/index.ts). The package is local and is not claimed to be published to a registry. Executable plugins export a default object implementing `HarnessPlugin`:

```ts
import type { HarnessPlugin } from '@pi-harness/plugin-sdk'

let unsubscribe: (() => void) | undefined
const plugin: HarnessPlugin = {
  activate(api) {
    unsubscribe = api.events.subscribe(['run.completed'], ({ event }) => {
      api.diagnostics.log('Run completed', { runId: event.runId ?? '' })
    })
  },
  deactivate() {
    unsubscribe?.()
    unsubscribe = undefined
  }
}
export default plugin
```

Compile/bundle TypeScript to a self-contained top-level `.mjs` entry for installation. The runtime host passes the SDK context directly; installed plugins need no access to private application modules. `definePlugin(plugin)` is an optional identity helper for authoring, not a security or registration bypass.

## Manifest validation

The standalone SDK also exports `pluginManifestSchema`, `teamTemplateSchema`, `pluginIdSchema`, `permissionSchema`, and `compatible` from `@pi-harness/plugin-sdk/manifest`. These are the same schemas used by the desktop host, not a second definition. For example:

```js
import { pluginManifestSchema, compatible } from '@pi-harness/plugin-sdk/manifest'
const manifest = pluginManifestSchema.parse(yourManifestObject)
if (!compatible(manifest)) throw new Error('Unsupported Harness Plugin API')
```

## Events

`api.events.subscribe(types, listener)` returns an unsubscribe function. Only declared, approved event types are accepted:

- `run.started`: `runId`, timestamp. Raw prompts are omitted.
- `run.completed`: `runId`, real Harness status, timestamp.
- `run.failed`: `runId`, timestamp. Raw error text is omitted.
- `tool.completed`: tool name, optional error flag, timestamp. Arguments and results are omitted.
- `evaluation.completed`: `runId`, built-in evaluation status, timestamp.

Each envelope includes a session ID. Tool events do not gain an invented run ID; correlate them using that session's latest observed `run.started`. SDK objects are deeply frozen in the plugin process. Unsubscription removes that callback; disable/uninstall additionally removes the host bridge when no active event plugins remain. Delivery is bounded and best effort. It is not an audit log and can drop events under load; inspect the dropped-event counter.

## Evaluators

`api.evaluators.register({id, version}, handler)` returns a disposer. The manifest must declare the same evaluator ID/version and request `evaluation:read`.

The handler receives `RunEvidence`: run ID, status, start/finish timestamps, total tokens, tool-call count and tool-failure count. No prompt, messages, file content, cwd, provider credentials, command text or original metadata is supplied. Evaluation is explicit, and accepts only settled runs belonging to the selected session.

Return `EvaluatorResult`:

```json
{
  "evaluatorId": "quality",
  "version": "1.0.0",
  "score": 100,
  "status": "passed",
  "findings": [
    { "code": "tool-outcomes", "severity": "info", "message": "No recorded tool failures." }
  ],
  "metadata": { "rubric": "Recorded outcomes only" }
}
```

Scores are finite numbers from 0 to 100; status is `passed`, `warning` or `failed`; finding severity is `info`, `warning` or `error`. JSON metadata, result size and nesting are bounded. The host validates evaluator identity/version, redacts output and persists supplementary results separately. A score does not prove correctness and cannot approve an orchestration review gate.

## Trace exporters

`api.exporters.register({id, version}, handler)` returns a disposer and requires `trace:read`. Export is user-initiated, with a native destination picker before trace transmission. Cancellation supplies no trace to the plugin.

The handler receives `AuthorizedTrace`: run ID, recorded/reconstructed source, and bounded spans with ID, type, status, timestamp and duration. Names, commands, raw events, paths, errors and arbitrary metadata are omitted. Return a bounded JSON value; Main validates/redacts and writes the JSON. No destination path or filesystem handle is passed to the plugin. Existing core JSON/Markdown exports remain available unchanged.

## Diagnostics

`api.diagnostics.log(message, metadata?)` records bounded diagnostics from activation and active event/evaluator/exporter callbacks in the management panel. No host service reference is exposed. Log data is redacted and length-limited; exceptions use generic diagnostic codes instead of arbitrary plugin stacks. Diagnostic counters/logs are session-local; supplementary evaluation results persist across restarts. Refresh the panel to view new diagnostics.

## Compatibility

SDK version is `1.0.0`; manifest `apiVersion` uses SemVer range matching. Host and plugin check the protocol handshake before activation. An incompatible API range yields a visible incompatible state and executes no plugin code. Future breaking contracts require a new major API version; contribution version strings are checked independently. MVP updates use uninstall/reinstall, which resets trust and permissions.
