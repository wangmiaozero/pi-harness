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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const mainJs = path.join(root, 'out/main/index.js')
const fixturesPi = path.join(root, 'fixtures/mock-pi')
const capabilityFixtures = path.join(root, 'fixtures/capabilities')

type Fixtures = {
  electronApp: ElectronApplication
  page: Page
  workspaceRoot: string
}

export const test = base.extend<Fixtures>({
  workspaceRoot: async ({}, use) => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-e2e-workspace-'))
    await use(workspaceRoot)
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  },
  electronApp: async ({ workspaceRoot }, use, testInfo) => {
    void testInfo
    if (!fs.existsSync(mainJs)) {
      throw new Error('out/main/index.js missing — run `pnpm compile` before e2e')
    }
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-e2e-'))
    const isolatedPi = path.join(userData, 'mock-pi')
    fs.cpSync(fixturesPi, isolatedPi, { recursive: true })
    fs.writeFileSync(
      path.join(userData, 'authorized-roots.json'),
      `${JSON.stringify({ roots: [path.join(root, 'fixtures'), workspaceRoot] }, null, 2)}\n`
    )
    const { ELECTRON_RUN_AS_NODE: _runAsNode, ...restEnv } = process.env
    void _runAsNode
    const app = await electron.launch({
      executablePath: electronBinary,
      args: [mainJs],
      env: {
        ...restEnv,
        ELECTRON_RUN_AS_NODE: undefined,
        PI_HARNESS_PI_CLI_PATH: path.join(userData, 'missing-pi-cli'),
        PI_HARNESS_PI_CONFIG_DIR: isolatedPi,
        PI_CODING_AGENT_DIR: isolatedPi,
        PI_HARNESS_USER_DATA: userData,
        PI_HARNESS_CAPABILITY_FIXTURES_DIR: capabilityFixtures,
        PI_HARNESS_BUILTIN_SKILLS_DIR: path.join(root, 'resources', 'builtin-skills')
      },
      timeout: 60_000
    })
    await use(app)
    await app.close().catch(() => undefined)
    fs.rmSync(userData, { recursive: true, force: true })
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

export { expect }
