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

type Fixtures = {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<Fixtures>({
  electronApp: async ({}, use, testInfo) => {
    void testInfo
    if (!fs.existsSync(mainJs)) {
      throw new Error('out/main/index.js missing — run `pnpm compile` before e2e')
    }
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-e2e-'))
    const { ELECTRON_RUN_AS_NODE: _runAsNode, ...restEnv } = process.env
    void _runAsNode
    const app = await electron.launch({
      executablePath: electronBinary,
      args: [mainJs],
      env: {
        ...restEnv,
        ELECTRON_RUN_AS_NODE: undefined,
        PI_SWITCH_PI_CONFIG_DIR: fixturesPi,
        PI_SWITCH_USER_DATA: userData
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
