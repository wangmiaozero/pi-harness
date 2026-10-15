import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const require = createRequire(import.meta.url)
const electronBinary = require('electron') as string
const packagedExecutable = process.env.PI_HARNESS_E2E_EXECUTABLE

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const mainJs = path.join(root, 'out/main/index.js')
const fixturesPi = path.join(root, 'fixtures/mock-pi')
const capabilityFixtures = path.join(root, 'fixtures/capabilities')
const startupProfiles = new WeakMap<ElectronApplication, { started: number; launchMs: number }>()

function isMainRenderer(page: Page): boolean {
  const url = page.url()
  return Boolean(url) && url !== 'about:blank' && !url.includes('overlay.html')
}

async function waitForMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const existing = electronApp.windows().find(isMainRenderer)
    if (existing) return existing
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Pi-Harness main window did not appear')
}

type Fixtures = {
  electronApp: ElectronApplication
  page: Page
  workspaceRoot: string
  testUserData: string
  piAgentDir: string
  startupMetrics: { launchMs: number; readyMs: number }
}

export const test = base.extend<Fixtures>({
  workspaceRoot: async ({}, use) => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-e2e-workspace-'))
    await use(workspaceRoot)
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  },
  testUserData: async ({}, use) => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-e2e-'))
    await use(userData)
    fs.rmSync(userData, { recursive: true, force: true })
  },
  piAgentDir: async ({ testUserData }, use) => {
    const isolatedPi = path.join(testUserData, 'mock-pi')
    fs.cpSync(fixturesPi, isolatedPi, { recursive: true })
    await use(isolatedPi)
  },
  electronApp: async ({ workspaceRoot, testUserData, piAgentDir }, use, testInfo) => {
    void testInfo
    if (!packagedExecutable && !fs.existsSync(mainJs)) {
      throw new Error('out/main/index.js missing — run `pnpm compile` before e2e')
    }
    fs.writeFileSync(
      path.join(testUserData, 'authorized-roots.json'),
      `${JSON.stringify({ roots: [path.join(root, 'fixtures'), workspaceRoot] }, null, 2)}\n`
    )
    const { ELECTRON_RUN_AS_NODE: _runAsNode, ...restEnv } = process.env
    void _runAsNode
    const launchEnvironment = { ...restEnv }
    if (process.env.PI_HARNESS_E2E_EMPTY_PATH === '1') {
      for (const key of Object.keys(launchEnvironment))
        if (key.toLowerCase() === 'path') delete launchEnvironment[key]
      const toolBin = path.join(testUserData, 'system-tools')
      fs.mkdirSync(toolBin)
      const directories = [toolBin]
      if (process.platform === 'win32') {
        const systemDirectory = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
        directories.push(systemDirectory)
        const git = execFileSync(path.join(systemDirectory, 'where.exe'), ['git'], {
          encoding: 'utf8'
        })
          .trim()
          .split(/\r?\n/)[0]
        if (git) directories.push(path.dirname(git))
      } else {
        for (const [name, file] of [
          ['git', '/usr/bin/git'],
          ['sh', '/bin/sh'],
          ['env', '/usr/bin/env']
        ]) {
          if (fs.existsSync(file)) fs.symlinkSync(file, path.join(toolBin, name))
        }
      }
      for (const directory of directories) {
        for (const name of [
          'node',
          'node.exe',
          'node.cmd',
          'npm',
          'npm.cmd',
          'npx',
          'npx.cmd',
          'pi',
          'pi.exe',
          'pi.cmd'
        ]) {
          if (fs.existsSync(path.join(directory, name)))
            throw new Error(`Isolated test PATH unexpectedly contains ${name}`)
        }
      }
      launchEnvironment.PATH = directories.join(path.delimiter)
    }
    const started = performance.now()
    const app = await electron.launch({
      executablePath: packagedExecutable || electronBinary,
      args: packagedExecutable ? [] : [mainJs],
      env: {
        ...launchEnvironment,
        ELECTRON_RUN_AS_NODE: undefined,
        PI_HARNESS_AGENT_MODE: process.env.PI_HARNESS_E2E_AGENT_MODE ?? 'sdk',
        PI_HARNESS_PI_CLI_PATH: path.join(testUserData, 'missing-pi-cli'),
        PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
        PI_CODING_AGENT_DIR: piAgentDir,
        PI_HARNESS_USER_DATA: testUserData,
        PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home'),
        PI_HARNESS_CAPABILITY_FIXTURES_DIR: capabilityFixtures,
        PI_HARNESS_BUILTIN_SKILLS_DIR: path.join(root, 'resources', 'builtin-skills')
      },
      timeout: 60_000
    })
    startupProfiles.set(app, { started, launchMs: performance.now() - started })
    await use(app)
    await app.close().catch(() => undefined)
  },
  page: async ({ electronApp }, use) => {
    const page = await waitForMainWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
    await use(page)
  },
  startupMetrics: async ({ electronApp, page }, use) => {
    void page
    const profile = startupProfiles.get(electronApp)!
    await use({ launchMs: profile.launchMs, readyMs: performance.now() - profile.started })
  }
})

export { expect }
