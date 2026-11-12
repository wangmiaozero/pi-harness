import type { HarnessRun } from '@shared/types/harness'
import type { UsageRange, UsageReport, UsageTotals } from '@shared/providers/account-management'

export function emptyUsage(): UsageTotals {
  return {
    requests: 0,
    succeeded: 0,
    failed: 0,
    aborted: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    estimatedCost: null
  }
}

function add(target: UsageTotals, usage: UsageTotals): void {
  target.requests += usage.requests
  target.succeeded += usage.succeeded
  target.failed += usage.failed
  target.aborted += usage.aborted
  target.input += usage.input
  target.output += usage.output
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  if (usage.estimatedCost !== null)
    target.estimatedCost = (target.estimatedCost ?? 0) + usage.estimatedCost
}

export function summarizeUsage(runs: readonly HarnessRun[], range: UsageRange): UsageReport {
  const availableModels = new Map<string, UsageReport['availableModels'][number]>()
  const filtered = !!(range.provider || range.modelId)
  const byId = new Map(runs.map((run) => [run.id, run]))
  const total = emptyUsage()
  const days = new Map<string, UsageTotals>()
  const providers = new Map<string, UsageTotals>()
  const models = new Map<string, UsageReport['models'][number]>()
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: range.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  let retainedRuns = 0
  let legacyRuns = 0
  for (const run of byId.values()) {
    if (run.startedAt < range.start || run.startedAt >= range.end) continue
    const runUsage = filtered
      ? emptyUsage()
      : {
          ...emptyUsage(),
          input: run.usage.inputTokens,
          output: run.usage.outputTokens,
          cacheRead: run.usage.cachedTokens,
          cacheWrite: run.usage.cacheWriteTokens ?? 0,
          estimatedCost: run.usage.estimatedCost
        }
    if (!run.usage.byModel) legacyRuns++
    for (const bucket of Object.values(run.usage.byModel ?? {})) {
      const { provider, model, usage } = bucket
      const key = JSON.stringify([provider, model])
      availableModels.set(key, { provider, id: model })
      if (
        (range.provider && provider !== range.provider) ||
        (range.modelId && model !== range.modelId)
      )
        continue
      if (filtered) add(runUsage, usage)
      else {
        runUsage.requests += usage.requests
        runUsage.succeeded += usage.succeeded
        runUsage.failed += usage.failed
        runUsage.aborted += usage.aborted
      }
      const aggregate = providers.get(provider) ?? emptyUsage()
      add(aggregate, usage)
      providers.set(provider, aggregate)
      const item = models.get(key) ?? { provider, id: model, usage: emptyUsage() }
      add(item.usage, usage)
      models.set(key, item)
    }
    if (filtered && !runUsage.requests) continue
    retainedRuns++
    const day = format.format(run.startedAt)
    const daily = days.get(day) ?? emptyUsage()
    days.set(day, daily)
    add(total, runUsage)
    add(daily, runUsage)
  }
  return {
    total,
    retainedRuns,
    legacyRuns,
    availableModels: [...availableModels.values()],
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, usage]) => ({ day, usage })),
    providers: [...providers].map(([id, usage]) => ({ id, usage })),
    models: [...models.values()]
  }
}
