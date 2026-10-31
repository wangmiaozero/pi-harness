import { test, expect } from './fixtures'

test('creates independent conversations in the default group and preserves empty chats after reload', async ({
  page
}) => {
  await page.locator('a[href="#/workspace"]').click()
  const add = page.getByTestId('workspace-new-session')
  await expect(
    page
      .getByTestId('workspace-sessions-heading')
      .locator('..')
      .getByTestId('workspace-new-session')
  ).toBeVisible()
  await expect(
    page.getByTestId('workspace-command-actions').getByTestId('workspace-new-session')
  ).toHaveCount(0)
  const before = await page.evaluate(async () =>
    (await window.piSwitch.sessions.list(true)).map((s) => s.id)
  )
  for (let i = 0; i < 12; i++) await add.click()
  await expect(add).toBeEnabled()
  const created = await page.evaluate(
    async (ids) => (await window.piSwitch.sessions.list(true)).filter((s) => !ids.includes(s.id)),
    before
  )
  expect(created).toHaveLength(12)
  expect(new Set(created.map((s) => s.id)).size).toBe(12)
  const roots = await page.evaluate(() => window.piSwitch.workspace.getDefaultRoots())
  expect(created.every((s) => roots.includes(s.cwd) && s.messageCount === 0)).toBe(true)
  for (const session of created)
    await expect(page.getByTestId(`session-row-${session.id}`)).toBeVisible()
  await page.reload()
  for (const session of created)
    await expect(page.getByTestId(`session-row-${session.id}`)).toBeVisible()
  await page.getByTestId(`session-row-${created[0].id}`).getByRole('button').first().click()
  await expect(page.getByTestId('composer-editor')).toBeVisible()
})

test('supports native mouse selection and scrolling in a multiline composer', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  const input = page.getByTestId('composer-editor')
  const text = '0123456789 abcdefghijklmnopqrstuvwxyz'
  await input.fill(text)
  await page.getByTestId('workspace-sessions-heading').click()
  const points = await input.evaluate((element) => {
    const node = element.firstChild!
    return [2, 16].map((offset) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.collapse(true)
      const box = range.getBoundingClientRect()
      return { x: box.x, y: box.y + box.height / 2 }
    })
  })
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 15 })
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(text.slice(2, 16))

  const multiline = Array.from(
    { length: 80 },
    (_, i) => `Line ${i}: editable conversation draft`
  ).join('\n')
  await input.fill(multiline)
  const scroll = page.getByTestId('composer-text-scroll')
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  const bottom = await scroll.evaluate((el) => el.scrollTop)
  await scroll.hover()
  await page.mouse.wheel(0, -500)
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeLessThan(bottom)
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(multiline)
  await input.press('Backspace')
  await expect(input).toHaveText('')
})

test('restores and focuses the console on Dock and second-instance activation', async ({
  page,
  electronApp
}) => {
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByTestId('chat-composer')).toBeVisible()
  for (const event of ['activate', 'second-instance']) {
    await electronApp.evaluate(({ app, BrowserWindow }, event) => {
      const main = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/index.html')
      )!
      main.hide()
      app.emit(event)
    }, event)
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => {
          const main = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('/index.html')
          )!
          return {
            visible: main.isVisible(),
            minimized: main.isMinimized(),
            focused: main.isFocused()
          }
        })
      )
      .toEqual({ visible: true, minimized: false, focused: true })
  }
})
