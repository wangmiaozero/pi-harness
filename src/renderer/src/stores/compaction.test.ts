import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import { useAgentStore } from './agent'
import { useCompactionStore } from './compaction'
import { useHarnessStore } from './harness'
import { useSessionStore } from './sessions'

const askConfirm = vi.fn()

vi.mock('vue-sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@renderer/composables/useConfirmDialog', () => ({
  askConfirm: (...args: unknown[]) => askConfirm(...args)
}))

describe('requestSmartCompaction', () => {
  const command = vi.fn()
  const harnessCompact = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    command.mockReset()
    harnessCompact.mockReset()
    askConfirm.mockReset()
    askConfirm.mockResolvedValue(true)
    window.piSwitch = {
      agent: { command, state: vi.fn(), running: vi.fn().mockResolvedValue([]) },
      harness: {
        compact: harnessCompact,
        state: vi.fn().mockResolvedValue(null),
        session: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PiSwitchAPI
  })

  afterEach(() => {
    delete window.piSwitch
  })

  it('executes compact immediately for an idle session without token gates', async () => {
    const sessions = useSessionStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    command.mockResolvedValue({ tokensBefore: 8000, firstKeptEntryId: 'entry-1' })

    const result = await useCompactionStore().requestSmartCompaction({
      sessionId: 'session-1',
      source: 'workspace'
    })

    expect(result).toMatchObject({
      status: 'compacted',
      tokensBefore: 8000,
      firstKeptEntryId: 'entry-1'
    })
    expect(command).toHaveBeenCalledWith('session-1', { type: 'compact' })
  })

  it('forwards optional instructions to Pi', async () => {
    const sessions = useSessionStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    command.mockResolvedValue(null)

    await useCompactionStore().requestSmartCompaction({
      sessionId: 'session-1',
      instruction: 'keep TODOs',
      source: 'workspace'
    })

    expect(command).toHaveBeenCalledWith('session-1', {
      type: 'compact',
      customInstructions: 'keep TODOs'
    })
  })

  it('maps Pi skip reasons to typed results', async () => {
    const sessions = useSessionStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    command.mockResolvedValueOnce({ cancelled: true, reason: 'session-too-small' })
    command.mockResolvedValueOnce({ cancelled: true, reason: 'already-compacted' })

    const compaction = useCompactionStore()
    await expect(
      compaction.requestSmartCompaction({ sessionId: 'session-1', source: 'workspace' })
    ).resolves.toEqual({ status: 'session-too-small' })
    await expect(
      compaction.requestSmartCompaction({ sessionId: 'session-1', source: 'workspace' })
    ).resolves.toEqual({ status: 'already-compacted' })
  })

  it('queues compaction while the session is streaming and flushes on idle', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    agent.runningIds = ['session-1']
    command.mockResolvedValue({ tokensBefore: 12_000 })

    const compaction = useCompactionStore()
    await expect(
      compaction.requestSmartCompaction({ sessionId: 'session-1', source: 'workspace' })
    ).resolves.toEqual({ status: 'queued' })
    expect(command).not.toHaveBeenCalled()
    expect(compaction.isQueued('session-1')).toBe(true)

    agent.runningIds = []
    await expect(compaction.flushPending('session-1')).resolves.toMatchObject({
      status: 'compacted',
      tokensBefore: 12_000
    })
    expect(command).toHaveBeenCalledTimes(1)
    expect(compaction.isQueued('session-1')).toBe(false)
  })

  it('does not start a second compact while one is already running', async () => {
    const sessions = useSessionStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    let release!: (value: unknown) => void
    command.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const compaction = useCompactionStore()
    const first = compaction.requestSmartCompaction({
      sessionId: 'session-1',
      source: 'workspace'
    })
    await Promise.resolve()
    await expect(
      compaction.requestSmartCompaction({ sessionId: 'session-1', source: 'workspace' })
    ).resolves.toEqual({ status: 'already-running' })

    release({ tokensBefore: 1 })
    await expect(first).resolves.toMatchObject({ status: 'compacted' })
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('keeps a queued compact bound to its original session after a switch', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    sessions.addTransientSession('session-2', '/code/project', 'two')
    sessions.selectSession('session-2')
    agent.runningIds = ['session-1']
    command.mockResolvedValue(null)

    const compaction = useCompactionStore()
    await compaction.requestSmartCompaction({ sessionId: 'session-1', source: 'workspace' })
    agent.runningIds = []
    await compaction.flushPending('session-1')

    expect(command).toHaveBeenCalledWith('session-1', { type: 'compact' })
    expect(command).not.toHaveBeenCalledWith('session-2', expect.anything())
  })

  it('drops a queued compact when the session is forgotten', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'one')
    agent.runningIds = ['session-1']

    const compaction = useCompactionStore()
    await compaction.requestSmartCompaction({ sessionId: 'session-1', source: 'workspace' })
    compaction.forgetSession('session-1')
    sessions.removeTransientSession('session-1')
    agent.runningIds = []

    await expect(compaction.flushPending('session-1')).resolves.toBeNull()
    expect(command).not.toHaveBeenCalled()
  })

  it('routes harness compact through the same entry', async () => {
    const harness = useHarnessStore()
    harness.sessionId = 'harness-1'
    harnessCompact.mockResolvedValue({ cancelled: true, reason: 'session-too-small' })

    await expect(
      useCompactionStore().requestSmartCompaction({
        sessionId: 'harness-1',
        instruction: 'keep decisions',
        source: 'harness'
      })
    ).resolves.toEqual({ status: 'session-too-small' })
    expect(harnessCompact).toHaveBeenCalledWith('harness-1', 'keep decisions')
    expect(command).not.toHaveBeenCalled()
  })

  it('asks before compacting a low-usage session and honors cancel', async () => {
    const harness = useHarnessStore()
    harness.sessionId = 'harness-1'
    harness.state = {
      context: { tokens: 1_000, contextWindow: 128_000, percent: 1 }
    } as typeof harness.state
    askConfirm.mockResolvedValueOnce(false)

    await expect(
      useCompactionStore().requestSmartCompaction({ sessionId: 'harness-1', source: 'harness' })
    ).resolves.toEqual({ status: 'declined' })
    expect(harnessCompact).not.toHaveBeenCalled()
  })

  it('returns session-missing when no session is selected', async () => {
    await expect(
      useCompactionStore().requestSmartCompaction({ sessionId: null, source: 'workspace' })
    ).resolves.toEqual({ status: 'session-missing' })
    expect(command).not.toHaveBeenCalled()
  })
})
