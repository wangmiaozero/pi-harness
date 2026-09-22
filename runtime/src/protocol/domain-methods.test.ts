/**
 * Domain RPC method tests against mock SDK services.
 *
 * Covers the task §33 list: session list, agent start/state, event
 * envelopes + sequence, abort, harness state/model/thinking/tools/compaction
 * — end-to-end through `createMethodRegistry` so validation, error mapping
 * and result shapes are exercised exactly as the Tauri host will see them.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMethodRegistry, createDispatcher, type RpcMethodContext } from './dispatch.js'
import { createRuntimeServices, type RuntimeServices } from '../services.js'
import { createMockSdkWorld, mockSdkLoader, type MockSdkWorld } from '../testing/mock-sdk.js'
import type { AgentEventBatch } from '../agent/events.js'

describe('domain methods over mock SDK', () => {
  let world: MockSdkWorld
  let services: RuntimeServices
  let dispatch: ReturnType<typeof createDispatcher>
  let agentEvents: Array<{ event: string; payload: unknown }>
  let harnessEvents: Array<{ sessionId: string; event: { type: string } }>
  let runningBroadcasts: string[][]
  let context: RpcMethodContext
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'pi-domain-rpc-'))
    process.env.PI_HARNESS_USER_DATA = dataDir
    world = createMockSdkWorld()
    agentEvents = []
    harnessEvents = []
    runningBroadcasts = []
    services = createRuntimeServices({
      loadSdk: mockSdkLoader(world),
      onAgentEvent: (batch: AgentEventBatch) => {
        const envelopes = Array.isArray(batch) ? batch : [batch]
        for (const envelope of envelopes) {
          agentEvents.push({ event: 'agent.event', payload: envelope })
        }
      },
      onRunningChange: (ids: string[]) => runningBroadcasts.push([...ids]),
      onHarnessEvent: (sessionId, event) =>
        harnessEvents.push({ sessionId, event: event as { type: string } })
    })
    dispatch = createDispatcher(createMethodRegistry(services))
    context = {
      startedAt: Date.now(),
      emit: () => {},
      requestShutdown: () => {}
    }
  })

  afterEach(async () => {
    await services.shutdown()
    delete process.env.PI_HARNESS_USER_DATA
    rmSync(dataDir, { recursive: true, force: true })
  })

  const call = (method: string, params: Record<string, unknown> = {}) =>
    dispatch(method, params, context)

  // ------------------------------------------------------------- sessions

  it('session.list returns the SDK listing under a `sessions` key', async () => {
    world.listing = [
      {
        path: '/tmp/pi-harness-test/agent/sessions/a.jsonl',
        id: 'a',
        cwd: '/tmp/project-a',
        created: new Date(),
        modified: new Date(),
        messageCount: 3
      }
    ]
    const outcome = await call('session.list', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.result as { sessions: Array<{ id: string; cwd: string }> }
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]!.id).toBe('a')
    // listing must not have loaded the SDK twice (lazy single load)
    expect(world.loadCount).toBe(1)
  })

  it('session.rename validates and forwards', async () => {
    const outcome = await call('session.rename', { sessionId: 'a', name: 'New name' })
    // Session "a" does not exist in the mock listing — rename fails with a
    // typed domain error, not a generic crash.
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('SESSION_NOT_FOUND')
    expect(outcome.error.userMessage).toBeTruthy()
  })

  it('session methods reject malformed ids', async () => {
    const outcome = await call('session.get', { sessionId: '' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('INVALID_INPUT')
  })

  // --------------------------------------------------------------- agent

  it('agent.start boots a new session through the mock SDK', async () => {
    const outcome = await call('agent.start', { cwd: '/tmp/demo' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.result as { sessionId: string; cwd: string }
    expect(result.cwd).toBe('/tmp/demo')
    expect(result.sessionId).toBe('new-1')
    // observation happens automatically (harness events flow)
    const handle = world.sessions.get('new-1')!
    handle.session.__emit({ type: 'agent_start', sessionId: 'new-1' })
    expect(harnessEvents.some((e) => e.event.type === 'runtime.started')).toBe(true)
  })

  it('agent.start sends the initial message after boot', async () => {
    await call('agent.start', { cwd: '/tmp/demo', message: 'hello world' })
    const handle = world.sessions.get('new-1')!
    expect(handle.prompts).toHaveLength(1)
    expect(handle.prompts[0]!.message).toBe('hello world')
  })

  it('agent.state returns null for idle-unknown sessions and a snapshot for live ones', async () => {
    // Electron parity: state() on an unknown session resolves to null (no
    // auto-start, no crash) — the renderer renders an empty console.
    const missing = await call('agent.state', { sessionId: 'ghost' })
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.result).toBeNull()

    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('agent.state', { sessionId: 'new-1' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const snapshot = outcome.result as Record<string, unknown> | null
    expect(snapshot).not.toBeNull()
  })

  it('agent.prompt streams events and agent.running broadcasts ids', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const handle = world.sessions.get('new-1')!

    const prompted = await call('agent.prompt', { sessionId: 'new-1', message: 'go' })
    expect(prompted.ok).toBe(true)
    expect(handle.prompts).toHaveLength(1)

    // Simulate the SDK turn: start → token → end.
    handle.session.__emit({ type: 'agent_start', sessionId: 'new-1' })
    handle.session.__emit({ type: 'message_start', messageId: 'm1', role: 'assistant' })
    handle.session.__emit({ type: 'agent_end', sessionId: 'new-1' })
    // agent.event envelopes are batched on a 16ms tick — flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(
      agentEvents.some(
        (e) => e.payload && (e.payload as Record<string, unknown>).sessionId === 'new-1'
      )
    ).toBe(true)
    const running = runningBroadcasts[runningBroadcasts.length - 1]
    expect(running).toEqual(['new-1'])

    // Stopping the session (idle dispose / explicit stop) clears the set.
    await services.agent.stop('new-1')
    const after = runningBroadcasts[runningBroadcasts.length - 1]
    expect(after).toEqual([])
  })

  it('agent.abort forwards abort to the session', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('agent.abort', { sessionId: 'new-1' })
    expect(outcome.ok).toBe(true)
    expect(world.sessions.get('new-1')!.aborts).toBe(1)
  })

  it('agent.running reports sessions with an active turn', async () => {
    // An idle, freshly started session is NOT running (Electron parity).
    await call('agent.start', { cwd: '/tmp/demo' })
    const idle = await call('agent.running', {})
    if (idle.ok) expect((idle.result as { ids: string[] }).ids).toEqual([])

    // A pending prompt makes it running.
    await call('agent.prompt', { sessionId: 'new-1', message: 'go' })
    const outcome = await call('agent.running', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.result as { ids: string[] }
    expect(result.ids).toContain('new-1')
  })

  // ------------------------------------------------------------- harness

  it('harness.getState reports capabilities, tools and thinking options', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('harness.getState', { sessionId: 'new-1' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const state = outcome.result as {
      capabilities: {
        tools: boolean
        modelSwitch: boolean
        thinkingLevel: boolean
        compaction: boolean
        steering: boolean
      }
      tools: Array<{ name: string; active: boolean }>
      thinking: { options: string[] }
      sessionId: string
    }
    expect(state.capabilities.tools).toBe(true)
    expect(state.capabilities.modelSwitch).toBe(true)
    expect(state.capabilities.compaction).toBe(true)
    expect(state.tools.map((t) => t.name)).toContain('read')
    expect(state.thinking.options).toEqual(['off', 'low', 'high'])
  })

  it('harness.setModel switches models and emits model.changed', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('harness.setModel', {
      sessionId: 'new-1',
      provider: 'test-provider',
      modelId: 'test-model'
    })
    expect(outcome.ok).toBe(true)
    expect(harnessEvents.some((e) => e.event.type === 'model.changed')).toBe(true)
  })

  it('harness.setModel rejects unknown models with MODEL_NOT_FOUND', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('harness.setModel', {
      sessionId: 'new-1',
      provider: 'nope',
      modelId: 'nope'
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('MODEL_NOT_FOUND')
  })

  it('harness.setThinkingLevel switches levels and emits thinking.changed', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('harness.setThinkingLevel', { sessionId: 'new-1', level: 'high' })
    expect(outcome.ok).toBe(true)
    expect(world.sessions.get('new-1')!.thinkingLevels).toContain('high')
    expect(harnessEvents.some((e) => e.event.type === 'thinking.changed')).toBe(true)
  })

  it('harness.setTools validates names and emits tools.changed', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('harness.setTools', {
      sessionId: 'new-1',
      toolNames: ['read', 'bash']
    })
    expect(outcome.ok).toBe(true)
    expect(world.sessions.get('new-1')!.session.getActiveToolNames()).toEqual(['read', 'bash'])
    expect(harnessEvents.some((e) => e.event.type === 'tools.changed')).toBe(true)

    const bad = await call('harness.setTools', { sessionId: 'new-1', toolNames: ['teleport'] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('TOOL_NOT_FOUND')
  })

  it('harness.compact runs compaction and emits prompt + compaction events', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('harness.compact', { sessionId: 'new-1', instructions: 'keep code' })
    expect(outcome.ok).toBe(true)
    expect(world.sessions.get('new-1')!.compactions).toEqual(['keep code'])
    const types = harnessEvents.map((e) => e.event.type)
    expect(types).toContain('compaction.started')
    expect(types).toContain('compaction.completed')
  })

  it('harness.steer and harness.followUp queue messages', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const steer = await call('harness.steer', { sessionId: 'new-1', message: 'turn left' })
    expect(steer.ok).toBe(true)
    const followUp = await call('harness.followUp', { sessionId: 'new-1', message: 'then right' })
    expect(followUp.ok).toBe(true)
    const handle = world.sessions.get('new-1')!
    expect(handle.prompts).toHaveLength(2)
    expect(handle.prompts[0]!.options).toMatchObject({ streamingBehavior: 'steer' })
    expect(harnessEvents.some((e) => e.event.type === 'steering.queued')).toBe(true)
    expect(harnessEvents.some((e) => e.event.type === 'followUp.queued')).toBe(true)
  })

  it('harness.getTimeline replays observed events', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const handle = world.sessions.get('new-1')!
    handle.session.__emit({ type: 'agent_start', sessionId: 'new-1' })
    handle.session.__emit({ type: 'agent_end', sessionId: 'new-1' })
    const outcome = await call('harness.getTimeline', { sessionId: 'new-1' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.result as { events: Array<{ type: string }> }
    expect(result.events.map((e) => e.type)).toContain('runtime.started')
  })

  it('agent.command routes set_model through the harness surface', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('agent.command', {
      sessionId: 'new-1',
      command: { type: 'set_model', provider: 'test-provider', modelId: 'test-model' }
    })
    expect(outcome.ok).toBe(true)
    expect(harnessEvents.some((e) => e.event.type === 'model.changed')).toBe(true)
  })

  it('unknown methods and bad commands stay typed', async () => {
    const unknown = await call('harness.doesNotExist', {})
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.code).toBe('METHOD_NOT_FOUND')

    const badCommand = await call('agent.command', { sessionId: 'x', command: { type: '' } })
    expect(badCommand.ok).toBe(false)
    if (!badCommand.ok) expect(badCommand.error.code).toBe('INVALID_INPUT')
  })

  it('harness.getPolicy / setPolicy persist through the control plane', async () => {
    const before = await call('harness.getPolicy', {})
    expect(before.ok).toBe(true)
    if (!before.ok) return
    const snapshot = before.result as { config: { files: { delete: string } } }
    expect(snapshot.config.files.delete).toBe('ask')

    const updated = await call('harness.setPolicy', {
      config: { ...snapshot.config, files: { ...snapshot.config.files, delete: 'deny' } }
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    const persisted = updated.result as { config: { files: { delete: string } } }
    expect(persisted.config.files.delete).toBe('deny')

    const after = await call('harness.getPolicy', {})
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect((after.result as { config: { files: { delete: string } } }).config.files.delete).toBe(
      'deny'
    )
  })

  it('harness checkpoints / evaluations / settings stay empty until used', async () => {
    const checkpoints = await call('harness.listCheckpoints', { sessionId: 'missing-session' })
    expect(checkpoints.ok).toBe(true)
    if (checkpoints.ok) expect(checkpoints.result).toEqual([])

    const evaluations = await call('harness.listEvaluations', { sessionId: 'missing-session' })
    expect(evaluations.ok).toBe(true)
    if (evaluations.ok) expect(evaluations.result).toEqual([])

    const settings = await call('harness.getStoreSettings', {})
    expect(settings.ok).toBe(true)
    if (!settings.ok) return
    expect((settings.result as { retentionDays: number }).retentionDays).toBe(30)
  })

  it('orchestration.create / list / snapshot stay in the runtime store', async () => {
    const created = await call('orchestration.create', {
      cwd: '/tmp/orch',
      name: 'team-alpha',
      strategy: 'dependency',
      maxConcurrentAgents: 2
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const orch = created.result as { id: string; status: string; cwd: string }
    expect(orch.cwd).toBe('/tmp/orch')
    expect(orch.status).toBe('pending')

    const listed = await call('orchestration.list', {})
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const rows = listed.result as Array<{ id: string }>
    expect(rows.some((row) => row.id === orch.id)).toBe(true)

    const snap = await call('orchestration.snapshot', { orchestrationId: orch.id })
    expect(snap.ok).toBe(true)
  })

  it('orchestration pause / resume / abort stay on the runtime state machine', async () => {
    const created = await call('orchestration.create', {
      cwd: '/tmp/orch-ctrl',
      name: 'ctrl',
      strategy: 'manual'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const orch = created.result as { id: string }

    const started = await call('orchestration.start', { orchestrationId: orch.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((started.result as { status: string }).status).toBe('running')

    const paused = await call('orchestration.pause', {
      orchestrationId: orch.id,
      reason: 'hold'
    })
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    expect((paused.result as { status: string; pausedReason: string | null }).status).toBe(
      'paused'
    )

    const resumed = await call('orchestration.resume', { orchestrationId: orch.id })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    expect((resumed.result as { status: string }).status).toBe('running')

    const aborted = await call('orchestration.abort', { orchestrationId: orch.id })
    expect(aborted.ok).toBe(true)
    if (!aborted.ok) return
    expect((aborted.result as { status: string }).status).toBe('aborted')
  })

  it('harness.listRuns returns an empty list for an unknown session', async () => {
    const outcome = await call('harness.listRuns', { sessionId: 'missing-session' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result).toEqual([])
  })

  it('runtime.status reports agent metrics once a session started', async () => {
    await call('agent.start', { cwd: '/tmp/demo' })
    const outcome = await call('runtime.status', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const status = outcome.result as { sdkLoaded: boolean; firstAgentStartMs: number | null }
    expect(status.sdkLoaded).toBe(true)
    expect(status.firstAgentStartMs).not.toBeNull()
  })

  it('settings.get returns app settings from userData', async () => {
    const outcome = await call('settings.get', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const settings = outcome.result as { theme: string; backupRetention: number }
    expect(settings.theme).toBe('dark')
    expect(settings.backupRetention).toBe(20)
  })

  it('providers.list and models.list return arrays', async () => {
    const providers = await call('providers.list', {})
    expect(providers.ok).toBe(true)
    if (!providers.ok) return
    expect(Array.isArray(providers.result)).toBe(true)

    const models = await call('models.list', {})
    expect(models.ok).toBe(true)
    if (!models.ok) return
    expect(Array.isArray(models.result)).toBe(true)
  })

  it('config.getStatus reports models.json paths', async () => {
    const outcome = await call('config.getStatus', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const status = outcome.result as { modelsPath: string; settingsPath: string }
    expect(status.modelsPath).toContain('models.json')
    expect(status.settingsPath).toContain('settings.json')
  })

  it('backup.list and pi.copyInstallCommand work without a live Pi install', async () => {
    const backups = await call('backup.list', {})
    expect(backups.ok).toBe(true)
    if (!backups.ok) return
    expect(Array.isArray(backups.result)).toBe(true)

    const command = await call('pi.copyInstallCommand', {})
    expect(command.ok).toBe(true)
    if (!command.ok) return
    expect(String(command.result)).toContain('npm install')
  })

  it('skills.list and capabilities.list return arrays', async () => {
    const skills = await call('skills.list', {})
    expect(skills.ok).toBe(true)
    if (!skills.ok) return
    expect(Array.isArray(skills.result)).toBe(true)

    const capabilities = await call('capabilities.list', {})
    expect(capabilities.ok).toBe(true)
    if (!capabilities.ok) return
    expect(Array.isArray(capabilities.result)).toBe(true)
  }, 30_000)

  it('diagnostics.get redacts secret-shaped fields', async () => {
    const outcome = await call('diagnostics.get', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const report = JSON.stringify(outcome.result)
    expect(report.toLowerCase()).not.toMatch(/sk-[a-z0-9]{8,}/i)
    expect(outcome.result).toMatchObject({
      security: { backend: expect.any(String) }
    })
  }, 30_000)
})
