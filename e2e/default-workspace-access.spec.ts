import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from './fixtures'

// Simulate a scratch directory left by an earlier run, without a persisted grant.
const test = base.extend({
  testUserData: async ({ testUserData }, use) => {
    const root = path.join(testUserData, 'workspaces', 'default')
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, 'scratch-marker.txt'), 'Managed workspace fixture')
    await use(testUserData)
  }
})

test('restores existing managed scratch access before opening Workspace without granting its parent', async ({
  page,
  testUserData
}) => {
  const root = path.join(testUserData, 'workspaces', 'default')
  expect(page.url()).not.toContain('#/workspace')
  expect(await page.evaluate(() => window.piSwitch.workspace.getActive())).toBeNull()
  const files = await page.evaluate(async (root) => {
    // No getDefaultRoot/ensureDefault calls: these used to be the only grant path.
    await Promise.all([
      window.piSwitch.workspace.allowRoot(root),
      window.piSwitch.workspace.allowRoot(root)
    ])
    return window.piSwitch.files.list(root)
  }, root)
  expect(files.some((file) => file.name === 'scratch-marker.txt')).toBe(true)
  const denied = await page.evaluate(async (parent) => {
    try {
      await window.piSwitch.workspace.allowRoot(parent)
      return false
    } catch {
      return true
    }
  }, path.dirname(root))
  expect(denied).toBe(true)
  expect(await page.evaluate(() => window.piSwitch.workspace.getActive())).toBeNull()
  const grants = JSON.parse(
    fs.readFileSync(path.join(testUserData, 'authorized-roots.json'), 'utf8')
  )
  expect(grants.roots).not.toContain(root)
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByTestId('composer-editor')).toBeVisible()
  await page.getByTestId('workspace-toggle-files').click()
  await expect(page.getByTestId('workspace-file-tree')).toHaveCount(0)
  await expect(page.getByText('scratch-marker.txt', { exact: true })).toHaveCount(0)
})
