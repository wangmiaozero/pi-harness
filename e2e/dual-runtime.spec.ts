import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { test, expect } from './fixtures'

test.skip(
  process.env.PI_HARNESS_E2E_AGENT_MODE !== 'rpc',
  'The standalone suite runs with verified bundled runtime resources'
)

test('shows independent runtimes in existing settings and rejects invalid selections', async ({
  page,
  testUserData
}) => {
  const info = await page.evaluate(() => window.piSwitch.runtimes.diagnostics())
  expect(info.configuration).toEqual({ pi: { source: 'bundled' }, node: { source: 'bundled' } })
  const rejected = await page.evaluate(async (customPath) => {
    try {
      await window.piSwitch.runtimes.switch('pi', { source: 'custom', customPath })
      return null
    } catch (error) {
      return (error as { code: string }).code
    }
  }, info.pi.executablePath!)
  expect(rejected).toBe('SECURITY_ERROR')
  expect(info.pi).toMatchObject({ valid: true, version: '1.2.0', integrity: 'verified' })
  expect(info.node).toMatchObject({
    valid: true,
    version: '24.22.0',
    npm: { version: '11.19.1' },
    npx: { version: '11.19.1' }
  })
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-paths').click()
  await expect(page.getByTestId('runtime-settings')).toBeVisible()
  await expect(page.getByTestId('runtime-pi')).toContainText('1.2.0')
  await expect(page.getByTestId('runtime-node')).toContainText('24.22.0')
  const error = await page.evaluate(
    async (file) => {
      try {
        await window.piSwitch.runtimes.switch('pi', { source: 'custom', customPath: file })
        return null
      } catch (error) {
        return error
      }
    },
    path.join(testUserData, 'missing executable 空格')
  )
  expect(error).toBeTruthy()
  expect(
    (await page.evaluate(() => window.piSwitch.runtimes.diagnostics())).configuration.pi.source
  ).toBe('bundled')
})

test('preserves independent custom Node selection after the application restarts', async ({
  page,
  electronApp,
  testUserData,
  piAgentDir
}) => {
  const nodePath = await page.evaluate(() =>
    window.piSwitch.runtimes.diagnostics().then((d) => d.node.executablePath!)
  )
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, nodePath)
  const approved = await page.evaluate(() => window.piSwitch.runtimes.pick('node'))
  expect(approved).toBe(nodePath)
  await page.evaluate(
    (customPath) => window.piSwitch.runtimes.switch('node', { source: 'custom', customPath }),
    approved!
  )
  const stateFile = path.join(testUserData, 'runtime-configuration.json')
  expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).configuration.pi.source).toBe('bundled')
  const executablePath = await electronApp.evaluate(() => process.execPath)
  const launchEnvironment = await electronApp.evaluate(() => ({ ...process.env }))
  await electronApp.close()
  const app = await electron.launch({
    executablePath,
    args: process.env.PI_HARNESS_E2E_EXECUTABLE ? [] : [path.resolve('out/main/index.js')],
    env: {
      ...launchEnvironment,
      ELECTRON_RUN_AS_NODE: undefined,
      PI_HARNESS_AGENT_MODE: 'rpc',
      PI_HARNESS_USER_DATA: testUserData,
      PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
      PI_CODING_AGENT_DIR: piAgentDir,
      PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home')
    }
  })
  try {
    const reopened = await app.firstWindow()
    await reopened.waitForLoadState('domcontentloaded')
    const restored = await reopened.evaluate(() => window.piSwitch.runtimes.diagnostics())
    expect(restored.configuration.node).toEqual({ source: 'custom', customPath: nodePath })
    expect(restored.configuration.pi.source).toBe('bundled')
    expect(restored.node.valid).toBe(true)
    expect(restored.pi.valid).toBe(true)
  } finally {
    await app.close()
  }
})
