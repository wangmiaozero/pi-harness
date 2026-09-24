import { describe, expect, it, vi } from 'vitest'
import type { HarnessEvent, HarnessPolicyBudget, HarnessRun } from '@shared/types/harness'
import type { SessionEntry } from '@shared/types/workspace'
import { RunRegistry, type RunRegistryHooks } from './run-registry'

const unlimitedBudget: HarnessPolicyBudget = {
  maxTokens: null,
  maxCost: null,
  maxToolCalls: null,
  maxRunDurationMs: null
}

function createRegistry(overrides: Partial<RunRegistryHooks> = {}, entries: SessionEntry[] = []) {
  const emitted: HarnessEvent[] = []
  const hooks: RunRegistryHooks = {
    emit: (_sessionId: string, event: HarnessEvent) => {
      emitted.push(event)
    },
    getBudget: () => unlimitedBudget,
    getEntries: async () => entries,
    getLastAssistantText: async () => 'final answer',
    onRunSettled: async () => undefined,
    ...overrides
  }
  const registry = new RunRegistry(hooks)
  return { registry, hooks, emitted }
}

function promptEvent(message: string, timestamp: number): HarnessEvent {
  return { type: 'prompt.started', timestamp, message }
}

describe('RunRegistry', () => {
  it('reduces a full run lifecycle and finalizes it through the settlement hook', async () => {
    const settledRuns: HarnessRun[] = []
    const { registry, emitted } = createRegistry({
      onRunSettled: async (run) => {
        settledRuns.push(run)
      }
    })

    registry.handleEvent('s1', promptEvent('build it', 1000))
    const run = registry.getCurrentRun('s1')
    expect(run).toMatchObject({ status: 'queued', prompt: 'build it', toolCallCount: 0 })

    registry.handleEvent('s1', { type: 'message.started', timestamp: 1100 })
    registry.handleEvent('s1', {
      type: 'message.completed',
      timestamp: 1200,
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30, cost: 0.02 },
      model: 'claude-x',
      provider: 'anthropic'
    })
    registry.handleEvent('s1', {
      type: 'tool.started',
      timestamp: 1300,
      toolCallId: 'tc1',
      toolName: 'bash'
    })
    registry.handleEvent('s1', {
      type: 'tool.completed',
      timestamp: 1400,
      toolCallId: 'tc1',
      toolName: 'bash',
      isError: true
    })
    registry.handleEvent('s1', { type: 'prompt.completed', timestamp: 1500 })

    await vi.waitFor(() => {
      expect(settledRuns).toHaveLength(1)
    })
    const settled: HarnessRun = settledRuns[0]
    expect(settled).toMatchObject({
      status: 'success',
      model: 'claude-x',
      provider: 'anthropic',
      toolCallCount: 1,
      toolFailureCount: 1,
      result: 'final answer'
    })
    expect(settled.usage).toMatchObject({ totalTokens: 30, estimatedCost: 0.02 })
    expect(settled.steps).toHaveLength(1)

    // The registry finalized the run itself because no evaluation was pending.
    await vi.waitFor(() => {
      expect(emitted.some((event) => event.type === 'run.completed')).toBe(true)
    })
    expect(registry.getCurrentRun('s1')).toBeNull()
    const listed = await registry.listRuns('s1')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ status: 'success', finishedAt: expect.any(Number) })
  })

  it('correlates tool steps by toolCallId and falls back to name matching', () => {
    const { registry } = createRegistry()
    registry.handleEvent('s1', promptEvent('tools', 1000))
    registry.handleEvent('s1', {
      type: 'tool.started',
      timestamp: 1100,
      toolCallId: 'a',
      toolName: 'bash'
    })
    registry.handleEvent('s1', { type: 'tool.started', timestamp: 1200, toolName: 'write' })
    registry.handleEvent('s1', {
      type: 'tool.completed',
      timestamp: 1300,
      toolCallId: 'a',
      toolName: 'bash'
    })
    registry.handleEvent('s1', {
      type: 'tool.completed',
      timestamp: 1400,
      toolName: 'write',
      isError: true
    })

    const run = registry.getCurrentRun('s1')
    expect(run?.steps.filter((step) => step.kind === 'tool')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'bash', status: 'success' }),
        expect.objectContaining({ name: 'write', status: 'failed' })
      ])
    )
  })

  it('fails a run on runtime errors and rewrites a success raced by an abort', async () => {
    const { registry, emitted } = createRegistry()

    registry.handleEvent('s1', promptEvent('boom', 1000))
    registry.handleEvent('s1', { type: 'runtime.error', timestamp: 1100, message: 'sdk crashed' })
    await vi.waitFor(() => {
      expect(emitted.some((event) => event.type === 'run.failed')).toBe(true)
    })
    expect((await registry.listRuns('s1'))[0]).toMatchObject({
      status: 'failed',
      error: 'sdk crashed'
    })

    // A successful settlement that races an abort must end up aborted.
    registry.handleEvent('s1', promptEvent('raced', 2000))
    registry.handleEvent('s1', { type: 'prompt.completed', timestamp: 2100 })
    registry.handleEvent('s1', { type: 'runtime.aborted', timestamp: 2200 })
    await vi.waitFor(() => {
      expect(emitted.some((event) => event.type === 'run.aborted')).toBe(true)
    })
  })

  it('enforces budgets and reports the exceeded limit', async () => {
    const onBudgetExceeded = vi.fn(async () => undefined)
    const { registry, emitted } = createRegistry({
      getBudget: () => ({ ...unlimitedBudget, maxToolCalls: 1 }),
      onBudgetExceeded
    })

    registry.handleEvent('s1', promptEvent('budget', 1000))
    registry.handleEvent('s1', {
      type: 'tool.started',
      timestamp: 1100,
      toolCallId: 'a',
      toolName: 'bash'
    })
    registry.handleEvent('s1', {
      type: 'tool.completed',
      timestamp: 1200,
      toolCallId: 'a',
      toolName: 'bash'
    })
    registry.handleEvent('s1', {
      type: 'tool.completed',
      timestamp: 1300,
      toolCallId: 'b',
      toolName: 'write'
    })

    expect(emitted).toContainEqual(
      expect.objectContaining({ type: 'budget.exceeded', limit: 'maxToolCalls' })
    )
    expect(onBudgetExceeded).toHaveBeenCalledTimes(1)
    expect(registry.getCurrentRun('s1')?.budgetExceeded).toMatch(/^maxToolCalls: /)
  })

  it('keeps evaluating runs in verifying state until the verdict completes them', async () => {
    let resolveSettled!: () => void
    const settlement = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const { registry, emitted } = createRegistry({
      onRunSettled: () => settlement
    })
    registry.handleEvent('s1', promptEvent('evaluate me', 1000))
    registry.handleEvent('s1', { type: 'prompt.completed', timestamp: 1100 })

    await vi.waitFor(() => {
      expect(typeof resolveSettled).toBe('function')
    })
    const runId = registry.getCurrentRun('s1')?.id
    expect(runId).toBeTruthy()
    registry.markEvaluating('s1', runId!)
    expect(registry.getCurrentRun('s1')?.status).toBe('verifying')

    resolveSettled()
    await settlement
    // The settlement hook resolved but the run stays open until the verdict.
    expect(registry.getCurrentRun('s1')).not.toBeNull()

    registry.completeRun('s1', runId!, 'recovered')
    await vi.waitFor(() => {
      expect(emitted.some((event) => event.type === 'run.completed')).toBe(true)
    })
    const finalized = (await registry.listRuns('s1')).find((item) => item.id === runId)
    expect(finalized).toMatchObject({ status: 'recovered' })
  })

  it('skips history runs whose anchor belongs to a live run', async () => {
    const anchorEntry = sessionMessage('entry-user-1', null, '2024-01-01T00:00:01.000Z', {
      role: 'user',
      content: 'historical prompt'
    })
    const assistantEntry = sessionMessage('entry-a-1', 'entry-user-1', '2024-01-01T00:00:02.000Z', {
      role: 'assistant',
      content: 'done'
    })
    const { registry } = createRegistry({}, [anchorEntry, assistantEntry])

    const history = await registry.listRuns('s1')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ source: 'history', prompt: 'historical prompt' })

    // Once the same anchor is observed live, the history duplicate disappears.
    registry.handleEvent(
      's1',
      promptEvent('historical prompt', Date.parse('2024-01-01T00:00:01.000Z'))
    )
    registry.handleEvent('s1', {
      type: 'prompt.completed',
      timestamp: Date.parse('2024-01-01T00:00:03.000Z')
    })
    await vi.waitFor(async () => {
      const runs = await registry.listRuns('s1')
      expect(runs).toHaveLength(1)
      expect(runs[0].source).toBe('live')
    })
  })
})

function sessionMessage(
  id: string,
  parentId: string | null,
  timestamp: string,
  message: Record<string, unknown>
): SessionEntry {
  return { type: 'message', id, parentId, timestamp, message } as unknown as SessionEntry
}
