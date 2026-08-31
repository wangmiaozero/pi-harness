import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './fixtures'

test('role suites share canonical skills and preserve unrelated installations when removed', async ({
  page,
  piAgentDir
}) => {
  await page.locator('a[href="#/skills"]').click()
  await page.getByRole('tab', { name: /市场|Market/ }).click()
  const collection = (id: string) => page.getByTestId(`market-collection-builtin:${id}`)
  for (const [id, title] of [
    ['ui-designer', 'UI 设计师 Skill套件'],
    ['frontend-engineer', '前端工程师 Skill套件'],
    ['backend-engineer', '后端工程师 Skill套件'],
    ['product-engineer', '产品工程师 Skill套件']
  ]) {
    await expect(collection(id)).toContainText(title)
  }
  await expect(collection('emilkowalski-skills')).toContainText(
    'Skills For Designers and Engineers'
  )
  await expect(collection('emilkowalski-skills')).toContainText('0/12')

  await collection('backend-engineer').click()
  const tdd = page.getByTestId('builtin-skill-tdd')
  await tdd.getByRole('button', { name: /安装|Install/, exact: true }).click()
  await expect(collection('backend-engineer')).toContainText('1/7')
  await expect(collection('frontend-engineer')).toContainText('1/7')
  await expect(collection('mattpocock-skills')).toContainText('1/29')

  await collection('ui-designer').click()
  await page.getByRole('button', { name: /全部安装|Install all/, exact: true }).click()
  await expect(collection('ui-designer')).toContainText('6/6', { timeout: 45_000 })
  await expect(collection('frontend-engineer')).toContainText('3/7')
  await expect(collection('product-engineer')).toContainText('1/6')
  await expect(collection('emilkowalski-skills')).toContainText('6/12')
  expect(
    await fs.readFile(path.join(piAgentDir, 'skills', 'prototype', 'PICKER.md'), 'utf8')
  ).toContain('#')

  if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => window.piSwitch.settings.set({ theme: 'pink' }))
    await page.screenshot({
      path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'skill-suites.png')
    })
  }

  await page.getByRole('button', { name: /全部卸载|Uninstall all/, exact: true }).click()
  const confirmation = page.getByRole('dialog')
  await expect(confirmation).toContainText(/其他套件|other suites/)
  await confirmation.getByRole('button', { name: /全部卸载|Uninstall all/ }).click()
  await expect(collection('ui-designer')).toContainText('0/6', { timeout: 45_000 })
  await expect(collection('frontend-engineer')).toContainText('1/7')
  await expect(collection('backend-engineer')).toContainText('1/7')
  await expect(collection('emilkowalski-skills')).toContainText('0/12')
  expect(await fs.readFile(path.join(piAgentDir, 'skills', 'tdd', 'tests.md'), 'utf8')).toContain(
    '#'
  )
})
