import { test, expect } from './fixtures'

test.use({ petPacks: true })

test('each jelly shape is one desktop pet', async ({ page, electronApp }) => {
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  const names = await page.evaluate(() => window.piSwitch.pets.list().then((packs) => packs.map((pack) => pack.name)))
  expect(names).toEqual(expect.arrayContaining(['圆形', '方圆', '软糖', '三角', '星星', '幽灵']))
  expect(names).not.toContain('果冻伙伴')
  await page.evaluate((desktopPet) => window.piSwitch.settings.set({ language: 'zh-CN', desktopPet }), {
    ...settings.desktopPet,
    enabled: true,
    activePackId: 'tibot-star',
    size: 160,
    tibot: { ...settings.desktopPet.tibot, color: '#ff781b' }
  })
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  const pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  await expect(pet.locator('#app canvas')).toHaveCount(1)
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((item) =>
          item.webContents.getURL().includes('/pet.html')
        )
        if (!window) return null
        const [width, height] = window.getSize()
        return { width, height }
      })
    )
    .toEqual({ width: 280, height: 235 })

  await page.locator('a[href="#/settings/desktop-pet"]').click()
  const studio = page.getByTestId('tibot-pet-settings')
  await expect(studio.getByRole('button', { name: '圆形' })).toHaveCount(0)
  await expect(studio.getByText('小伙伴')).toHaveCount(0)
  await expect(studio.getByRole('slider', { name: '活跃程度' })).toBeVisible()
  await expect(studio.getByRole('switch', { name: '自动表演' })).toBeChecked()
  await studio.getByRole('button', { name: '颜色 6' }).click()
  await studio.getByRole('button', { name: '弹跳' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.piSwitch.settings.get()).then((next) => ({
        pack: next.desktopPet.activePackId,
        color: next.desktopPet.tibot.color,
        action: next.desktopPet.tibot.cue?.action ?? null
      }))
    )
    .toEqual({ pack: 'tibot-star', color: '#fa6291', action: 'jump' })
})
