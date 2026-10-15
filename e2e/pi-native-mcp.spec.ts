import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect } from './fixtures'

test('executes native MCP and Codemode over IPC, enforces workspace writes and closes child processes', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot,
  testUserData
}) => {
  const pidFile = path.join(workspaceRoot, 'mcp.pid')
  const runtimeFile = path.join(workspaceRoot, 'mcp-runtime.txt')
  const script = path.join(workspaceRoot, 'mcp.mjs')
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';import readline from 'node:readline';
    fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
    fs.writeFileSync(${JSON.stringify(runtimeFile)},process.execPath);
    readline.createInterface({input:process.stdin}).on('line',line=>{
      const q=JSON.parse(line);if(q.id===undefined)return;let result;
      if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'local',version:'1'}};
      else if(q.method==='tools/list')result={tools:[{name:'echo',description:'Echo JSON',inputSchema:{type:'object',properties:{value:{}},required:['value']}}]};
      else result={content:[{type:'text',text:'MCP called'}],structuredContent:q.params.arguments.value};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
    });`
  )
  fs.writeFileSync(
    path.join(piAgentDir, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        local: {
          command: 'node',
          args: [script],
          exposure: 'codemode'
        }
      }
    })
  )
  const denied = path.join(testUserData, 'outside-workspace.txt')
  let calls = 0
  const provider = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    JSON.parse(body)
    calls++
    if (calls === 4) {
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error: { message: 'fixture terminal provider failure', type: 'invalid_request_error' }
        })
      )
      return
    }
    const tool = calls === 1 || calls === 3
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'native-mcp-call',
              type: 'function',
              function: {
                name: 'codemode',
                arguments: JSON.stringify({
                  code:
                    calls === 3
                      ? `await tools.write({path:'cancelled.txt',content:'must remain unwritten'})`
                      : `const values=[{ok:true},[1,2],"string",42,true,null];const actual=[]; for(const value of values)actual.push((await tools.mcp__local__echo({value})).structuredContent);if(JSON.stringify(actual)!==JSON.stringify(values))throw new Error('shapes changed');text('native MCP verified');try{await tools.write({path:${JSON.stringify(denied)},content:'blocked'});throw new Error('write should be denied')}catch(e){if(e.message==='write should be denied')throw e;text('workspace guard verified')}await tools.write({path:'native-mcp.txt',content:'Native Pi completed'})`
                })
              }
            }
          ]
        }
      : { role: 'assistant', content: 'Native MCP and guards completed.' }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const part of [
      { delta, finish_reason: null },
      { delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }
    ])
      response.write(
        `data: ${JSON.stringify({
          id: 'local',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, ...part }]
        })}\n\n`
      )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Missing provider')
  fs.writeFileSync(
    path.join(piAgentDir, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          api: 'openai-completions',
          apiKey: 'local-fixture-placeholder',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [
            {
              id: 'fixture',
              name: 'Native MCP fixture',
              reasoning: false,
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 4096
            }
          ]
        }
      }
    })
  )
  try {
    const started = await page.evaluate(
      (cwd) => window.piSwitch.agent.start({ cwd, provider: 'fixture', modelId: 'fixture' }),
      fs.realpathSync(workspaceRoot)
    )
    const tools = await page.evaluate((id) => window.piSwitch.harness.tools(id), started.sessionId)
    expect(tools).toContainEqual(expect.objectContaining({ name: 'codemode', active: true }))
    await page.evaluate(
      (sessionId) => window.piSwitch.agent.prompt({ sessionId, message: 'Run native fixture' }),
      started.sessionId
    )
    await expect.poll(() => fs.existsSync(path.join(workspaceRoot, 'native-mcp.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(workspaceRoot, 'native-mcp.txt'), 'utf8')).toBe(
      'Native Pi completed'
    )
    expect(fs.existsSync(denied)).toBe(false)
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)),
          started.sessionId
        )
      )
      .toBe(false)
    const detail = await page.evaluate((id) => window.piSwitch.sessions.get(id), started.sessionId)
    expect(JSON.stringify(detail.context.messages)).toContain('native MCP verified')
    expect(JSON.stringify(detail.context.messages)).toContain('workspace guard verified')
    expect(calls).toBe(2)
    await page.evaluate(async () => {
      const policy = await window.piSwitch.harness.getPolicy()
      await window.piSwitch.harness.setPolicy({
        ...policy.config,
        files: { ...policy.config.files, write: 'ask' }
      })
    })
    await page.evaluate(
      (sessionId) =>
        window.piSwitch.agent.prompt({ sessionId, message: 'Permission cancellation fixture' }),
      started.sessionId
    )
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.piSwitch.harness
              .timeline(id)
              .then(
                (events) =>
                  events.filter(
                    (event) => event.type === 'tool.started' && event.toolName === 'write'
                  ).length
              ),
          started.sessionId
        )
      )
      .toBe(3)
    await page.evaluate((id) => window.piSwitch.agent.abort(id), started.sessionId)
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)),
          started.sessionId
        )
      )
      .toBe(false)
    expect(fs.existsSync(path.join(workspaceRoot, 'cancelled.txt'))).toBe(false)
    expect(calls).toBe(3)
    await page.evaluate(
      (sessionId) =>
        window.piSwitch.agent.prompt({ sessionId, message: 'Final provider failure fixture' }),
      started.sessionId
    )
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.piSwitch.harness
              .listRuns(id)
              .then(
                (runs) =>
                  runs.find(
                    (run) =>
                      run.source === 'live' && run.prompt === 'Final provider failure fixture'
                  )?.status
              ),
          started.sessionId
        )
      )
      .toBe('failed')
    const failure = await page.evaluate(
      (id) =>
        window.piSwitch.harness
          .listRuns(id)
          .then((runs) =>
            runs.find(
              (run) => run.source === 'live' && run.prompt === 'Final provider failure fixture'
            )!
          ),
      started.sessionId
    )
    expect(failure.error).toContain('fixture terminal provider failure')
    const failureDetail = await page.evaluate(
      ({ sessionId, runId }) => window.piSwitch.harness.getRun(sessionId, runId),
      { sessionId: started.sessionId, runId: failure.id }
    )
    expect(failureDetail.steps.filter((step) => step.kind === 'error')).toHaveLength(1)
    expect(calls).toBe(4)
    if (process.env.PI_HARNESS_E2E_AGENT_MODE === 'rpc') {
      const node = await page.evaluate(() =>
        window.piSwitch.runtimes.diagnostics().then((d) => d.node.executablePath!)
      )
      expect(fs.realpathSync(fs.readFileSync(runtimeFile, 'utf8'))).toBe(fs.realpathSync(node))
    }
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    await electronApp.close()
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
  } finally {
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})
