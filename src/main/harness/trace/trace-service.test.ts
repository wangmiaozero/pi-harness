import { describe, expect, it, vi } from 'vitest'
import type { HarnessEvent, HarnessRun } from '@shared/types/harness'
import type { SessionEntry } from '@shared/types/workspace'
import { ReplayService } from '../replay/replay-service'
import { TraceService } from './trace-service'

function run(overrides: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id: 'run-1',
    sessionId: 's1',
    parentRunId: null,
    relation: 'original',
    forkedFromRunId: null,
    forkedFromEventId: null,
    forkedFromCheckpointId: null,
    status: 'success',
    source: 'live',
    anchorEntryId: null,
    cwd: null,
    startedAt: 1_000,
    finishedAt: 11_000,
    model: 'model-a',
    provider: null,
    prompt: 'ship it',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cachedTokens: 0,
      totalTokens: 30,
      estimatedCost: 0.01
    },
    toolCallCount: 1,
    toolFailureCount: 0,
    contextUsage: null,
    result: 'done',
    error: null,
    agentId: null,
    taskId: null,
    orchestrationId: null,
    budgetExceeded: null,
    steps: [],
    checkpointIds: [],
    ...overrides
  }
}

function feed(service: TraceService, events: HarnessEvent[]): void {
  for (const event of events) service.observe('s1', event)
}

const lifecycle: HarnessEvent[] = [
  { type: 'prompt.started', timestamp: 1_000, message: 'ship it' },
  { type: 'run.started', timestamp: 1_001, runId: 'run-1', prompt: 'ship it' },
  { type: 'message.started', timestamp: 1_002 },
  {
    type: 'message.completed',
    timestamp: 2_000,
    usage: undefined,
    model: 'model-a',
    provider: undefined
  },
  { type: 'run.completed', timestamp: 2_500, runId: 'run-1', status: 'success' }
]

describe('TraceService', () => {
  it('records spans and events from the live event stream', async () => {
    const service = new TraceService()
    feed(service, lifecycle)

    const live = service.liveTrace('run-1')
    expect(live).not.toBeNull()
    expect(live?.source).toBe('recorded')
    expect(live?.events.map((item) => item.event.type)).toEqual([
      'run.started',
      'message.started',
      'message.completed',
      'run.completed'
    ])
    expect(live?.spans.length).toBeGreaterThan(0)
  })

  it('closes running spans as skipped when the run settles', async () => {
    const service = new TraceService()
    feed(service, [
      { type: 'run.started', timestamp: 1_001, runId: 'run-1', prompt: 'ship it' },
      { type: 'tool.started', timestamp: 1_100, toolCallId: 'tc-1', toolName: 'bash' }
      // run never settles the tool — captureRun must not leave it "running".
    ])
    await service.captureRun(run({ finishedAt: 2_000 }))

    const recorded = await service.getRecordedTrace('run-1')
    expect(recorded).not.toBeNull()
    const toolSpan = recorded?.spans.find((span) => span.type === 'shell')
    expect(toolSpan).toMatchObject({ status: 'skipped', finishedAt: 2_000 })
  })

  it('ignores events observed outside an open run frame', () => {
    const service = new TraceService()
    service.observe('s1', { type: 'message.started', timestamp: 500 })
    expect(service.liveTrace('run-1')).toBeNull()
  })
})

describe('ReplayService', () => {
  it('prefers the recorded trace over session reconstruction', async () => {
    const trace = new TraceService()
    feed(trace, lifecycle)
    const replay = new ReplayService(trace, {
      getEntries: vi.fn(async () => [])
    })

    const result = await replay.buildReplay(run())
    expect(result?.source).toBe('recorded')
  })

  it('reconstructs a replay from session entries when no trace exists', async () => {
    const trace = new TraceService()
    const entries: SessionEntry[] = [
      {
        type: 'message',
        id: 'entry-1',
        parentId: null,
        timestamp: '2024-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'ship it' }
      } as unknown as SessionEntry,
      {
        type: 'message',
        id: 'entry-2',
        parentId: 'entry-1',
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          model: 'model-a',
          provider: null
        }
      } as unknown as SessionEntry
    ]
    const replay = new ReplayService(trace, { getEntries: vi.fn(async () => entries) })

    const result = await replay.buildReplay(
      run({ id: 'h:entry-1', anchorEntryId: 'entry-1', source: 'history' })
    )
    expect(result?.source).toBe('reconstructed')
    expect(result?.events.length).toBeGreaterThanOrEqual(2)
    expect(result?.spans.length).toBeGreaterThan(0)
  })

  it('returns null when neither trace nor entries carry evidence', async () => {
    const replay = new ReplayService(new TraceService(), {
      getEntries: vi.fn(async () => [])
    })
    expect(await replay.buildReplay(run())).toBeNull()
  })
})
