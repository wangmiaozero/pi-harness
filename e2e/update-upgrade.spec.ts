import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stageAppImage } from '../src/main/updater/appimage-transaction.mjs'
import { verifiedManifest, selectInstaller } from '../src/main/updater/security/manifest.mjs'
import { _electron as electron, type Page } from '@playwright/test'
import { test, expect, startFixtureSession } from './fixtures'

test('verifies, cancels, resumes and manually upgrades a real installed package without losing data', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot,
  testUserData
}) => {
  test.setTimeout(180_000)
  const nextExecutable = process.env.PI_HARNESS_UPDATE_TEST_NEW_EXECUTABLE
  test.skip(!nextExecutable, 'Native old/new packages are supplied by release:test-upgrade')
  const fixtureUrl = process.env.PI_HARNESS_UPDATE_FIXTURE_URL!
  const fromVersion = process.env.PI_HARNESS_UPDATE_TEST_FROM!
  const toVersion = process.env.PI_HARNESS_UPDATE_TEST_TO!
  let squirrel: unknown = { status: 'NOT_VERIFIED' }
  await electronApp.evaluate(({ net, shell }, base) => {
    const fetch = net.fetch.bind(net)
    net.fetch = async (input, init) => {
      const url = String(input)
      const isApi = url === 'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest'
      const isAsset = url.startsWith(
        'https://github.com/wangmiaozero/pi-harness/releases/download/'
      )
      if (!isApi && !isAsset) return fetch(input, init)
      const file = isApi ? 'latest.json' : new URL(url).pathname.split('/').pop()!
      const response = await fetch(`${base}/${file}`, init)
      return new Response(response.body, { status: response.status, headers: response.headers })
    }
    shell.showItemInFolder = (file) => {
      ;(globalThis as unknown as { verifiedInstaller: string }).verifiedInstaller = file
    }
  }, fixtureUrl)
  await page.evaluate(() =>
    window.piSwitch.updater.preferences({ autoCheck: false, autoDownload: false })
  )
  expect(await page.evaluate(() => window.piSwitch.updater.check())).toMatchObject({
    currentVersion: fromVersion,
    latestVersion: toVersion,
    status: 'available',
    signature: 'verified',
    canInstall: false
  })
  await page.evaluate(() => {
    void window.piSwitch.updater.download()
  })
  await expect
    .poll(() => page.evaluate(() => window.piSwitch.updater.state().then((s) => s.bytesReceived)))
    .toBeGreaterThan(1024)
  expect(await page.evaluate(() => window.piSwitch.updater.cancel())).toMatchObject({
    status: 'available',
    canResume: true,
    downloaded: false
  })
  expect(await page.evaluate(() => window.piSwitch.updater.retry())).toMatchObject({
    status: 'manual_fallback',
    downloaded: true,
    signature: 'verified',
    integrity: 'verified',
    canInstall: false
  })
  await page.evaluate(() => window.piSwitch.updater.reveal())
  const downloaded = await electronApp.evaluate(
    () => (globalThis as unknown as { verifiedInstaller: string }).verifiedInstaller
  )
  const installer = process.env.PI_HARNESS_UPDATE_TEST_NEW_INSTALLER!
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  expect(hash(downloaded)).toBe(hash(installer))
  if (process.platform === 'darwin') {
    expect(
      execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', downloaded], {
        encoding: 'utf8'
      })
    ).toMatch(/^0083;/)
    squirrel = await electronApp.evaluate(async ({ autoUpdater }, base) => {
      return new Promise((resolve) => {
        const timer = setTimeout(
          () => resolve({ status: 'NOT_VERIFIED', reason: 'Native Squirrel probe timed out' }),
          25_000
        )
        autoUpdater.once('error', (error) => {
          clearTimeout(timer)
          resolve({ status: 'MANUAL_ONLY', error: error.message })
        })
        autoUpdater.once('update-downloaded', () => {
          clearTimeout(timer)
          resolve({
            status: 'NOT_VERIFIED',
            reason: 'Download alone does not verify installation/restart'
          })
        })
        try {
          autoUpdater.setFeedURL({ url: `${base}/squirrel` })
          autoUpdater.checkForUpdates()
        } catch (error) {
          clearTimeout(timer)
          resolve({ status: 'MANUAL_ONLY', error: (error as Error).message })
        }
      })
    }, fixtureUrl)
  }
  const canary = path.join(workspaceRoot, 'upgrade-retention.txt')
  fs.writeFileSync(canary, 'Workspace retained across the real installer upgrade')
  let requests = 0
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the local fixture request. */
    }
    requests++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish_reason] of [
      [{ role: 'assistant', content: `Persistent reply ${requests}` }, null],
      [{}, 'stop']
    ])
      response.write(
        `data: ${JSON.stringify({ id: 'session-test', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address() as { port: number }
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
              name: 'Persistence fixture',
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 4096
            }
          ]
        }
      }
    })
  )
  let restarted: Awaited<ReturnType<typeof electron.launch>> | undefined
  const settled = async (target: Page, id: string, count: number) => {
    await expect.poll(() => requests).toBe(count)
    await expect
      .poll(() =>
        target.evaluate(
          (sessionId) => window.piSwitch.agent.running().then((ids) => ids.includes(sessionId)),
          id
        )
      )
      .toBe(false)
    // SDK sessions write lazily; refresh the persisted index after the turn ends.
    await expect
      .poll(() =>
        target.evaluate(
          (sessionId) =>
            window.piSwitch.sessions
              .list(true)
              .then((items) => items.some((item) => item.id === sessionId)),
          id
        )
      )
      .toBe(true)
  }
  try {
    await page.evaluate(async () => {
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    const { sessionId } = await startFixtureSession(page, {
      cwd: workspaceRoot,
      provider: 'fixture',
      modelId: 'fixture'
    })
    await page.evaluate(
      (id) =>
        window.piSwitch.agent.prompt({
          sessionId: id,
          message: 'Persist across application restart'
        }),
      sessionId
    )
    await settled(page, sessionId, 1)
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.piSwitch.sessions
              .get(id)
              .then((detail) => JSON.stringify(detail.context.messages)),
          sessionId
        )
      )
      .toContain('Persistent reply 1')
    const launch = await electronApp.evaluate(() => ({
      executablePath: process.execPath,
      env: { ...process.env }
    }))
    const modelsBefore = fs.readFileSync(path.join(piAgentDir, 'models.json'), 'utf8')
    const retainedPaths = [
      path.join(piAgentDir, 'settings.json'),
      path.join(piAgentDir, 'skills/demo-skill/SKILL.md'),
      path.join(testUserData, 'settings.json')
    ]
    const retainedBytes = retainedPaths.map((file) => fs.readFileSync(file))
    await electronApp.close()
    let newExecutable = nextExecutable!
    const restartEnvironment = { ...launch.env }
    if (process.platform === 'darwin') {
      const currentApp = path.resolve(launch.executablePath, '../../..')
      const newApp = path.resolve(newExecutable, '../../..')
      const backup = currentApp + '.previous'
      fs.renameSync(currentApp, backup)
      try {
        fs.renameSync(newApp, currentApp)
      } catch (error) {
        fs.renameSync(backup, currentApp)
        throw error
      }
      newExecutable = launch.executablePath
    } else if (process.platform === 'win32') {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath $env:PI_HARNESS_VALIDATION_INSTALLER -ArgumentList @('/S','/currentuser',('/D='+$env:PI_HARNESS_VALIDATION_TARGET)) -Wait -PassThru; exit $p.ExitCode"
        ],
        {
          timeout: 300_000,
          env: {
            ...process.env,
            PI_HARNESS_VALIDATION_INSTALLER: installer,
            PI_HARNESS_VALIDATION_TARGET: path.dirname(launch.executablePath)
          }
        }
      )
      newExecutable = launch.executablePath
    } else if (process.platform === 'linux') {
      const bytes = Buffer.from(await (await fetch(`${fixtureUrl}/checksums.json`)).arrayBuffer())
      const signature = Buffer.from(
        await (await fetch(`${fixtureUrl}/checksums.json.sig`)).arrayBuffer()
      )
      const trust = JSON.parse(
        fs.readFileSync(process.env.PI_HARNESS_UPDATE_TEST_TRUST_FILE!, 'utf8')
      )
      const manifest = verifiedManifest(bytes, signature, trust, toVersion)
      const candidate = {
        version: toVersion,
        manifest,
        bytes,
        signature,
        installer: selectInstaller(
          manifest,
          'linux',
          process.arch,
          process.env.PI_HARNESS_E2E_VARIANT!
        )
      }
      // execPath belongs to the mounted/extracted image and disappears on exit.
      // Replace and relaunch the outer container, as the production adapter does.
      const appImage = launch.env.APPIMAGE
      if (!appImage) throw new Error('The installed app did not identify its AppImage container')
      expect(appImage).toBe(fs.realpathSync(process.env.PI_HARNESS_E2E_EXECUTABLE!))
      const previousHash = hash(appImage)
      const replacement = await stageAppImage(appImage, downloaded, candidate)
      expect(hash(replacement.backup)).toBe(previousHash)
      expect(hash(replacement.target)).toBe(hash(installer))
      newExecutable = replacement.target
      // Let the new container establish its own extraction directory and identity.
      for (const name of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD']) delete restartEnvironment[name]
    }
    restarted = await electron.launch({
      ...launch,
      env: restartEnvironment,
      executablePath: newExecutable,
      args: process.env.PI_HARNESS_E2E_EXECUTABLE ? [] : [path.resolve('out/main/index.js')]
    })
    const reopened = await restarted.firstWindow()
    await reopened.waitForLoadState('domcontentloaded')
    expect(await restarted.evaluate(({ app }) => app.getVersion())).toBe(toVersion)
    // This IPC request awaits the real startup health operation, including full
    // runtime integrity checks. It is not a renderer-animation polling deadline.
    // The existing overall native-upgrade test deadline still applies.
    expect(await reopened.evaluate(() => window.piSwitch.updater.state())).toMatchObject({
      currentVersion: toVersion,
      status: 'completed',
      canInstall: false
    })
    expect(fs.readFileSync(path.join(piAgentDir, 'models.json'), 'utf8')).toBe(modelsBefore)
    retainedPaths.forEach((file, index) =>
      expect(fs.readFileSync(file)).toEqual(retainedBytes[index])
    )
    expect(fs.readFileSync(canary, 'utf8')).toBe(
      'Workspace retained across the real installer upgrade'
    )
    expect(await restarted.evaluate(({ app }) => app.getPath('userData'))).toBe(testUserData)
    await reopened.evaluate(() => window.piSwitch.sessions.list(true))
    const restored = await reopened.evaluate((id) => window.piSwitch.sessions.get(id), sessionId)
    expect(JSON.stringify(restored.context.messages)).toContain(
      'Persist across application restart'
    )
    await reopened.evaluate((id) => window.piSwitch.agent.start({ sessionId: id }), sessionId)
    await reopened.evaluate(
      (id) => window.piSwitch.agent.prompt({ sessionId: id, message: 'Continue after restart' }),
      sessionId
    )
    await settled(reopened, sessionId, 2)
    await expect
      .poll(() =>
        reopened.evaluate(
          (id) =>
            window.piSwitch.sessions
              .get(id)
              .then((detail) => JSON.stringify(detail.context.messages)),
          sessionId
        )
      )
      .toContain('Persistent reply 2')
    expect(requests).toBe(2)
    const result = {
      native: true,
      fromVersion,
      toVersion,
      variant: process.env.PI_HARNESS_E2E_VARIANT,
      signature: 'PASS',
      integrity: 'PASS',
      download: 'PASS',
      cancel: 'PASS',
      resume: 'PASS',
      manualUpgrade: 'PASS',
      restart: 'PASS',
      data: 'PASS',
      runtimes: 'PASS',
      autoInstall: 'NOT_VERIFIED',
      squirrel,
      gatekeeper: 'NOT_VERIFIED',
      smartScreen: 'NOT_VERIFIED'
    }
    fs.writeFileSync(
      process.env.PI_HARNESS_UPDATE_TEST_RESULT!,
      JSON.stringify(result, null, 2) + '\n'
    )
  } finally {
    await restarted?.close()
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})
