import { test, expect } from './fixtures'
import fs from 'node:fs/promises'
import path from 'node:path'

test.describe('Environment', () => {
  test('detects shell-selected Node despite a stale GUI PATH and refreshes after switching', async ({
    page,
    electronApp,
    testUserData
  }) => {
    test.skip(
      process.platform === 'win32',
      'Unix login-shell fixture; native Windows probes run in Vitest'
    )
    const shell = path.join(testUserData, 'node manager shell')
    await fs.writeFile(
      shell,
      [
        '#!/bin/sh',
        '[ "$1" = "-ilc" ] || exit 23',
        'export PATH="$PI_HARNESS_TEST_MANAGER_BIN:/usr/bin:/bin"',
        'node() { "$PI_HARNESS_TEST_NODE_BINARY" "$@"; }',
        'eval "$2"'
      ].join('\n')
    )
    await fs.chmod(shell, 0o755)
    const previous = await electronApp.evaluate(
      (_, config) => {
        const previous = { shell: process.env.SHELL, path: process.env.PATH }
        process.env.SHELL = config.shell
        process.env.PATH = '/usr/bin:/bin'
        process.env.PI_HARNESS_TEST_NODE_BINARY = config.node
        return previous
      },
      { shell, node: process.execPath }
    )
    try {
      for (const manager of ['manager one', 'manager two']) {
        const bin = path.join(testUserData, manager, 'bin')
        await electronApp.evaluate((_, bin) => {
          process.env.PI_HARNESS_TEST_MANAGER_BIN = bin
        }, bin)
        const environment = await page.evaluate(() => window.piSwitch.pi.detect())
        expect(environment.nodeRuntime).toMatchObject({
          nodePath: process.execPath,
          nodeVersion: process.version,
          nodeSupported: true,
          nodeSource: 'login-shell',
          ready: true
        })
        expect(environment.nodeRuntime.resolvedPath?.split(path.delimiter).slice(0, 2)).toEqual([
          path.dirname(process.execPath),
          bin
        ])
      }
      expect(await page.evaluate(() => window.piSwitch.pi.getInstallTask())).toBeNull()
    } finally {
      await electronApp.evaluate((_, previous) => {
        if (previous.shell === undefined) delete process.env.SHELL
        else process.env.SHELL = previous.shell
        if (previous.path === undefined) delete process.env.PATH
        else process.env.PATH = previous.path
        delete process.env.PI_HARNESS_TEST_NODE_BINARY
        delete process.env.PI_HARNESS_TEST_MANAGER_BIN
      }, previous)
    }
  })

  test('opens the install confirmation when Pi is missing', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /一键安装|安装 Pi|Install Pi/ }).click()

    await page.waitForTimeout(250)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(/安装 Pi|Install Pi/)
  })
})
