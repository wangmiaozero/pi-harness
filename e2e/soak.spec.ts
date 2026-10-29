import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect, startFixtureSession } from './fixtures'

// Optional long run: PI_HARNESS_SOAK_CYCLES=100 PI_HARNESS_SOAK_IDLE_MS=30000.
// Samples are observations; growth in a short run is not proof of a memory leak.
test('samples repeated native sessions, MCP and plugin lifecycles through normal shutdown', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  const cycles = Number(process.env.PI_HARNESS_SOAK_CYCLES ?? 3)
  const idleMs = Number(process.env.PI_HARNESS_SOAK_IDLE_MS ?? 1000)
  if (
    !Number.isSafeInteger(cycles) ||
    cycles < 1 ||
    cycles > 500 ||
    !Number.isSafeInteger(idleMs) ||
    idleMs < 0 ||
    idleMs > 60000
  )
    throw new Error('Invalid soak settings')
  test.setTimeout(Math.max(120000, cycles * (idleMs + 30000)))
  let fail = false
  const server = http.createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    if (fail) {
      response.writeHead(503).end('{"error":{"message":"local fixture outage"}}')
      return
    }
    if (!JSON.parse(text).stream) {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish_reason] of [
      [{ role: 'assistant', content: 'Soak fixture reply' }, null],
      [{}, 'stop']
    ])
      response.write(
        `data: ${JSON.stringify({ id: 'soak', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const pidFile = path.join(workspaceRoot, 'soak-mcp-pids.txt')
  const script = path.join(workspaceRoot, 'soak-mcp.mjs')
  await fs.writeFile(
    script,
    `import fs from 'node:fs';import readline from 'node:readline';fs.appendFileSync(${JSON.stringify(pidFile)},process.pid+'\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;const result=q.method==='initialize'?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'soak',version:'1'}}:q.method==='tools/list'?{tools:[]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n')});`
  )
  await fs.writeFile(
    path.join(piAgentDir, 'mcp.json'),
    JSON.stringify({ mcpServers: { soak: { command: process.execPath, args: [script] } } })
  )
  await fs.writeFile(
    path.join(piAgentDir, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          api: 'openai-completions',
          apiKey: 'synthetic-soak-placeholder',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          models: [{ id: 'fixture', input: ['text'], contextWindow: 128000, maxTokens: 4096 }]
        }
      }
    })
  )
  await electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, path.resolve('examples/harness-plugins/run-metrics'))
  const plugin = await page.evaluate(() => window.piSwitch.harnessPlugins.installLocal())
  expect(plugin).not.toBeNull()
  const observations: unknown[] = []
  const descendants = new Set<number>()
  const sample = async (phase: string) => {
    const app = await electronApp.evaluate(async ({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().includes('overlay.html')
      )!
      const contents = window.webContents
      contents.debugger.attach('1.3')
      try {
        await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
        return {
          processes: app.getAppMetrics(),
          heap: await contents.debugger.sendCommand('Runtime.getHeapUsage'),
          listeners: {
            beforeQuit: app.listenerCount('before-quit'),
            webContentsCreated: app.listenerCount('web-contents-created')
          }
        }
      } finally {
        contents.debugger.detach()
      }
    })
    let native: unknown = null
    if (process.platform !== 'win32') {
      const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=,rss=,pcpu='])
      const rows = stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [pid, ppid, rssKiB, cpuPercent] = line.trim().split(/\s+/).map(Number)
          return { pid, ppid, rssKiB, cpuPercent }
        })
      const owned = new Set([electronApp.process().pid!])
      for (let depth = 0; depth < 10; depth++)
        for (const row of rows) if (owned.has(row.ppid)) owned.add(row.pid)
      native = rows.filter((row) => owned.has(row.pid))
      for (const pid of owned) if (pid !== electronApp.process().pid) descendants.add(pid)
    }
    observations.push({ phase, at: new Date().toISOString(), ...app, native })
  }
  try {
    await sample('ready')
    for (let cycle = 0; cycle < cycles; cycle++) {
      await page.evaluate(
        (id) => window.piSwitch.harnessPlugins.setEnabled(id, true),
        plugin!.manifest.id
      )
      fail = true
      expect(
        (
          await page.evaluate(() =>
            window.piSwitch.providers.testConnection({ providerKey: 'fixture', modelId: 'fixture' })
          )
        ).ok
      ).toBe(false)
      fail = false
      const probe = await page.evaluate(() =>
        window.piSwitch.providers.testConnection({ providerKey: 'fixture', modelId: 'fixture' })
      )
      expect(probe, JSON.stringify(probe)).toMatchObject({ ok: true })
      const { sessionId } = await startFixtureSession(page, {
        cwd: workspaceRoot,
        provider: 'fixture',
        modelId: 'fixture'
      })
      await page.evaluate(
        (sessionId) =>
          window.piSwitch.agent.prompt({ sessionId, message: 'Short local soak turn' }),
        sessionId
      )
      await expect
        .poll(() =>
          page.evaluate(
            (id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)),
            sessionId
          )
        )
        .toBe(false)
      await sample(`active-${cycle}`)
      await page.evaluate((id) => window.piSwitch.sessions.delete(id), sessionId)
      await page.evaluate(
        (id) => window.piSwitch.harnessPlugins.setEnabled(id, false),
        plugin!.manifest.id
      )
      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(
          (window) => !window.webContents.getURL().includes('overlay.html')
        )!
        window.hide()
        window.showInactive()
      })
      if (idleMs) await page.waitForTimeout(idleMs) // Deliberate idle sampling interval, not synchronization.
      await sample(`released-${cycle}`)
    }
    const mcpPids = (await fs.readFile(pidFile, 'utf8')).trim().split('\n').map(Number)
    expect(mcpPids.length).toBeGreaterThanOrEqual(cycles)
    for (const pid of mcpPids)
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0)
            return true
          } catch {
            return false
          }
        })
        .toBe(false)
    await electronApp.close()
    for (const pid of descendants)
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0)
            return true
          } catch {
            return false
          }
        })
        .toBe(false)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const directory = process.env.PI_HARNESS_PERF_OUTPUT ?? 'out/quality'
    await fs.mkdir(directory, { recursive: true })
    const output = path.join(directory, `soak-${Date.now()}.json`)
    await fs.writeFile(
      output,
      JSON.stringify(
        {
          environment: {
            platform: process.platform,
            arch: process.arch,
            os: os.release(),
            node: process.version
          },
          cycles,
          idleMs,
          observations,
          scope:
            'Short lifecycle sampling with forced GC; file descriptor counts and physical DPI are not measured; no long-term leak-free claim.'
        },
        null,
        2
      )
    )
    await testInfo.attach('soak observations', { path: output, contentType: 'application/json' })
  }
})
