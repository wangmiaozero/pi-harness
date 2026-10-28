import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { resolveAppLocale } from '../src/shared/constants/language'

test('desktop pet fits its window and stays at a normal drag release', async ({
  page,
  electronApp,
  testUserData
}, testInfo) => {
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
    ...settings.desktopPet,
    enabled: true,
    physics: true,
    idleVariants: false
  })
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  const pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  const image = pet.locator('#app img')
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
  for (const size of [96, 160, 320]) {
    await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
      ...settings.desktopPet,
      enabled: true,
      size,
      physics: true,
      idleVariants: false
    })
    await expect
      .poll(() => image.evaluate((img) => Math.round(img.getBoundingClientRect().height)))
      .toBe(size)
    const visible = await image.evaluate((img) => {
      const rect = img.getBoundingClientRect()
      return (
        rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      )
    })
    expect(visible).toBe(true)
  }
  await pet.screenshot({ path: testInfo.outputPath('desktop-pet.png'), omitBackground: true })
  const position = () =>
    electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().includes('/pet.html'))!
        .getPosition()
    )
  for (const physics of [true, false]) {
    await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
      ...settings.desktopPet,
      enabled: true,
      size: 320,
      physics,
      idleVariants: false
    })
    // Native mouse input exercises pointer capture and the real Main move/persist bridge.
    const before = await position()
    const rect = (await image.boundingBox())!
    await pet.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await pet.mouse.down()
    await pet.mouse.move(rect.x + rect.width / 2 - 40, rect.y + rect.height / 2 - 40, { steps: 10 })
    await pet.waitForTimeout(150) // A deliberate pause before release must not trigger a throw.
    await pet.mouse.up()
    const released = await position()
    expect(released).not.toEqual(before)
    await pet.waitForTimeout(1200)
    expect(await position()).toEqual(released)
    await expect
      .poll(() => {
        const saved = JSON.parse(
          fs.readFileSync(path.join(testUserData, 'pet-window-state.json'), 'utf8')
        )
        return [saved.x, saved.y]
      })
      .toEqual(released)
  }
  await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
    ...settings.desktopPet,
    enabled: false
  })
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(false)
})

test('desktop pet menu and visible bubble follow application language changes', async ({
  page,
  electronApp
}) => {
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  await page.evaluate(
    (desktopPet) => window.piSwitch.settings.set({ language: 'zh-CN', desktopPet }),
    {
      ...settings.desktopPet,
      enabled: true,
      idleVariants: false,
      bubbleTimeoutSeconds: 0
    }
  )
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  const pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  await expect(pet.locator('#app img')).toBeVisible()
  await pet.evaluate(() => window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const menu = pet.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: '打开 Pi-Harness', exact: true })).toBeVisible()
  await expect(pet.locator('#app')).toContainText('一切安静')
  const localeCases = [
    ['en-US', 'Open Pi-Harness', 'All quiet'],
    ['zh-TW', '開啟 Pi-Harness', '一切安靜'],
    ['ja-JP', 'Pi-Harness を開く', '静かに待機中'],
    ['ko-KR', 'Pi-Harness 열기', '조용히 대기 중'],
    ['ru-RU', 'Открыть Pi-Harness', 'Тихо'],
    ['fr-FR', 'Ouvrir Pi-Harness', 'Tout est calme'],
    ['de-DE', 'Pi-Harness öffnen', 'Ruhe'],
    ['zh-CN', '打开 Pi-Harness', '一切安静']
  ] as const
  for (const [language, label, bubble] of localeCases) {
    await page.evaluate((language) => window.piSwitch.settings.set({ language }), language)
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    await expect(pet.locator('#app')).toContainText(bubble)
    await expect(pet.locator('html')).toHaveAttribute('lang', language)
  }
  const systemLocale = await electronApp.evaluate(({ app }) => app.getLocale())
  const resolved = resolveAppLocale('auto', systemLocale)
  const [, label, bubble] = localeCases.find(([language]) => language === resolved)!
  await page.evaluate(() => window.piSwitch.settings.set({ language: 'auto' }))
  await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
  await expect(pet.locator('#app')).toContainText(bubble)
  await expect(pet.locator('html')).toHaveAttribute('lang', resolved)
})

test('every desktop pet menu action performs its advertised operation', async ({
  page,
  electronApp,
  testUserData
}) => {
  let mainPage = page
  const settings = await mainPage.evaluate(() => window.piSwitch.settings.get())
  await mainPage.evaluate(
    (desktopPet) => window.piSwitch.settings.set({ language: 'zh-CN', desktopPet }),
    {
      ...settings.desktopPet,
      enabled: true,
      size: 160,
      alwaysOnTop: true,
      reducedMotion: false
    }
  )
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  let pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  const petState = () =>
    mainPage.evaluate(() => window.piSwitch.settings.get()).then((s) => s.desktopPet)
  const nativeMainState = () =>
    electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/index.html')
      )!
      return { visible: win.isVisible(), minimized: win.isMinimized() }
    })
  const clickMenu = async (name: string) => {
    const image = pet.locator('#app img')
    await expect(image).toBeVisible()
    const box = (await image.boundingBox())!
    await pet.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    const item = pet.getByRole('menuitem', { name, exact: true })
    await expect(item).toBeVisible()
    // Move over the empty pixels behind the menu before clicking it.
    await item.hover()
    await pet.waitForTimeout(120)
    await item.click()
  }

  // Open must restore a minimized/hidden main window.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('/index.html'))!
      .minimize()
  })
  await clickMenu('打开 Pi-Harness')
  await expect.poll(nativeMainState).toEqual({ visible: true, minimized: false })
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('/index.html'))!
      .hide()
  })
  await clickMenu('设置…')
  await expect(mainPage).toHaveURL(/#\/settings\/desktop-pet/)
  await expect(mainPage.getByRole('switch', { name: '置顶显示', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect.poll(nativeMainState).toEqual({ visible: true, minimized: false })

  for (const enabled of [false, true]) {
    await clickMenu(enabled ? '置顶显示' : '置顶显示 ✓')
    await expect.poll(() => petState().then((s) => s.alwaysOnTop)).toBe(enabled)
    await expect(mainPage.getByRole('switch', { name: '置顶显示', exact: true })).toHaveAttribute(
      'aria-checked',
      String(enabled)
    )
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes('/pet.html'))!
            .isAlwaysOnTop()
        )
      )
      .toBe(enabled)
  }
  for (const enabled of [true, false]) {
    await clickMenu(enabled ? '减少动效' : '减少动效 ✓')
    await expect.poll(() => petState().then((s) => s.reducedMotion)).toBe(enabled)
    await expect(mainPage.getByRole('switch', { name: '减少动效', exact: true })).toHaveAttribute(
      'aria-checked',
      String(enabled)
    )
    await expect
      .poll(() =>
        pet.evaluate(() => window.piSwitchPet!.getContext()).then((c) => c.settings.reducedMotion)
      )
      .toBe(enabled)
  }

  await pet.evaluate(() => window.piSwitchPet!.moveBy({ dx: -200, dy: -150 }))
  await clickMenu('重置位置')
  await expect
    .poll(() =>
      electronApp
        .evaluate(({ BrowserWindow, screen }) => {
          const win = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('/pet.html')
          )!
          const bounds = win.getBounds()
          const area = screen.getDisplayNearestPoint(bounds).workArea
          return {
            x: bounds.x,
            y: bounds.y,
            expectedX: Math.round(area.x + (area.width - bounds.width) / 2),
            expectedY: Math.round(area.y + (area.height - bounds.height) / 2)
          }
        })
        .then((s) => s.x === s.expectedX && s.y === s.expectedY)
    )
    .toBe(true)

  await clickMenu('隐藏宠物')
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(false)
  await expect.poll(() => petState().then((s) => s.enabled)).toBe(false)
  await expect(mainPage.getByRole('switch', { name: '启用桌宠', exact: true })).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(await nativeMainState()).toEqual({ visible: true, minimized: false })
  await expect
    .poll(
      () =>
        JSON.parse(fs.readFileSync(path.join(testUserData, 'settings.json'), 'utf8')).desktopPet
          .enabled
    )
    .toBe(false)

  await mainPage.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
    ...(await petState()),
    enabled: true
  })
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  // Both entries must also recreate a main window that was closed entirely.
  for (const action of ['打开 Pi-Harness', '设置…']) {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('/index.html'))!
        .close()
    })
    await expect
      .poll(() => electronApp.windows().some((win) => win.url().includes('/index.html')))
      .toBe(false)
    await clickMenu(action)
    await expect
      .poll(() => electronApp.windows().some((win) => win.url().includes('/index.html')))
      .toBe(true)
    mainPage = electronApp.windows().find((win) => win.url().includes('/index.html'))!
    await expect(mainPage.getByTestId('app-shell')).toBeVisible()
    if (action === '设置…') {
      await expect(mainPage).toHaveURL(/#\/settings\/desktop-pet/)
      await expect(mainPage.getByRole('switch', { name: '启用桌宠', exact: true })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    }
  }
  const exited = electronApp.waitForEvent('close')
  await clickMenu('退出 Pi-Harness')
  await exited
})
