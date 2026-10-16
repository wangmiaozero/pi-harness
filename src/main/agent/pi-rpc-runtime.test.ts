// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import type { SessionService } from '../sessions/session-service'
import { RuntimeManager } from '../runtime/runtime-manager'
import { PiRpcRuntime } from './pi-rpc-runtime'
import { PiRpcClient } from './pi-rpc-client'
import * as discovery from '../environment/command-resolver'
import { runtimeLayout, verifyDistribution } from '../runtime/distribution.mjs'
import type { HarnessEvent } from '@shared/types/harness'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
const bundledRoot = path.resolve('resources/runtimes', `${process.platform}-${process.arch}`)
const available = existsSync(path.join(bundledRoot, 'pi/runtime-receipt.json'))
if (process.env.PI_HARNESS_REQUIRE_RUNTIME_TESTS === '1' && !available)
  throw new Error('Real bundled runtime fixtures are required')
const native = available ? describe : describe.skip

native('official standalone Pi with independent Node', () => {
  let root: string
  let cwd: string
  let config: string
  let server: http.Server
  let runtime: PiRpcRuntime
  let manager: RuntimeManager
  const requests: Record<string, unknown>[] = []
  const events: HarnessEvent[] = []
  const replies: Array<string | { tool: string; args: Record<string, unknown> }> = []
  const paths = new Map<string, string>()
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi RPC 空格 ')))
    cwd = path.join(root, 'workspace')
    config = path.join(root, 'agent')
    await fs.mkdir(cwd)
    await fs.mkdir(config)
    requests.length = events.length = replies.length = 0
    paths.clear()
    server = http.createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      const reply = replies.shift() ?? 'Standalone response'
      const tool = typeof reply !== 'string'
      const delta = tool
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `tool-${requests.length}`,
                type: 'function',
                function: { name: reply.tool, arguments: JSON.stringify(reply.args) }
              }
            ]
          }
        : { role: 'assistant', content: reply }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const part of [
        { delta, finish_reason: null },
        { delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }
      ])
        response.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, ...part }] })}\n\n`
        )
      response.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    await fs.writeFile(
      path.join(config, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            api: 'openai-completions',
            apiKey: 'local-fixture',
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            models: [
              {
                id: 'fixture',
                name: 'Fixture',
                input: ['text', 'image'],
                reasoning: false,
                contextWindow: 128000,
                maxTokens: 4096
              }
            ]
          }
        }
      })
    )
    await fs.writeFile(
      path.join(config, 'settings.json'),
      JSON.stringify({
        retry: { enabled: false },
        compaction: { enabled: false },
        packages: [],
        extensions: [],
        skills: [],
        prompts: [],
        themes: []
      })
    )
    manager = new RuntimeManager({
      bundledRoot,
      userRoot: path.join(root, 'runtime'),
      stateFile: path.join(root, 'runtime.json'),
      cache: path.join(root, 'cache'),
      environment: {
        PATH: [
          root,
          process.platform === 'win32'
            ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
            : '/usr/bin',
          ...(process.platform === 'win32' ? [] : ['/bin'])
        ].join(path.delimiter),
        ComSpec: process.env.ComSpec,
        HOME: root,
        USERPROFILE: root,
        SystemRoot: process.env.SystemRoot,
        TEMP: root,
        TMP: root
      }
    })
    const sessions = {
      cachePath: (id: string, file: string) => paths.set(id, file),
      invalidate: () => {},
      resolvePath: async (id: string) => paths.get(id) ?? null,
      get: async () => ({ info: { cwd } })
    } as unknown as SessionService
    runtime = new PiRpcRuntime(sessions, manager, {
      configDir: () => config,
      extensionPath: path.resolve('resources/desktop-extension/index.mjs'),
      workspace: {
        assertWritable: async (file) => {
          if (!file.startsWith(cwd + path.sep)) throw new Error('fixture policy denied')
          return file
        },
        getPrompt: () => 'Desktop workspace context fixture'
      }
    })
  })
  afterEach(async () => {
    await runtime?.shutdownAll()
    server?.closeAllConnections()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(root, { recursive: true, force: true })
  })
  it('starts Pi RPC with no Node, npm or npx on PATH', async () => {
    const client = new PiRpcClient()
    try {
      const layout = runtimeLayout('pi', process.platform)
      client.start(
        path.join(bundledRoot, 'pi', layout.executable),
        ['--mode', 'rpc', '--no-extensions', '--no-skills'],
        cwd,
        {
          PATH: root,
          HOME: root,
          USERPROFILE: root,
          PI_CODING_AGENT_DIR: config,
          SystemRoot: process.env.SystemRoot,
          TEMP: root
        }
      )
      const state = (await client.request({ type: 'get_state' })) as { sessionId: string }
      expect(state.sessionId).toBeTruthy()
      await client.request({ type: 'abort' })
    } finally {
      await client.stop()
    }
  }, 45_000)
  it('executes real bundled node/npm/npx with an otherwise empty PATH', async () => {
    const node = await manager.resolveNodeRuntime()
    expect(node).toMatchObject({
      valid: true,
      version: '24.22.0',
      npm: { version: '11.19.1' },
      npx: { version: '11.19.1' },
      integrity: 'verified'
    })
    await verifyDistribution(path.join(bundledRoot, 'pi'), 'pi', process.platform, process.arch)
  }, 45_000)
  it('streams a model response, preserves native images and resumes its persisted JSONL', async () => {
    const started = await runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' })
    runtime.subscribe(started.sessionId, (event) => events.push(event))
    const image = {
      type: 'image' as const,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mimeType: 'image/png'
    }
    await runtime.prompt(started.sessionId, 'Hello standalone', { images: [image] })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'prompt.completed')).toBe(true), {
      timeout: 20_000
    })
    expect(requests.length).toBe(1)
    expect(JSON.stringify(requests)).toContain('Desktop workspace context fixture')
    const file = paths.get(started.sessionId)!
    const entries = (await fs.readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      entries.find((e) => e.type === 'message' && e.message.role === 'user').message.content
    ).toContainEqual(image)
    await runtime.stopSession(started.sessionId)
    expect((await runtime.startSession({ sessionId: started.sessionId })).sessionId).toBe(
      started.sessionId
    )
    expect(
      (await runtime.getSession(started.sessionId)).entries.some((e) => e.role === 'assistant')
    ).toBe(true)
    await runtime.abort(started.sessionId)
  }, 60_000)
  it('keeps concurrent standalone sessions, events and persisted histories isolated', async () => {
    const [first, second] = await Promise.all([
      runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' }),
      runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' })
    ])
    expect(first.sessionId).not.toBe(second.sessionId)
    const firstEvents: HarnessEvent[] = []
    const secondEvents: HarnessEvent[] = []
    runtime.subscribe(first.sessionId, (event) => firstEvents.push(event))
    runtime.subscribe(second.sessionId, (event) => secondEvents.push(event))
    await Promise.all([
      runtime.prompt(first.sessionId, 'Isolated first task'),
      runtime.prompt(second.sessionId, 'Isolated second task')
    ])
    await vi.waitFor(
      () => {
        expect(firstEvents.some((event) => event.type === 'prompt.completed')).toBe(true)
        expect(secondEvents.some((event) => event.type === 'prompt.completed')).toBe(true)
      },
      { timeout: 20_000 }
    )
    expect(requests).toHaveLength(2)
    const firstHistory = await fs.readFile(paths.get(first.sessionId)!, 'utf8')
    const secondHistory = await fs.readFile(paths.get(second.sessionId)!, 'utf8')
    expect(firstHistory).toContain('Isolated first task')
    expect(firstHistory).not.toContain('Isolated second task')
    expect(secondHistory).toContain('Isolated second task')
    expect(secondHistory).not.toContain('Isolated first task')
    await runtime.stopSession(first.sessionId)
    expect((await runtime.getAgentState(second.sessionId))?.sessionId).toBe(second.sessionId)
    expect((await runtime.startSession({ sessionId: first.sessionId })).sessionId).toBe(
      first.sessionId
    )
  }, 60_000)
  it('blocks unauthorized writes through the official extension tool hook', async () => {
    const started = await runtime.startSession({
      cwd,
      provider: 'fixture',
      modelId: 'fixture',
      toolNames: ['write']
    })
    runtime.subscribe(started.sessionId, (event) => events.push(event))
    const target = path.join(root, 'outside.txt')
    replies.push({ tool: 'write', args: { path: target, content: 'denied' } }, 'Finished')
    await runtime.prompt(started.sessionId, 'Write fixture')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'prompt.completed')).toBe(true), {
      timeout: 20_000
    })
    expect(existsSync(target)).toBe(false)
    expect(events.some((e) => e.type === 'tool.completed' && e.isError)).toBe(true)
  }, 60_000)
  it('uses the selected Node for a real script MCP and an offline npx package MCP', async () => {
    const packageDir = path.join(root, 'local mcp package')
    await fs.mkdir(packageDir)
    const executableFile = path.join(root, 'mcp-executables.jsonl')
    const script = `#!/usr/bin/env node
import fs from 'node:fs'; import readline from 'node:readline';
fs.appendFileSync(${JSON.stringify(executableFile)},JSON.stringify({node:process.execPath,args:process.argv})+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result;
if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{},resources:{}},serverInfo:{name:'local',version:'1'}};
else if(q.method==='tools/list')result={tools:[{name:'echo',description:'Echo fixture',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
else if(q.method==='tools/call')result={content:[{type:'text',text:q.params.arguments.value}]};
else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`
    const entry = path.join(packageDir, 'server.mjs')
    await fs.writeFile(entry, script, { mode: 0o755 })
    await fs.writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'pi-harness-local-mcp-fixture',
        version: '1.0.0',
        type: 'module',
        bin: { 'fixture-mcp': './server.mjs' }
      })
    )
    await fs.writeFile(
      path.join(config, 'mcp.json'),
      JSON.stringify({
        autoEnableCodemode: false,
        mcpServers: {
          script: { command: 'node', args: [entry], exposure: 'direct' },
          cached: {
            command: 'npx',
            args: ['--offline', '--yes', '--package', `file:${packageDir}`, 'fixture-mcp'],
            env: {
              npm_config_cache: path.join(root, 'npm-cache'),
              npm_config_ignore_scripts: 'true'
            },
            exposure: 'direct'
          }
        }
      })
    )
    const started = await runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' })
    runtime.subscribe(started.sessionId, (event) => events.push(event))
    await vi.waitFor(
      async () => {
        const tools = await runtime.getTools(started.sessionId)
        expect(tools.some((tool) => tool.name === 'mcp__script__echo')).toBe(true)
        expect(tools.some((tool) => tool.name === 'mcp__cached__echo')).toBe(true)
      },
      { timeout: 25_000 }
    )
    replies.push(
      { tool: 'mcp__cached__echo', args: { value: 'cached MCP verified' } },
      'MCP completed'
    )
    await runtime.prompt(started.sessionId, 'Run MCP')
    await vi.waitFor(
      () => expect(events.some((event) => event.type === 'prompt.completed')).toBe(true),
      { timeout: 20_000 }
    )
    expect(
      events.some(
        (event) =>
          event.type === 'tool.completed' &&
          event.toolName === 'mcp__cached__echo' &&
          !event.isError
      )
    ).toBe(true)
    const selected = (await manager.resolveNodeRuntime()).executablePath
    const children = (await fs.readFile(executableFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(children).toHaveLength(2)
    for (const child of children) expect(await fs.realpath(child.node)).toBe(selected)
    await runtime.stopSession(started.sessionId)
    await runtime.startSession({ sessionId: started.sessionId })
    await vi.waitFor(
      async () =>
        expect((await fs.readFile(executableFile, 'utf8')).trim().split('\n')).toHaveLength(4),
      { timeout: 25_000 }
    )
  }, 90_000)
  it('loads local TypeScript, Node builtins, an external npm dependency and a provider extension', async () => {
    const extensionRoot = path.join(config, 'extensions')
    const dependency = path.join(extensionRoot, 'node_modules/local-fixture')
    await fs.mkdir(dependency, { recursive: true })
    await fs.writeFile(
      path.join(dependency, 'package.json'),
      JSON.stringify({
        name: 'local-fixture',
        version: '1.0.0',
        type: 'module',
        exports: './index.js'
      })
    )
    await fs.writeFile(path.join(dependency, 'index.js'), 'export const value = 42')
    await fs.writeFile(
      path.join(extensionRoot, 'fixture.ts'),
      `import { basename } from 'node:path'; import { value } from 'local-fixture';
export default function(pi: any) {
 pi.registerTool({name:'fixture_extension',label:'Fixture',description:'Local TS extension',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:basename('/fixture')+value}]})});
 pi.registerProvider('extension-fixture',{baseUrl:'http://127.0.0.1:9/v1',api:'openai-completions',apiKey:'fixture',models:[{id:'extension-model',name:'Extension model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096}]});
}`
    )
    const started = await runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' })
    expect(
      (await runtime.getTools(started.sessionId)).some((tool) => tool.name === 'fixture_extension')
    ).toBe(true)
    await runtime.setModel(started.sessionId, 'extension-fixture', 'extension-model')
    expect((await runtime.getAgentState(started.sessionId))?.model).toMatchObject({
      provider: 'extension-fixture',
      id: 'extension-model'
    })
    await expect(
      runtime.executeAgentCommand(started.sessionId, {
        type: 'bash',
        command: 'echo must not execute'
      })
    ).rejects.toThrow('Unsupported command')
  }, 45_000)
  it('forks and navigates native sessions, changes tools and saves generated images without an extra model turn', async () => {
    const started = await runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' })
    runtime.subscribe(started.sessionId, (event) => events.push(event))
    await runtime.prompt(started.sessionId, 'Persist the fork fixture')
    await vi.waitFor(
      () => expect(events.some((event) => event.type === 'prompt.completed')).toBe(true),
      { timeout: 20_000 }
    )
    events.length = 0
    await runtime.prompt(started.sessionId, 'Second user turn for native fork')
    await vi.waitFor(
      () => expect(events.some((event) => event.type === 'prompt.completed')).toBe(true),
      { timeout: 20_000 }
    )
    const secondUser = (await runtime.getSession(started.sessionId)).entries.filter(
      (entry) => entry.role === 'user'
    )[1]!
    const fork = await runtime.fork(started.sessionId, secondUser.id)
    expect(fork.cancelled).toBe(false)
    expect(fork.newSessionId).not.toBe(started.sessionId)
    const forkedId = fork.newSessionId!
    expect(
      (await runtime.getSession(forkedId)).entries.some((entry) => entry.role === 'user')
    ).toBe(true)
    const user = (await runtime.getSession(forkedId)).entries.find(
      (entry) => entry.role === 'user'
    )!
    await runtime.navigateTree(forkedId, user.id)
    await runtime.setTools(forkedId, [])
    expect((await runtime.getTools(forkedId)).filter((tool) => tool.active)).toHaveLength(0)
    await runtime.setTools(forkedId, ['read', 'write'])
    expect((await runtime.getTools(forkedId)).find((tool) => tool.name === 'write')?.active).toBe(
      true
    )
    const image = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    const saved = await runtime.executeAgentCommand(forkedId, {
      type: 'append_external_image_result',
      prompt: 'Generated fixture',
      provider: 'fixture',
      modelId: 'fixture',
      resultImage: image
    })
    expect(saved).toMatchObject({
      userEntryId: expect.any(String),
      assistantEntryId: expect.any(String)
    })
    const history = await fs.readFile(paths.get(forkedId)!, 'utf8')
    expect(history).toContain('pi-harness-image-result')
    expect(requests).toHaveLength(2)
    expect(await fs.stat(paths.get(started.sessionId)!)).toBeTruthy()
  }, 60_000)
  it('executes the real bundled binaries through controlled System and Custom discovery without allowing managed updates', async () => {
    const pi = await fs.realpath(
      path.join(bundledRoot, 'pi', runtimeLayout('pi', process.platform).executable)
    )
    const node = await fs.realpath(
      path.join(bundledRoot, 'node', runtimeLayout('node', process.platform).executable)
    )
    const shell = vi.spyOn(discovery, 'resolveLoginShellPath').mockResolvedValue({
      shell: null,
      path: path.dirname(node),
      node: { path: node, version: 'v24.22.0' }
    })
    const executable = vi.spyOn(discovery, 'resolveExecutable').mockResolvedValue({
      found: true,
      command: 'pi',
      path: pi,
      version: '1.2.0',
      source: 'process-path'
    })
    const selections = new RuntimeManager({
      bundledRoot,
      userRoot: path.join(root, 'selection-managed'),
      stateFile: path.join(root, 'selections.json'),
      cache: path.join(root, 'selection-cache')
    })
    try {
      for (const source of ['system', 'custom'] as const) {
        const selectedNode = await selections.switchNodeRuntime(
          source === 'system' ? { source } : { source, customPath: node }
        )
        expect(selectedNode.node).toMatchObject({
          source,
          executablePath: node,
          valid: true,
          version: '24.22.0'
        })
        const selectedPi = await selections.switchPiRuntime(
          source === 'system' ? { source } : { source, customPath: pi }
        )
        expect(selectedPi.pi).toMatchObject({
          source,
          executablePath: pi,
          valid: true,
          version: '1.2.0'
        })
        await expect(selections.update('pi')).rejects.toThrow('managed by their owner')
        await expect(selections.update('node')).rejects.toThrow('managed by their owner')
      }
      await selections.switchPiRuntime({ source: 'bundled' })
      await selections.switchNodeRuntime({ source: 'bundled' })
      expect((await selections.configuration()).pi.source).toBe('bundled')
    } finally {
      shell.mockRestore()
      executable.mockRestore()
    }
  }, 90_000)
  it('stages a verified Pi update, atomically activates it, and rolls back to the bundled baseline', async () => {
    const maintenance = new RuntimeManager({
      bundledRoot,
      userRoot: path.join(root, 'managed'),
      stateFile: path.join(root, 'managed.json'),
      cache: path.resolve('.runtime-cache')
    })
    const before = await maintenance.configuration()
    const upgraded = await maintenance.update('pi')
    expect(upgraded.pi).toMatchObject({ valid: true, integrity: 'verified', version: '1.2.0' })
    expect(upgraded.pi.executablePath).toContain(path.join(root, 'managed'))
    expect(upgraded.previous.pi).toBe(true)
    expect(upgraded.configuration.node).toEqual(before.node)
    const restored = await maintenance.rollback('pi')
    expect(restored.pi.executablePath).toBe(
      await fs.realpath(
        path.join(bundledRoot, 'pi', runtimeLayout('pi', process.platform).executable)
      )
    )
    expect(restored.pi.valid).toBe(true)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(maintenance.update('pi', cancelled.signal)).rejects.toThrow()
    expect((await maintenance.resolvePiRuntime()).executablePath).toBe(restored.pi.executablePath)
  }, 60_000)
  it('recovers the verified application baseline when an optional version is no longer usable', async () => {
    const stateFile = path.join(root, 'old-version.json')
    await fs.writeFile(
      stateFile,
      JSON.stringify({
        configuration: { pi: { source: 'bundled' }, node: { source: 'bundled' } },
        active: { pi: '1.2.0-abcdef' },
        previous: {}
      })
    )
    const upgradedApp = new RuntimeManager({
      bundledRoot,
      userRoot: path.join(root, 'missing-old-runtime'),
      stateFile,
      cache: path.join(root, 'cache')
    })
    const recovered = await upgradedApp.resolvePiRuntime()
    expect(recovered.valid).toBe(true)
    expect(recovered.integrity).toBe('verified')
    expect(recovered.diagnosticMessages.join()).toContain('application baseline')
    expect(JSON.parse(await fs.readFile(stateFile, 'utf8')).active.pi).toBe('1.2.0-abcdef')
  }, 30_000)
  it('connects and calls a remote MCP without a usable Node runtime, without enumerating resources', async () => {
    await fs.writeFile(
      path.join(root, 'runtime.json'),
      JSON.stringify({
        configuration: {
          pi: { source: 'bundled' },
          node: { source: 'custom', customPath: path.join(root, 'missing-node') }
        },
        active: {},
        previous: {}
      })
    )
    const methods: string[] = []
    const remote = http.createServer(async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      let body = ''
      for await (const chunk of request) body += chunk
      const q = JSON.parse(body)
      methods.push(q.method)
      if (q.id === undefined) {
        response.writeHead(202).end()
        return
      }
      const result =
        q.method === 'initialize'
          ? {
              protocolVersion: q.params.protocolVersion,
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'remote-fixture', version: '1' }
            }
          : q.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'echo',
                    description: 'Remote echo',
                    inputSchema: {
                      type: 'object',
                      properties: { value: { type: 'string' } },
                      required: ['value']
                    }
                  }
                ]
              }
            : { content: [{ type: 'text', text: q.params?.arguments?.value ?? 'remote result' }] }
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
    })
    await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
    try {
      await fs.writeFile(
        path.join(config, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            remote: {
              url: `http://127.0.0.1:${(remote.address() as { port: number }).port}/mcp`,
              exposure: 'direct'
            }
          }
        })
      )
      const started = await runtime.startSession({ cwd, provider: 'fixture', modelId: 'fixture' })
      runtime.subscribe(started.sessionId, (event) => events.push(event))
      await vi.waitFor(
        async () =>
          expect(
            (await runtime.getTools(started.sessionId)).some(
              (tool) => tool.name === 'mcp__remote__echo'
            )
          ).toBe(true),
        { timeout: 15_000 }
      )
      expect((await manager.resolveNodeRuntime()).valid).toBe(false)
      replies.push(
        { tool: 'mcp__remote__echo', args: { value: 'remote MCP verified' } },
        'Remote completed'
      )
      await runtime.prompt(started.sessionId, 'Call remote fixture')
      await vi.waitFor(
        () => expect(events.some((event) => event.type === 'prompt.completed')).toBe(true),
        { timeout: 15_000 }
      )
      expect(
        events.some(
          (event) =>
            event.type === 'tool.completed' &&
            event.toolName === 'mcp__remote__echo' &&
            !event.isError
        )
      ).toBe(true)
      expect(methods).not.toContain('resources/list')
    } finally {
      remote.closeAllConnections()
      await new Promise<void>((resolve) => remote.close(() => resolve()))
    }
  }, 45_000)
})
