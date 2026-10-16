// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import type { AgentEvent } from '@shared/types/workspace'
import { SessionService } from '../sessions/session-service'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

import { AgentRuntimeService } from './agent-runtime-service'
import { loadPiCodingAgent } from './pi-sdk'
import { mapAgentEvent } from '../harness/harness-events'
import { RunRegistry } from '../harness/runs/run-registry'

type Reply = { tool: string; args: Record<string, unknown> } | string

describe('Pi 1.2 native execution compatibility', () => {
  let root: string
  let cwd: string
  let agentDir: string
  let server: http.Server
  let runtime: AgentRuntimeService
  const replies: Reply[] = []
  const requests: Record<string, unknown>[] = []
  const events: AgentEvent[] = []
  let workspace = 'first project'
  let policySignal: AbortSignal | undefined

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi harness native-'))
    cwd = path.join(root, 'project')
    agentDir = path.join(root, 'agent')
    await fs.mkdir(cwd)
    await fs.mkdir(agentDir)
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    replies.length = requests.length = events.length = 0
    workspace = 'first project'
    policySignal = undefined
    server = http.createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      const reply = replies.shift() ?? 'completed'
      if (reply === 'provider-error-fixture') {
        response
          .writeHead(500, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: { message: 'fixture final provider failure' } }))
        return
      }
      const tool = typeof reply !== 'string'
      const delta = tool
        ? {
            role: 'assistant',
            reasoning_content: 'native reasoning retained',
            tool_calls: [
              {
                index: 0,
                id: `call-${requests.length}`,
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
      ]) {
        response.write(
          `data: ${JSON.stringify({
            id: 'local',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture',
            choices: [{ index: 0, ...part }]
          })}\n\n`
        )
      }
      response.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local provider')
    await fs.writeFile(
      path.join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            api: 'openai-completions',
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: 'local-fixture-placeholder',
            models: [
              {
                id: 'fixture',
                name: 'Local fixture',
                reasoning: true,
                input: ['text'],
                contextWindow: 128000,
                maxTokens: 4096,
                compat: { thinkingFormat: 'deepseek' }
              }
            ]
          }
        }
      })
    )
    await fs.writeFile(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({
        retry: { enabled: false },
        compaction: { enabled: false },
        packages: [],
        skills: [],
        extensions: [],
        prompts: [],
        themes: []
      })
    )
    runtime = new AgentRuntimeService(
      { invalidate: () => {}, cachePath: () => {} } as unknown as SessionService,
      {
        getPrompt: () =>
          `--- BEGIN PI-HARNESS WORKSPACE ---\n${workspace}\n--- END PI-HARNESS WORKSPACE ---`,
        assertWritable: async (target) => {
          if (target.includes('denied')) throw new Error('read-only fixture')
          return path.resolve(cwd, target)
        },
        assertToolAllowed: async (name, input, _sessionId, signal) => {
          if (name === 'bash' && JSON.stringify(input).includes('blocked-policy')) {
            throw new Error('policy fixture denied')
          }
          if (JSON.stringify(input).includes('policy-cancel-fixture')) {
            policySignal = signal
            await new Promise<void>((_resolve, reject) => {
              if (!signal) {
                reject(new Error('Missing native abort signal'))
                return
              }
              signal.addEventListener(
                'abort',
                () => reject(new Error('fixture permission cancelled')),
                { once: true }
              )
            })
          }
        }
      }
    )
  })

  afterEach(async () => {
    await runtime?.shutdownAll()
    server?.closeAllConnections()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    vi.unstubAllEnvs()
    await fs.rm(root, { recursive: true, force: true })
  })

  async function start(toolNames?: string[]) {
    const started = await runtime.start({
      cwd,
      provider: 'fixture',
      modelId: 'fixture',
      thinkingLevel: 'high',
      ...(toolNames ? { toolNames } : {})
    })
    runtime.subscribe(started.sessionId, (event) => events.push(event))
    return runtime.get(started.sessionId)!
  }

  async function run(sessionId: string, reply: Reply, message = 'Run fixture') {
    replies.push(reply, 'completed')
    const before = events.length
    await runtime.prompt(sessionId, message)
    await expect
      .poll(() => events.slice(before).some((event) => event.type === 'prompt_done'), {
        timeout: 15000
      })
      .toBe(true)
    return events.slice(before).filter((event) => event.type === 'tool_execution_end')
  }

  it('executes native tools and nested Codemode through workspace and policy guards', async () => {
    const wrapper = await start(['read', 'write', 'edit', 'bash', 'codemode'])
    await run(wrapper.sessionId, {
      tool: 'write',
      args: { path: 'allowed.txt', content: 'written' }
    })
    expect(await fs.readFile(path.join(cwd, 'allowed.txt'), 'utf8')).toBe('written')
    const direct = await run(wrapper.sessionId, {
      tool: 'write',
      args: { path: 'denied.txt', content: 'blocked' }
    })
    expect(direct).toContainEqual(expect.objectContaining({ toolName: 'write', isError: true }))
    const nested = await run(wrapper.sessionId, {
      tool: 'codemode',
      args: {
        code: 'await tools.write({path: "denied-nested.txt", content: "blocked"})'
      }
    })
    expect(JSON.stringify(nested)).toContain('read-only fixture')
    await expect(fs.stat(path.join(cwd, 'denied-nested.txt'))).rejects.toThrow()
    const policy = await run(wrapper.sessionId, {
      tool: 'bash',
      args: { command: 'echo blocked-policy' }
    })
    expect(JSON.stringify(policy)).toContain('policy fixture denied')
    workspace = 'second project'
    await run(wrapper.sessionId, { tool: 'read', args: { path: 'allowed.txt' } })
    const wire = JSON.stringify(requests.at(-1))
    expect(wire).toContain('second project')
    expect(wire).not.toContain('first project')
    expect(wire.match(/BEGIN PI-HARNESS WORKSPACE/g)).toHaveLength(1)
    const persisted = await fs.readFile(wrapper.inner.sessionFile!, 'utf8')
    expect(persisted).toContain('native reasoning retained')
    const sdk = await loadPiCodingAgent()
    expect(sdk.serializeConversation(sdk.convertToLlm(wrapper.inner.messages))).not.toContain(
      'native reasoning retained'
    )
  }, 60000)

  it('preserves inactive native tools and releases extensions on reload and shutdown', async () => {
    const extension = path.join(agentDir, 'extensions', 'fixture.js')
    await fs.mkdir(path.dirname(extension))
    await fs.writeFile(
      extension,
      `import fs from 'node:fs';
      export default function(pi) {
        pi.registerTool({ name: 'fixture_echo', label: 'Fixture', description: 'Echo',
          parameters: {type:'object',properties:{},additionalProperties:false},
          execute: async () => ({content:[{type:'text',text:'echo'}],details:{}}) });
        pi.on('session_shutdown', e => fs.appendFileSync(${JSON.stringify(path.join(root, 'shutdown'))}, e.reason+'\\n'));
      }`
    )
    // Auto-discovered extensions are native resources, not a mocked registry.
    const wrapper = await start(['read'])
    expect(wrapper.inner.getActiveToolNames()).toContain('fixture_echo')
    expect(wrapper.inner.getAllTools().map((tool) => tool.name)).toContain('codemode')
    expect(wrapper.inner.getActiveToolNames()).not.toContain('codemode')
    expect(wrapper.inner.getActiveToolNames()).not.toContain('tool_search')
    await run(wrapper.sessionId, { tool: 'fixture_echo', args: {} })
    await fs.unlink(extension)
    await wrapper.inner.reload()
    expect(wrapper.inner.getAllTools().map((tool) => tool.name)).not.toContain('fixture_echo')
    expect(await fs.readFile(path.join(root, 'shutdown'), 'utf8')).toBe('reload\n')
    await wrapper.shutdown()
    expect(runtime.get(wrapper.sessionId)).toBeUndefined()
  }, 60000)

  it('propagates native cancellation through asynchronous tool permission checks', async () => {
    const wrapper = await start(['bash'])
    replies.push({ tool: 'bash', args: { command: 'echo policy-cancel-fixture' } })
    await runtime.prompt(wrapper.sessionId, 'Permission cancellation fixture')
    await expect.poll(() => Boolean(policySignal)).toBe(true)
    await wrapper.send({ type: 'abort' })
    expect(policySignal?.aborted).toBe(true)
    expect(wrapper.isRunning()).toBe(false)
    expect(requests).toHaveLength(1)
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_settled', aborted: true }))
  }, 60000)

  it('handles custom runs and aborts startup while the native session is busy', async () => {
    const extension = path.join(agentDir, 'extensions', 'startup.js')
    const observations = path.join(root, 'starts.jsonl')
    const release = path.join(root, 'release')
    await fs.mkdir(path.dirname(extension))
    await fs.writeFile(
      extension,
      `import fs from 'node:fs/promises';
      export default function(pi) {
        pi.registerCommand('fixture-custom', {description:'Custom run', handler: async () => {
          pi.sendMessage({customType:'fixture',content:'custom trigger',display:true},{triggerTurn:true});
        }});
        pi.on('before_agent_start',async (e,ctx)=>{
          await fs.appendFile(${JSON.stringify(observations)},JSON.stringify({type:e.messageType,idle:ctx.isIdle(),hasUI:ctx.hasUI})+'\\n');
          if(e.messageType==='user' && e.prompt==='blocked startup') {
            for(let i=0;i<4500;i++) {
              try {await fs.stat(${JSON.stringify(release)});break;}catch{}
              await new Promise(r=>setTimeout(r,10));
            }
          }
        });
      }`
    )
    const wrapper = await start()
    await runtime.prompt(wrapper.sessionId, '/fixture-custom')
    await expect
      .poll(async () => (await fs.readFile(observations, 'utf8')).includes('custom'))
      .toBe(true)
    await expect.poll(() => wrapper.isRunning()).toBe(false)
    const custom = JSON.parse((await fs.readFile(observations, 'utf8')).trim().split('\n')[0])
    expect(custom).toEqual({ type: 'custom', idle: false, hasUI: false })
    const before = requests.length
    const starting = runtime.prompt(wrapper.sessionId, 'blocked startup')
    await expect
      .poll(async () => (await fs.readFile(observations, 'utf8')).includes('user'))
      .toBe(true)
    expect(wrapper.isRunning()).toBe(true)
    const duplicate = expect(
      runtime.prompt(wrapper.sessionId, 'duplicate startup')
    ).rejects.toThrow()
    const aborting = wrapper.send({ type: 'abort' })
    await fs.writeFile(release, '')
    await aborting
    await starting
    await duplicate
    await expect.poll(() => wrapper.isRunning()).toBe(false)
    expect(requests).toHaveLength(before)
    expect(JSON.parse((await fs.readFile(observations, 'utf8')).trim().split('\n')[1]).idle).toBe(
      false
    )
  }, 60000)

  it('forks through native lifecycle hooks and restores thinking history without rewriting it', async () => {
    const extension = path.join(agentDir, 'extensions', 'fork.js')
    const cancelled = path.join(root, 'cancel-fork')
    const log = path.join(root, 'fork-events')
    await fs.mkdir(path.dirname(extension))
    await fs.writeFile(
      extension,
      `import fs from 'node:fs'; export default function(pi) {
      pi.on('session_before_fork',()=> {fs.appendFileSync(${JSON.stringify(log)},'before\\n');
        if(fs.existsSync(${JSON.stringify(cancelled)})) return {cancel:true}; });
      pi.on('session_shutdown',e=>fs.appendFileSync(${JSON.stringify(log)},e.reason+'\\n'));
    }`
    )
    const wrapper = await start()
    await run(wrapper.sessionId, {
      tool: 'write',
      args: { path: 'history.txt', content: 'history' }
    })
    const file = wrapper.inner.sessionFile!
    const original = await fs.readFile(file, 'utf8')
    const user = wrapper.inner.sessionManager
      .getEntries()
      .find((entry) => entry.type === 'message' && entry.message.role === 'user')!
    await fs.writeFile(cancelled, '')
    expect(await wrapper.send({ type: 'fork', entryId: user.id })).toEqual({ cancelled: true })
    expect(wrapper.isAlive()).toBe(true)
    await fs.unlink(cancelled)
    const fork = (await wrapper.send({ type: 'fork', entryId: user.id })) as {
      cancelled: boolean
      newSessionId: string
    }
    expect(fork.cancelled).toBe(false)
    expect(fork.newSessionId).not.toBe(wrapper.sessionId)
    expect(runtime.get(wrapper.sessionId)).toBeUndefined()
    expect(runtime.get(fork.newSessionId)?.isAlive()).toBe(true)
    expect(await fs.readFile(log, 'utf8')).toBe('before\nbefore\nfork\n')
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    const sdk = await loadPiCodingAgent()
    const restored = sdk.SessionManager.open(file)
    expect(JSON.stringify(restored.buildSessionContext().messages)).toContain(
      'native reasoning retained'
    )
    expect(restored.buildSessionContext().thinkingLevel).toBe('high')
  }, 60000)

  it('runs stdio MCP with all JSON result shapes, resources and native Codemode limits', async () => {
    const child = path.join(root, 'mcp.mjs')
    const pidPath = path.join(root, 'mcp.pid')
    await fs.writeFile(
      child,
      `import fs from 'node:fs'; import readline from 'node:readline';
      fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));
      const lines=readline.createInterface({input:process.stdin});
      lines.on('line',line=>{ const q=JSON.parse(line); if(q.id===undefined)return;
        let result;
        if(q.method==='initialize') result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{},resources:{}},serverInfo:{name:'fixture',version:'1'},instructions:'Fixture namespace'};
        else if(q.method==='tools/list') result={tools:[{name:'echo',description:'Echo any JSON value',inputSchema:{type:'object',properties:{value:{}},required:['value']}}]};
        else if(q.method==='tools/call') result={content:[{type:'text',text:'echo'}],structuredContent:q.params.arguments.value};
        else if(q.method==='resources/list') result={resources:[{uri:'fixture://readme',name:'Readme',mimeType:'text/plain'}]};
        else if(q.method==='resources/templates/list') result={resourceTemplates:[]};
        else if(q.method==='resources/read') result={contents:[{uri:q.params.uri,text:'resource content',mimeType:'text/plain'}]};
        else return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'Unknown'}})+'\\n');
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
      });`
    )
    await fs.writeFile(
      path.join(agentDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: { command: process.execPath, args: [child], exposure: 'codemode' }
        }
      })
    )
    const wrapper = await start(['read'])
    expect(wrapper.inner.getActiveToolNames()).toContain('codemode')
    const shapes = [{ ok: true }, [1, 2], 'string', 42, true, null]
    const result = await run(wrapper.sessionId, {
      tool: 'codemode',
      args: {
        code: `text(await searchTools('echo',{namespace:'fixture'})); text(await describeNamespace('fixture')); const actual=[]; for (const value of ${JSON.stringify(shapes)}) { actual.push((await tools.mcp__fixture__echo({value})).structuredContent); } if(JSON.stringify(actual)!==${JSON.stringify(JSON.stringify(shapes))})throw new Error('JSON shapes changed'); text('all-shapes-verified'); text(await tools.list_mcp_resources({})); text(await tools.read_mcp_resource({server:'fixture',uri:'fixture://readme'}));`
      }
    })
    const output = JSON.stringify(result)
    for (const fragment of [
      'all-shapes-verified',
      'Fixture namespace',
      'fixture://readme',
      'resource content'
    ])
      expect(output).toContain(fragment)
    expect(result.find((event) => event.toolName === 'codemode')?.isError).toBe(false)
    const reach = wrapper.inner.getAllTools().find((tool) => tool.name === 'codemode')?.reachesTools
    expect(
      typeof reach === 'function' ? reach({ code: 'text(await searchTools("echo"))' }) : reach
    ).toBe('all')
    const timeout = await run(wrapper.sessionId, {
      tool: 'codemode',
      args: {
        code: '// @options: {"timeout_ms": 100}\nwhile (true) {}'
      }
    })
    expect(timeout).toContainEqual(expect.objectContaining({ toolName: 'codemode', isError: true }))
    const lots = await run(wrapper.sessionId, {
      tool: 'codemode',
      args: {
        code: 'for (let i = 0; i < 100; i++) text("output-" + i)'
      }
    })
    expect(JSON.stringify(lots)).toContain('output-99')
    const invalid = await run(wrapper.sessionId, {
      tool: 'codemode',
      args: {
        code: 'throw new Error("fixture script failure")'
      }
    })
    expect(invalid).toContainEqual(expect.objectContaining({ toolName: 'codemode', isError: true }))
    expect(JSON.stringify(invalid)).toContain('fixture script failure')
    replies.push({ tool: 'codemode', args: { code: 'while (true) {}' } })
    const before = events.length
    await runtime.prompt(wrapper.sessionId, 'Cancel sandbox fixture')
    await expect
      .poll(() =>
        events
          .slice(before)
          .some((event) => event.type === 'tool_execution_start' && event.toolName === 'codemode')
      )
      .toBe(true)
    await wrapper.send({ type: 'abort' })
    await expect.poll(() => wrapper.isRunning()).toBe(false)
    expect(events.slice(before)).toContainEqual(
      expect.objectContaining({ type: 'agent_settled', aborted: true })
    )
    const pid = Number(await fs.readFile(pidPath, 'utf8'))
    await wrapper.shutdown()
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
  }, 60000)

  it('isolates missing and failed extensions while preserving valid native tools', async () => {
    const extensions = path.join(agentDir, 'extensions')
    await fs.mkdir(extensions)
    const bad = path.join(extensions, 'failed.js')
    await fs.writeFile(bad, 'export default function(){throw new Error("fixture init failure")}')
    const dependency = path.join(extensions, 'dependency.js')
    await fs.writeFile(
      dependency,
      'import "missing-pi-fixture-dependency"; export default function(){}'
    )
    const settings = path.join(agentDir, 'settings.json')
    const previous = JSON.parse(await fs.readFile(settings, 'utf8'))
    await fs.writeFile(
      settings,
      JSON.stringify({ ...previous, extensions: [path.join(root, 'missing.js')] })
    )
    const wrapper = await start()
    const failures = JSON.stringify(wrapper.inner.resourceLoader.getExtensions().errors)
    expect(failures).toContain('fixture init failure')
    expect(failures).toContain('missing-pi-fixture-dependency')
    // Native discovery skips absent resource paths; failed factories/imports report errors.
    expect(
      wrapper.inner.resourceLoader
        .getExtensions()
        .extensions.some((extension) => extension.path === path.join(root, 'missing.js'))
    ).toBe(false)
    const result = await run(wrapper.sessionId, {
      tool: 'write',
      args: { path: 'survives.txt', content: 'survives' }
    })
    expect(result).toContainEqual(expect.objectContaining({ toolName: 'write', isError: false }))
    expect(await fs.readFile(path.join(cwd, 'survives.txt'), 'utf8')).toBe('survives')
  }, 60000)

  it('uses native HTTP MCP discovery, deferred tools, request timeout and reconnect', async () => {
    let initializations = 0
    const web = http.createServer(async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      let body = ''
      for await (const chunk of request) body += chunk
      const call = JSON.parse(body)
      if (call.id === undefined) {
        response.writeHead(202).end()
        return
      }
      let result: unknown
      if (call.method === 'initialize') {
        initializations++
        result = {
          protocolVersion: call.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'web', version: '1' }
        }
      } else if (call.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'echo',
              description: 'Echo HTTP',
              inputSchema: { type: 'object', properties: { hang: { type: 'boolean' } } }
            }
          ]
        }
      else if (call.method === 'tools/call') {
        if (call.params.arguments.hang) return
        result = { content: [{ type: 'text', text: 'HTTP native result' }], structuredContent: 42 }
      } else result = {}
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }))
    })
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve))
    const address = web.address()
    if (!address || typeof address === 'string') throw new Error('Missing MCP address')
    await fs.writeFile(
      path.join(agentDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          web: {
            url: `http://127.0.0.1:${address.port}/mcp`,
            exposure: 'deferred',
            timeout: 0.1
          }
        }
      })
    )
    try {
      const wrapper = await start(['read'])
      expect(wrapper.inner.getActiveToolNames()).toContain('tool_search')
      expect(wrapper.inner.getActiveToolNames()).not.toContain('mcp__web__echo')
      const found = await run(wrapper.sessionId, { tool: 'tool_search', args: { query: 'echo' } })
      expect(JSON.stringify(found)).toContain('mcp__web__echo')
      expect(wrapper.inner.getActiveToolNames()).toContain('mcp__web__echo')
      const called = await run(wrapper.sessionId, { tool: 'mcp__web__echo', args: {} })
      expect(JSON.stringify(called)).toContain('HTTP native result')
      const timeout = await run(wrapper.sessionId, { tool: 'mcp__web__echo', args: { hang: true } })
      expect(timeout).toContainEqual(
        expect.objectContaining({ toolName: 'mcp__web__echo', isError: true })
      )
      await runtime.prompt(wrapper.sessionId, '/mcp reconnect web')
      await expect.poll(() => initializations).toBe(2)
      await wrapper.shutdown()
    } finally {
      web.closeAllConnections()
      await new Promise<void>((resolve) => web.close(() => resolve()))
    }
  }, 60000)

  it('loads native theme vars and safely falls back without changing renderer settings', async () => {
    const sdk = await loadPiCodingAgent()
    const colors = Object.fromEntries(
      [
        'accent',
        'border',
        'borderAccent',
        'borderMuted',
        'success',
        'error',
        'warning',
        'muted',
        'dim',
        'text',
        'thinkingText',
        'selectedBg',
        'userMessageBg',
        'userMessageText',
        'customMessageBg',
        'customMessageText',
        'customMessageLabel',
        'toolPendingBg',
        'toolSuccessBg',
        'toolErrorBg',
        'toolTitle',
        'toolOutput',
        'mdHeading',
        'mdLink',
        'mdLinkUrl',
        'mdCode',
        'mdCodeBlock',
        'mdCodeBlockBorder',
        'mdQuote',
        'mdQuoteBorder',
        'mdHr',
        'mdListBullet',
        'toolDiffAdded',
        'toolDiffRemoved',
        'toolDiffContext',
        'syntaxComment',
        'syntaxKeyword',
        'syntaxFunction',
        'syntaxVariable',
        'syntaxString',
        'syntaxNumber',
        'syntaxType',
        'syntaxOperator',
        'syntaxPunctuation',
        'thinkingOff',
        'thinkingMinimal',
        'thinkingLow',
        'thinkingMedium',
        'thinkingHigh',
        'thinkingXhigh',
        'bashMode'
      ].map((key) => [key, 'brand'])
    )
    const themes = path.join(agentDir, 'themes')
    await fs.mkdir(themes)
    const file = path.join(themes, 'fixture.json')
    const original = JSON.stringify({
      name: 'fixture',
      appearance: 'dark',
      vars: { brand: '#ff00ff' },
      colors
    })
    await fs.writeFile(file, original)
    sdk.initTheme('fixture')
    const magenta = /\u001b\[38;(?:2;255;0;255|5;201)m/
    expect(sdk.getMarkdownTheme().quote('sample')).toMatch(magenta)
    await fs.writeFile(
      file,
      JSON.stringify({ name: 'fixture', colors: { mdQuote: 'broken color' } })
    )
    expect(() => sdk.initTheme('fixture')).not.toThrow()
    expect(sdk.getMarkdownTheme().quote('sample')).not.toMatch(magenta)
    await fs.writeFile(file, original)
    sdk.initTheme('fixture')
    expect(sdk.getMarkdownTheme().quote('sample')).toMatch(magenta)
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    await fs.unlink(file)
    expect(() => sdk.initTheme('fixture')).not.toThrow()
  })

  it('reads legacy and truncated history through native migration without changing source bytes', async () => {
    const file = path.join(root, 'legacy.jsonl')
    const entries = [
      { type: 'session', version: 2, id: 'legacy', cwd, timestamp: '2026-10-13T00:00:00Z' },
      {
        type: 'thinking_level_change',
        id: 'thinking',
        parentId: null,
        thinkingLevel: 'high',
        timestamp: '2026-10-13T00:00:01Z'
      },
      {
        type: 'message',
        id: 'custom',
        parentId: 'thinking',
        timestamp: '2026-10-13T00:00:02Z',
        message: {
          role: 'hookMessage',
          customType: 'fixture',
          display: true,
          content: 'legacy custom',
          timestamp: 1
        }
      },
      {
        type: 'message',
        id: 'assistant',
        parentId: 'custom',
        timestamp: '2026-10-13T00:00:03Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'retained thinking' },
            { type: 'text', text: 'visible' }
          ],
          model: 'fixture',
          provider: 'fixture',
          timestamp: 2
        }
      }
    ]
    const original = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n{"partial"'
    await fs.writeFile(file, original)
    const service = new SessionService(
      {} as never,
      {} as never,
      { invalidate: () => {} } as never,
      { list: async () => [], close: async () => {} }
    )
    service.cachePath('legacy', file)
    const detail = await service.get('legacy')
    expect(detail.context.thinkingLevel).toBe('high')
    expect(JSON.stringify(detail.context.messages)).toContain('retained thinking')
    expect(detail.context.messages).toContainEqual(
      expect.objectContaining({ role: 'custom', content: 'legacy custom' })
    )
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    await service.close()
  })

  it('compacts a real native session while retaining original thinking and restoring its level', async () => {
    const wrapper = await start()
    await run(wrapper.sessionId, {
      tool: 'write',
      args: { path: 'compact.txt', content: 'fixture' }
    })
    for (let index = 0; index < 30; index++)
      wrapper.inner.sessionManager.appendMessage({
        role: 'user',
        content: `history ${index} ` + 'context '.repeat(2000),
        timestamp: Date.now()
      })
    wrapper.inner.refreshContext()
    const result = (await wrapper.send({ type: 'compact' })) as {
      summary: string
      firstKeptEntryId: string
    }
    // Pi appends tracked file operations to the provider's summary.
    expect(result.summary).toBe('completed\n\n<modified-files>\ncompact.txt\n</modified-files>')
    expect(result.firstKeptEntryId).toBeTruthy()
    expect(wrapper.inner.thinkingLevel).toBe('high')
    expect(wrapper.inner.sessionManager.getEntries()).toContainEqual(
      expect.objectContaining({ type: 'compaction', summary: result.summary })
    )
    expect(await fs.readFile(wrapper.inner.sessionFile!, 'utf8')).toContain(
      'native reasoning retained'
    )
  }, 60000)

  it('settles final provider errors as failed rather than successful idle runs', async () => {
    const wrapper = await start()
    const registry = new RunRegistry({
      emit: () => {},
      getBudget: () => ({
        maxTokens: null,
        maxCost: null,
        maxToolCalls: null,
        maxRunDurationMs: null
      }),
      getEntries: async () =>
        wrapper.inner.sessionManager.getEntries().map((entry) => ({ ...entry })),
      getLastAssistantText: async () => '',
      onRunSettled: async () => {}
    })
    runtime.subscribe(wrapper.sessionId, (event) => {
      for (const mapped of mapAgentEvent(event)) registry.handleEvent(wrapper.sessionId, mapped)
    })
    registry.handleEvent(wrapper.sessionId, {
      type: 'prompt.started',
      timestamp: Date.now(),
      message: 'failure fixture'
    })
    replies.push('provider-error-fixture')
    await runtime.prompt(wrapper.sessionId, 'failure fixture')
    await expect
      .poll(async () => (await registry.listRuns(wrapper.sessionId))[0]?.status)
      .toBe('failed')
    const run = (await registry.listRuns(wrapper.sessionId))[0]
    expect(run.error).toContain('fixture final provider failure')
    expect(run.steps.filter((step) => step.kind === 'error')).toHaveLength(1)
    expect(events.findIndex((event) => event.type === 'prompt_error')).toBeLessThan(
      events.findIndex((event) => event.type === 'agent_settled')
    )
  }, 60000)
})
