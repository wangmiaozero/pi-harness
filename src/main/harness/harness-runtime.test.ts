import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStateSnapshot } from '@shared/types/workspace'
import type {
  HarnessCapabilities,
  HarnessEvent,
  HarnessState,
  HarnessStats
} from '@shared/types/harness'
import type { HarnessAdapter } from './harness-types'
import { DEFAULT_STORE_SETTINGS, HarnessRuntime } from './harness-runtime'
import { DEFAULT_POLICY_CONFIG } from './policy/policy-defaults'
import { EMPTY_CHECKPOINT_STORE } from './checkpoint/checkpoint-service'
import { EMPTY_EVALUATION_STORE } from './evaluation/evaluation-service'
import { EMPTY_ARTIFACT_STORE } from './artifacts/artifact-service'
import { EMPTY_TRACE_STORE } from './trace/trace-repository'
import { EMPTY_BASELINE_STORE } from './regression/regression-service'
import { JsonStore } from '../services/storage'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempStore<T extends object>(name: string, defaults: T): JsonStore<T> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-test-'))
  tempDirs.push(dir)
  return new JsonStore(path.join(dir, name), defaults)
}

function createRuntime(adapter: HarnessAdapter): HarnessRuntime {
  return new HarnessRuntime(adapter, {
    policyStore: tempStore('policy.json', structuredClone(DEFAULT_POLICY_CONFIG)),
    checkpointStore: tempStore('checkpoints.json', EMPTY_CHECKPOINT_STORE),
    runStore: tempStore('runs.json', { schemaVersion: 1, runs: [] }),
    traceStore: tempStore('traces.json', EMPTY_TRACE_STORE),
    artifactStore: tempStore('artifacts.json', EMPTY_ARTIFACT_STORE),
    evaluationStore: tempStore('evaluations.json', EMPTY_EVALUATION_STORE),
    baselineStore: tempStore('baselines.json', EMPTY_BASELINE_STORE),
    storeSettingsStore: tempStore('store-settings.json', DEFAULT_STORE_SETTINGS)
  })
}

describe('HarnessRuntime', () => {
  it('tracks runs in the timeline while delegating execution to Pi', async () => {
    const { adapter, emitAgentEvent } = createAdapter()
    const runtime = createRuntime(adapter)
    const listener = vi.fn()
    runtime.onEvent(listener)

    await runtime.start({ sessionId: 'session-1' })
    await runtime.prompt('session-1', 'hello')
    emitAgentEvent({ type: 'tool.started', timestamp: 3, toolName: 'read' })
    emitAgentEvent({ type: 'tool.completed', timestamp: 4, toolName: 'read' })

    expect(adapter.startSession).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(adapter.prompt).toHaveBeenCalledWith('session-1', 'hello', {})
    expect(runtime.getTimeline('session-1').map((event) => event.type)).toEqual([
      'session.started',
      'prompt.started',
      'run.started',
      'tool.started',
      'tool.completed'
    ])
    // The run is still open until the agent turn settles.
    const runs = await runtime.listRuns('session-1')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'running', prompt: 'hello' })
    expect(listener).toHaveBeenCalled()
  })

  it('settles a failed run with usage, tool failures and a derived event', async () => {
    const { adapter, emitAgentEvent } = createAdapter()
    const runtime = createRuntime(adapter)
    const events: HarnessEvent[] = []
    runtime.onEvent(({ event }) => events.push(event))

    await runtime.start({ sessionId: 'session-1' })
    await runtime.prompt('session-1', 'run tests')
    emitAgentEvent({
      type: 'message.completed',
      timestamp: 2,
      usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 0, total: 160, cost: 0.01 },
      model: 'test-model',
      provider: 'test-provider'
    })
    emitAgentEvent({ type: 'tool.started', timestamp: 3, toolName: 'bash' })
    emitAgentEvent({ type: 'tool.completed', timestamp: 4, toolName: 'bash', isError: true })
    emitAgentEvent({ type: 'runtime.error', timestamp: 5, message: 'boom' })

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'run.failed')).toBe(true)
    })
    const run = (await runtime.listRuns('session-1')).find((item) => item.source === 'live')
    expect(run).toMatchObject({
      status: 'failed',
      toolCallCount: 1,
      toolFailureCount: 1,
      error: 'boom'
    })
    expect(run?.usage).toMatchObject({ totalTokens: 160, estimatedCost: 0.01 })
    expect(run?.model).toBe('test-model')
    expect(run?.steps.some((step) => step.kind === 'tool' && step.status === 'failed')).toBe(true)
  })

  it('keeps legacy tool presets extension-safe and Inspector selections exact', async () => {
    const { adapter } = createAdapter()
    const runtime = createRuntime(adapter)

    await runtime.command('session-1', { type: 'set_tools', toolNames: ['read'] })
    await runtime.setTools('session-1', ['read'])

    expect(adapter.setTools).toHaveBeenNthCalledWith(1, 'session-1', ['read'], {
      preserveExtensionTools: true
    })
    expect(adapter.setTools).toHaveBeenNthCalledWith(2, 'session-1', ['read'], {
      preserveExtensionTools: false
    })
  })

  it('records unsupported operation failures without swallowing the adapter error', async () => {
    const { adapter } = createAdapter()
    const runtime = createRuntime(adapter)
    vi.mocked(adapter.prompt).mockRejectedValueOnce(
      Object.assign(new Error('Prompt unavailable'), { code: 'CAPABILITY_NOT_SUPPORTED' })
    )

    await expect(runtime.prompt('session-1', 'hello')).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_SUPPORTED'
    })
    expect(
      runtime
        .getTimeline('session-1')
        .some((event) => event.type === 'runtime.error' && event.message === 'Prompt unavailable')
    ).toBe(true)
  })

  it('maps normal Pi compaction no-ops into a non-error timeline event', async () => {
    const { adapter } = createAdapter()
    const runtime = createRuntime(adapter)
    vi.mocked(adapter.compact).mockResolvedValueOnce({
      cancelled: true,
      reason: 'session-too-small'
    })

    await runtime.compact('session-1')

    expect(runtime.getTimeline('session-1').at(-1)).toMatchObject({
      type: 'compaction.skipped',
      reason: 'session-too-small'
    })
  })

  it('turns policy decision reports into timeline events', async () => {
    const { adapter } = createAdapter()
    const runtime = createRuntime(adapter)
    await runtime.start({ sessionId: 'session-1' })

    runtime.recordPolicyDecision('session-1', {
      sessionId: 'session-1',
      domain: 'shell',
      decision: 'deny',
      target: 'rm -rf /',
      rule: 'shell.denyCommands: rm -rf*',
      allowed: false
    })

    expect(runtime.getTimeline('session-1').at(-1)).toMatchObject({
      type: 'policy.denied',
      target: 'rm -rf /'
    })
  })

  it('persists policy updates and exposes them through snapshots', async () => {
    const { adapter } = createAdapter()
    const runtime = createRuntime(adapter)

    const snapshot = await runtime.updatePolicy({
      ...structuredClone(DEFAULT_POLICY_CONFIG),
      git: { ...DEFAULT_POLICY_CONFIG.git, push: 'deny' }
    })

    expect(snapshot.config.git.push).toBe('deny')
    expect((await runtime.getPolicySnapshot()).config.git.push).toBe('deny')
  })

  it('creates checkpoints anchored at the current session leaf', async () => {
    const { adapter } = createAdapter()
    vi.mocked(adapter.getSession).mockResolvedValue({
      sessionId: 'session-1',
      persisted: true,
      leafId: 'entry-7',
      entries: []
    })
    const runtime = createRuntime(adapter)
    await runtime.start({ sessionId: 'session-1' })

    const checkpoint = await runtime.createCheckpoint('session-1', {
      reason: 'manual',
      includeGit: false
    })

    expect(checkpoint).toMatchObject({
      sessionId: 'session-1',
      sessionEntryId: 'entry-7',
      kind: 'session'
    })
    expect(await runtime.listCheckpoints('session-1')).toHaveLength(1)
  })
})

function createAdapter() {
  let eventListener: ((event: HarnessEvent) => void) | null = null
  const adapter: HarnessAdapter = {
    diagnostics: vi.fn(() => ({ implementation: 'pi' as const, sdkLoaded: true })),
    listRunning: vi.fn(() => []),
    startSession: vi.fn(async () => ({ sessionId: 'session-1', cwd: '/tmp/project' })),
    stopSession: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    getAgentState: vi.fn(async () => agentState()),
    getState: vi.fn(async () => harnessState()),
    getCapabilities: vi.fn(async () => capabilities()),
    getTools: vi.fn(async () => [{ name: 'read', description: 'Read', active: true }]),
    setTools: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
    abortCompaction: vi.fn(async () => undefined),
    setAutoCompaction: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ cancelled: false, newSessionId: 'session-2' })),
    navigateTree: vi.fn(async () => undefined),
    getStats: vi.fn(async () => stats()),
    getSession: vi.fn(async () => ({
      sessionId: 'session-1',
      persisted: true,
      leafId: null,
      entries: []
    })),
    subscribe: vi.fn((_sessionId, listener) => {
      eventListener = listener
      return () => {
        eventListener = null
      }
    }),
    executeAgentCommand: vi.fn(async () => undefined),
    defaultToolNames: vi.fn(() => ['read']),
    shutdownAll: vi.fn(async () => undefined)
  }
  return {
    adapter,
    emitAgentEvent(event: HarnessEvent) {
      eventListener?.(event)
    }
  }
}

function capabilities(): HarnessCapabilities {
  return {
    prompt: true,
    abort: true,
    steering: true,
    followUp: true,
    compaction: true,
    abortCompaction: true,
    autoCompaction: true,
    autoRetry: true,
    thinkingLevel: true,
    tools: true,
    skills: true,
    extensions: true,
    sessionFork: true,
    sessionTree: true,
    modelSwitch: true,
    contextUsage: true,
    stats: true
  }
}

function agentState(): AgentStateSnapshot {
  return {
    sessionId: 'session-1',
    sessionFile: '/tmp/session.jsonl',
    status: 'idle',
    isStreaming: false,
    isPromptRunning: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    thinkingLevel: 'off',
    contextUsage: null,
    pendingMessageCount: 0,
    queuedMessages: { steering: [], followUp: [] }
  }
}

function stats(): HarnessStats {
  return { sessionId: 'session-1', activeTools: 1, pendingMessages: 0 }
}

function harnessState(): HarnessState {
  return {
    sessionId: 'session-1',
    runtime: {
      status: 'idle',
      isStreaming: false,
      isPromptRunning: false,
      isBashRunning: false,
      isCompacting: false
    },
    thinking: { level: 'off', options: ['off'] },
    context: null,
    compaction: { auto: true, running: false },
    queue: { pendingMessages: 0, steering: [], followUp: [] },
    tools: [{ name: 'read', description: 'Read', active: true }],
    capabilities: capabilities(),
    stats: stats()
  }
}
