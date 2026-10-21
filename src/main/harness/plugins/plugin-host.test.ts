// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fork, type ChildProcess } from 'node:child_process'
import { build } from 'vite'
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
  type Mock
} from 'vitest'
import { HarnessPluginHost, type PluginHostOptions } from './plugin-host'
import type { HarnessEventEnvelope, HarnessRun } from '@shared/types/harness'
import type { PluginRecord } from '@shared/harness-plugins/types'
import type { PluginProcessFactory } from './process-host'
import { OrchestratorService } from '../orchestrator/orchestrator-service'
import { OrchestrationStore, EMPTY_ORCHESTRATION_STORE } from '../orchestrator/orchestration-store'
import { JsonStore } from '../../services/storage'

let buildDir: string, worker: string, dir: string, host: HarnessPluginHost
const children: ChildProcess[] = []
let listeners: Set<(event: HarnessEventEnvelope) => void>,
  approve: Mock<PluginHostOptions['approve']>
const run = {
  id: 'run-1',
  sessionId: 'session-1',
  status: 'success',
  startedAt: 10,
  finishedAt: 50,
  toolCallCount: 2,
  toolFailureCount: 0,
  usage: { totalTokens: 20 },
  prompt: 'NEVER-SEND-THIS-PROMPT',
  cwd: '/private/secret-project',
  error: 'sk-secret-key-123456789'
} as HarnessRun
const factory: PluginProcessFactory = (entry) => {
  const child = fork(worker, [entry], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {},
    serialization: 'json'
  })
  children.push(child)
  return {
    send: (message) => {
      child.send(message as object)
    },
    onMessage(listener) {
      child.on('message', listener)
      return () => {
        child.removeListener('message', listener)
      }
    },
    onExit(listener) {
      child.on('exit', listener)
      return () => {
        child.removeListener('exit', listener)
      }
    },
    kill() {
      child.kill('SIGKILL')
    }
  }
}
beforeAll(async () => {
  buildDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-plugin-worker-')))
  await build({
    configFile: false,
    logLevel: 'silent',
    ssr: { noExternal: true },
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    build: {
      ssr: true,
      outDir: buildDir,
      rollupOptions: {
        input: path.resolve('src/main/harness/plugins/plugin-worker.ts'),
        output: { format: 'es', entryFileNames: 'plugin-worker.mjs' }
      }
    }
  })
  worker = path.join(buildDir, 'plugin-worker.mjs')
}, 30000)
afterAll(async () => {
  await fs.rm(buildDir, { recursive: true, force: true })
})
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-plugin-host-')))
  listeners = new Set()
  approve = vi.fn(async (record: PluginRecord) => ({
    digest: record.digest,
    permissions: record.manifest.permissions,
    trustedCode: true
  }))
  host = new HarnessPluginHost(options())
  await host.initialize()
})
afterEach(async () => {
  await host.close()
  for (const child of children.splice(0)) child.kill('SIGKILL')
  await fs.rm(dir, { recursive: true, force: true })
})
function options(): PluginHostOptions {
  return {
    directory: path.join(dir, 'installed'),
    processFactory: factory,
    approve,
    harness: {
      onEvent(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      async getRunById() {
        return run
      },
      getRunDetail: vi.fn(async () => ({
        trace: {
          runId: run.id,
          source: 'recorded',
          spans: [
            {
              id: 'span',
              type: 'tool',
              status: 'success',
              startedAt: 11,
              duration: 2,
              name: 'NEVER-SEND-TOOL-COMMAND',
              metadata: { apiKey: 'NEVER-SEND-KEY' }
            }
          ]
        }
      })) as unknown as PluginHostOptions['harness']['getRunDetail']
    }
  }
}
function emit(event: HarnessEventEnvelope['event']): void {
  for (const listener of listeners) listener({ sessionId: run.sessionId, event })
}
async function example(name: string): Promise<string> {
  const descriptor = await host.install(path.resolve('examples/harness-plugins', name))
  return descriptor.manifest.id
}
async function custom(code: string, patch: Record<string, unknown> = {}): Promise<string> {
  const source = path.join(dir, `source-${Math.random().toString(16).slice(2)}`)
  await fs.mkdir(source)
  const manifest = {
    id: 'org.test.executable',
    name: 'Test plugin',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    author: 'Test',
    description: 'Test code',
    entry: 'main.mjs',
    permissions: ['events:read'],
    contributions: { events: ['run.started'] },
    ...patch
  }
  await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(source, 'main.mjs'), code)
  return (await host.install(source)).manifest.id
}

describe('Harness plugin lifecycle and real SDK process execution', () => {
  it('does not transmit late evidence after disable begins while a core read is pending', async () => {
    await host.close()
    const config = options(),
      methods: string[] = []
    let release!: (run: HarnessRun) => void
    config.harness.getRunById = () =>
      new Promise((resolve) => {
        release = resolve
      })
    config.processFactory = (entry) => {
      const transport = factory(entry)
      return {
        ...transport,
        send(message) {
          methods.push((message as { method: string }).method)
          transport.send(message)
        }
      }
    }
    host = new HarnessPluginHost(config)
    await host.initialize()
    const id = await custom(
      `export default {
      activate(api){api.evaluators.register({id:'rule',version:'1.0.0'},()=>({evaluatorId:'rule',version:'1.0.0',score:100,status:'passed',findings:[],metadata:{}}))},
      deactivate(){return new Promise(resolve=>setTimeout(resolve,200))}
    }`,
      {
        permissions: ['evaluation:read'],
        contributions: { evaluators: [{ id: 'rule', version: '1.0.0' }] }
      }
    )
    await host.setEnabled(id, true)
    const pending = host.evaluate(id, 'rule', run.sessionId, run.id)
    const rejected = expect(pending).rejects.toThrow('PLUGIN_DISABLED')
    const disabling = host.setEnabled(id, false)
    await vi.waitFor(() => expect(methods).toContain('deactivate'))
    release(run)
    await rejected
    expect(methods).not.toContain('evaluate')
    await disabling
    expect(host.list()[0].status).toBe('disabled')
  })

  it('isolates one crashing plugin while another keeps receiving events and cleans both independently', async () => {
    const broken = await custom(
      'export default {activate(api){api.events.subscribe(["run.started"],()=>process.exit(7))}}',
      { id: 'org.test.broken' }
    )
    const healthy = await custom(
      'export default {activate(api){api.events.subscribe(["run.started"],()=>api.diagnostics.log("still receiving"))}}',
      { id: 'org.test.healthy' }
    )
    await host.setEnabled(broken, true)
    await host.setEnabled(healthy, true)
    emit({ type: 'run.started', timestamp: 10, runId: run.id, prompt: '' })
    await vi.waitFor(() => {
      expect(host.list().find((p) => p.manifest.id === broken)?.status).toBe('failed')
      expect(
        host
          .list()
          .find((p) => p.manifest.id === healthy)
          ?.diagnostics.some((d) => d.message.includes('still receiving'))
      ).toBe(true)
    })
    expect(listeners.size).toBe(1)
    await host.uninstall(broken)
    emit({ type: 'run.started', timestamp: 20, runId: run.id, prompt: '' })
    await vi.waitFor(() =>
      expect(
        host.list()[0].diagnostics.filter((d) => d.message.includes('still receiving'))
      ).toHaveLength(2)
    )
    expect(host.list()[0].status).toBe('active')
    await host.uninstall(healthy)
    expect(listeners.size).toBe(0)
  })

  it('permits retry after an ordinary evaluator/exporter callback failure without mutating the Run', async () => {
    const id = await custom(
      `export default {activate(api){
      let evaluations=0,exports=0;
      api.evaluators.register({id:'retry',version:'1.0.0'},()=>{
        if(++evaluations===1) throw new Error('Rule unavailable');
        return {evaluatorId:'retry',version:'1.0.0',score:50,status:'warning',findings:[],metadata:{}};
      });
      api.exporters.register({id:'retry',version:'1.0.0'},()=>{
        if(++exports===1) throw new Error('Exporter unavailable');
        return {exported:true};
      });
    }}`,
      {
        permissions: ['evaluation:read', 'trace:read'],
        contributions: {
          evaluators: [{ id: 'retry', version: '1.0.0' }],
          exporters: [{ id: 'retry', version: '1.0.0' }]
        }
      }
    )
    const before = structuredClone(run)
    await host.setEnabled(id, true)
    await expect(host.evaluate(id, 'retry', run.sessionId, run.id)).rejects.toThrow(
      'PLUGIN_EXECUTION_FAILED'
    )
    expect(host.list()[0].status).toBe('active')
    expect((await host.evaluate(id, 'retry', run.sessionId, run.id)).score).toBe(50)
    await expect(host.exportTrace(id, 'retry', run.sessionId, run.id)).rejects.toThrow(
      'PLUGIN_EXECUTION_FAILED'
    )
    expect(await host.exportTrace(id, 'retry', run.sessionId, run.id)).toEqual({ exported: true })
    expect(host.list()[0].status).toBe('active')
    expect(run).toEqual(before)
  })

  it('executes Run Metrics through the SDK and cleans listeners over repeated enable/disable and uninstall', async () => {
    const id = await example('run-metrics')
    for (let i = 0; i < 3; i++) {
      await host.setEnabled(id, true)
      expect(listeners.size).toBe(1)
      emit({ type: 'run.started', timestamp: 10, runId: run.id, prompt: run.prompt })
      emit({ type: 'tool.completed', timestamp: 15, toolName: 'read' })
      emit({ type: 'run.completed', timestamp: 50, runId: run.id, status: 'success' })
      await vi.waitFor(() =>
        expect(
          host
            .list()[0]
            .diagnostics.some(
              (d) =>
                d.code === 'PLUGIN_LOG' &&
                d.message.includes('"durationMs":40') &&
                d.message.includes('"toolCalls":1')
            )
        ).toBe(true)
      )
      await host.setEnabled(id, false)
      expect(listeners.size).toBe(0)
    }
    // Trust is digest-scoped and persistent; re-enabling identical code does not silently broaden permissions.
    expect(approve).toHaveBeenCalledTimes(1)
    await host.uninstall(id)
    expect(host.list()).toEqual([])
  })
  it('runs the quality evaluator and JSON exporter on minimized evidence without mutating the core Run', async () => {
    const before = structuredClone(run),
      id = await example('quality-evaluator')
    await host.setEnabled(id, true)
    const result = await host.evaluate(id, 'quality', run.sessionId, run.id)
    expect(result).toMatchObject({
      evaluatorId: 'quality',
      version: '1.0.0',
      score: 100,
      status: 'passed'
    })
    const exported = await host.exportTrace(id, 'json-trace', run.sessionId, run.id)
    expect(JSON.stringify(exported)).not.toContain('NEVER-SEND')
    expect(exported).toMatchObject({
      schemaVersion: 1,
      trace: { runId: run.id, spans: [{ id: 'span', duration: 2 }] }
    })
    expect(run).toEqual(before)
    await expect(host.evaluate(id, 'quality', 'other-session', run.id)).rejects.toThrow(/belong/)
    await host.uninstall(id)
    expect(
      JSON.parse(await fs.readFile(path.join(dir, 'installed/results.json'), 'utf8')).results
    ).toEqual([])
  })
  it('does not activate incompatible APIs or execute code when permission or trust is denied', async () => {
    const id = await example('run-metrics')
    approve.mockResolvedValue(null)
    await expect(host.setEnabled(id, true)).rejects.toThrow(/denied/)
    expect(listeners.size).toBe(0)
    expect(host.list()[0].enabled).toBe(false)
    approve.mockImplementation(async (record: PluginRecord) => ({
      digest: record.digest,
      permissions: record.manifest.permissions,
      trustedCode: false
    }))
    await expect(host.setEnabled(id, true)).rejects.toThrow(/denied/)
    await host.uninstall(id)
    const incompatible = await custom('throw new Error("must not execute")', {
      apiVersion: '^2.0.0'
    })
    await expect(host.setEnabled(incompatible, true)).rejects.toThrow(/incompatible/)
    expect(host.list()[0].status).toBe('incompatible')
  })
  it('isolates module load exceptions and explicit process exits', async () => {
    const id = await custom('throw new Error("load failed")')
    await expect(host.setEnabled(id, true)).rejects.toThrow()
    expect(host.list()[0].status).toBe('failed')
    expect(listeners.size).toBe(0)
    await host.uninstall(id)
    const exiting = await custom('export default {activate(){process.exit(5)}}')
    await expect(host.setEnabled(exiting, true)).rejects.toThrow()
    expect(host.list()[0].diagnostics.some((d) => d.code === 'PLUGIN_PROCESS_EXIT')).toBe(true)
  })
  it('bounds activation time even for an infinite synchronous loop', async () => {
    const id = await custom(
      'export default {activate(){while(true){/* deliberate hostile fixture */}}}'
    )
    await expect(host.setEnabled(id, true)).rejects.toThrow('PLUGIN_TIMEOUT')
    expect(host.list()[0].status).toBe('failed')
    expect(listeners.size).toBe(0)
  }, 5000)
  it('bounds event queues, keeps the emitting thread responsive and terminates stalled subscribers', async () => {
    await host.close()
    host = new HarnessPluginHost({ ...options(), timeoutMs: 100, eventQueueLimit: 2 })
    await host.initialize()
    const id = await custom(
      'export default {activate(api){api.events.subscribe(["run.started"],()=>{while(true){/* stalled subscriber */}})}}'
    )
    await host.setEnabled(id, true)
    const start = performance.now()
    for (let i = 0; i < 10; i++)
      emit({ type: 'run.started', timestamp: 10, runId: run.id, prompt: run.prompt })
    expect(performance.now() - start).toBeLessThan(100)
    expect(host.list()[0].droppedEvents).toBe(8)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listeners.size).toBe(1)
    await vi.waitFor(() => expect(host.list()[0].status).toBe('failed'))
    expect(listeners.size).toBe(0)
    expect(host.list()[0].diagnostics.some((d) => d.code === 'PLUGIN_TIMEOUT')).toBe(true)
  })
  it('projects event scalars and honors unsubscribe inside the SDK', async () => {
    const id = await custom(
      'export default {activate(api){const off=api.events.subscribe(["run.started"],e=>api.diagnostics.log("projection",{event:JSON.stringify(e)}));const removed=api.events.subscribe(["run.started"],()=>{throw new Error("must be removed")});removed();this.off=off},deactivate(){this.off()}}'
    )
    await host.setEnabled(id, true)
    emit({ type: 'run.started', timestamp: 10, runId: run.id, prompt: run.prompt })
    await vi.waitFor(() =>
      expect(host.list()[0].diagnostics.some((d) => d.message.includes('projection'))).toBe(true)
    )
    expect(JSON.stringify(host.list()[0].diagnostics)).not.toContain(run.prompt)
    expect(host.list()[0].status).toBe('active')
  })
  it('rejects undeclared registrations and exceptions from subscribers', async () => {
    const id = await custom(
      'export default {activate(api){api.evaluators.register({id:"rogue",version:"1.0.0"},()=>({}))}}'
    )
    await expect(host.setEnabled(id, true)).rejects.toThrow()
    await host.uninstall(id)
    const broken = await custom(
      'export default {activate(api){api.events.subscribe(["run.started"],()=>{throw new Error("bad callback")})}}'
    )
    await host.setEnabled(broken, true)
    emit({ type: 'run.started', timestamp: 10, runId: run.id, prompt: '' })
    await vi.waitFor(() => expect(host.list()[0].status).toBe('failed'))
    expect(listeners.size).toBe(0)
  })
  it('materializes the declarative team example through the real orchestrator without starting it or bypassing review gates', async () => {
    const store = new OrchestrationStore(
      new JsonStore(
        path.join(dir, 'orchestration.json'),
        structuredClone(EMPTY_ORCHESTRATION_STORE)
      )
    )
    const startSession = vi.fn(),
      orchestrator = new OrchestratorService(store, {
        startSession,
        emitOrchestrationEvent: vi.fn(),
        listRunsByOrchestration: async () => [],
        artifactsForAgent: async () => [],
        getOrchestrationTimeline: () => []
      } as unknown as ConstructorParameters<typeof OrchestratorService>[1])
    await host.close()
    host = new HarnessPluginHost({ ...options(), orchestrator })
    await host.initialize()
    const id = await example('team-template')
    await host.setEnabled(id, true)
    const runId = await host.applyTeam(id, 'development-review', dir),
      snapshot = await orchestrator.snapshot(runId)
    expect(snapshot.orchestration.status).toBe('pending')
    expect(snapshot.tasks).toHaveLength(3)
    expect(snapshot.agents).toHaveLength(3)
    expect(snapshot.tasks.find((t) => t.reviewRequired)?.title).toBe('Review the change')
    expect(snapshot.tasks.filter((t) => t.dependencies.length)).toHaveLength(2)
    expect(startSession).not.toHaveBeenCalled()
    await host.setEnabled(id, false)
    await expect(host.applyTeam(id, 'development-review', dir)).rejects.toThrow(/inactive/)
  })
  it('isolates an active process exit and evaluator timeout without changing the core Run', async () => {
    const id = await custom(
      'export default {activate(api){api.events.subscribe(["run.started"],()=>process.exit(7))}}'
    )
    await host.setEnabled(id, true)
    emit({ type: 'run.started', timestamp: 10, runId: run.id, prompt: '' })
    await vi.waitFor(() => expect(host.list()[0].status).toBe('failed'))
    expect(listeners.size).toBe(0)
    expect(host.list()[0].diagnostics.some((d) => d.code === 'PLUGIN_PROCESS_EXIT')).toBe(true)
    await host.uninstall(id)
    await host.close()
    host = new HarnessPluginHost({ ...options(), timeoutMs: 100 })
    await host.initialize()
    const evaluator = await custom(
      'export default {activate(api){api.evaluators.register({id:"stall",version:"1.0.0"},()=>new Promise(()=>{}))}}',
      {
        permissions: ['evaluation:read'],
        contributions: { evaluators: [{ id: 'stall', version: '1.0.0' }] }
      }
    )
    await host.setEnabled(evaluator, true)
    await expect(host.evaluate(evaluator, 'stall', run.sessionId, run.id)).rejects.toThrow(
      'PLUGIN_TIMEOUT'
    )
    expect(host.list()[0].status).toBe('failed')
    expect(run.prompt).toBe('NEVER-SEND-THIS-PROMPT')
  })
  it('rejects out-of-contract evaluator identities and output without storing a result', async () => {
    const id = await custom(
      'export default {activate(api){api.evaluators.register({id:"rule",version:"1.0.0"},()=>({evaluatorId:"other",version:"1.0.0",score:100,status:"passed",findings:[],metadata:{}}))}}',
      {
        permissions: ['evaluation:read'],
        contributions: { evaluators: [{ id: 'rule', version: '1.0.0' }] }
      }
    )
    await host.setEnabled(id, true)
    await expect(host.evaluate(id, 'rule', run.sessionId, run.id)).rejects.toThrow(
      'PLUGIN_INVALID_RESULT'
    )
    expect(host.list()[0].results).toEqual([])
  })
  it('retains bounded UTF-8 results and restores accepted nested metadata after restart', async () => {
    await host.close()
    const config = options()
    config.harness.getRunById = async (id) => ({ ...run, id })
    host = new HarnessPluginHost(config)
    await host.initialize()
    const id = await custom(
      `export default {activate(api){
        api.evaluators.register({id:'nested',version:'1.0.0'},()=>{
          let nested={text:'文'.repeat(16000)};
          for(let i=0;i<7;i++) nested={child:nested};
          return {evaluatorId:'nested',version:'1.0.0',score:100,status:'passed',findings:[],metadata:{nested}};
        })
      }}`,
      {
        permissions: ['evaluation:read'],
        contributions: { evaluators: [{ id: 'nested', version: '1.0.0' }] }
      }
    )
    await host.setEnabled(id, true)
    for (let i = 0; i < 30; i++) await host.evaluate(id, 'nested', run.sessionId, `result-${i}`)
    const file = await fs.readFile(path.join(dir, 'installed/results.json'))
    expect(file.length).toBeLessThanOrEqual(1024 * 1024)
    const results = JSON.parse(file.toString()).results
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThan(30)
    await host.close()
    host = new HarnessPluginHost(config)
    await host.initialize()
    expect(host.list()[0].results.at(-1)?.runId).toBe('result-29')
    expect(host.list()[0].status).toBe('active')
  })
  it('clears trust on uninstall and preserves approved enablement on restart only for verified content', async () => {
    const id = await example('run-metrics')
    await host.setEnabled(id, true)
    await host.close()
    host = new HarnessPluginHost(options())
    await host.initialize()
    expect(host.list()[0].status).toBe('active')
    expect(approve).toHaveBeenCalledTimes(1)
    await host.setEnabled(id, false)
    await fs.appendFile(path.join(dir, 'installed', id, 'main.mjs'), '\n// changed after trust')
    await expect(host.setEnabled(id, true)).rejects.toThrow(/changed/)
    expect(listeners.size).toBe(0)
  })
})
