import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { test, expect } from './fixtures'

const hash = (text: string | null) =>
  createHash('sha256')
    .update(text === null ? 'missing' : `text:${text}`)
    .digest('hex')
test('detects an interrupted restore on reload and continues only after confirmation', async ({
  page,
  piAgentDir,
  testUserData
}) => {
  const backup = await page.evaluate(() => window.piSwitch.backup.create('manual'))
  const files = []
  for (const name of ['models.json', 'settings.json']) {
    const before = await fs.readFile(path.join(piAgentDir, name), 'utf8')
    const after = JSON.stringify({ ...JSON.parse(before), recoveryFixture: 2 })
    files.push({ name, before, after, beforeHash: hash(before), afterHash: hash(after) })
  }
  const journal = path.join(testUserData, 'backups', `restore-${hash(piAgentDir)}.json`)
  await fs.writeFile(
    journal,
    JSON.stringify({
      version: 1,
      id: backup.id,
      directory: piAgentDir,
      status: 'committing',
      files
    })
  )
  await fs.writeFile(path.join(piAgentDir, files[0].name), files[0].after)
  const damaged = path.join(testUserData, 'backups', '1793250000000-ffffffff')
  await fs.mkdir(damaged)
  await fs.writeFile(path.join(damaged, 'manifest.json'), '{partial')
  await page.reload()
  await page.evaluate(() => {
    window.location.hash = '/settings/backup'
  })
  await expect(
    page.getByRole('alert').filter({ hasText: /上次恢复未完成|previous restore/i })
  ).toBeVisible()
  // Ordinary native configuration mutations cannot continue against a mixed version.
  const error = await page.evaluate(async () => {
    try {
      await window.piSwitch.config.writeRaw('settings', '{}', { overwrite: true })
      return null
    } catch (error) {
      return (error as { message: string }).message
    }
  })
  expect(error).toContain('unfinished')
  expect(await fs.readFile(path.join(piAgentDir, 'settings.json'), 'utf8')).toBe(files[1].before)
  const row = page
    .locator('li')
    .filter({ has: page.getByText('恢复', { exact: true }) })
    .first()
  await row.getByRole('button', { name: /恢复|Restore/, exact: true }).click()
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /恢复|Restore/ }).click()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(piAgentDir, 'settings.json'), 'utf8'))
          .recoveryFixture
    )
    .toBe(2)
  await expect(
    page.getByRole('alert').filter({ hasText: /上次恢复未完成|previous restore/i })
  ).toHaveCount(0)
  await expect(fs.stat(journal)).rejects.toMatchObject({ code: 'ENOENT' })
})
