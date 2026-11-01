import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

test('large macOS workspaces preserve subprocess capacity and file notifications', async ({
  page,
  electronApp,
  workspaceRoot
}) => {
  test.skip(process.platform !== 'darwin', 'macOS FSEvents descriptor regression')
  const assets = path.join(workspaceRoot, 'resources', 'petpacks')
  fs.mkdirSync(assets, { recursive: true })
  for (let i = 0; i < 2048; i++) fs.writeFileSync(path.join(assets, `${i}.webp`), 'fixture')
  const descriptorCount = () =>
    electronApp.evaluate(() => process.getBuiltinModule('fs')!.readdirSync('/dev/fd').length)
  const before = await descriptorCount()
  await page.evaluate(async (root) => {
    await window.piSwitch.workspace.allowRoot(root)
    await window.piSwitch.workspace.sync({ folders: [{ path: root }] })
    const state = window as typeof window & { __fileChanges: number }
    state.__fileChanges = 0
    window.piSwitch.on('workspace-changed', () => {
      state.__fileChanges++
    })
  }, workspaceRoot)
  expect((await descriptorCount()) - before).toBeLessThan(64)
  await electronApp.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        process.getBuiltinModule('child_process')!.execFile('/usr/bin/true', (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
  )
  fs.writeFileSync(path.join(assets, 'added.webp'), 'new asset')
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __fileChanges: number }).__fileChanges)
    )
    .toBeGreaterThan(0)
})
