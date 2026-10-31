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
  for (const size of [96, 160, 240]) {
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
  // At maximum size, the drawn frame should reach both usable screen edges.
  for (const direction of [-1, 1]) {
    const edge = await pet.evaluate(async (direction) => {
      let result: Awaited<ReturnType<NonNullable<typeof window.piSwitchPet>['moveBy']>> = null
      for (let index = 0; index < 20; index++)
        result = await window.piSwitchPet!.moveBy({ dx: direction * 400, dy: 0 })
      await window.piSwitchPet!.endDrag({ vx: 0, vy: 0 })
      return result
    }, direction)
    const frame = await image.boundingBox()
    expect(frame).not.toBeNull()
    const physicalEdge = edge!.x + (direction < 0 ? frame!.x : frame!.x + frame!.width)
    const screenEdge = edge!.workArea.x + (direction < 0 ? 0 : edge!.workArea.width)
    expect(Math.abs(physicalEdge - screenEdge)).toBeLessThanOrEqual(2)
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
      size: 240,
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
    if (name === '隐藏宠物' || name === '退出 Pi-Harness') {
      // Destroying this renderer can win the race with the input acknowledgement.
      // The caller still verifies persisted disabled state or application exit.
      await Promise.all([
        pet.waitForEvent('close'),
        item.click().catch((error) => {
          if (!pet.isClosed()) throw error
        })
      ])
    } else await item.click()
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

test('all manual actions play and tasks retain dragging and opening the console', async ({
  page,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  await page.evaluate(
    (desktopPet) => window.piSwitch.settings.set({ language: 'zh-CN', desktopPet }),
    {
      ...settings.desktopPet,
      enabled: true,
      size: 240,
      physics: false,
      idleVariants: false
    }
  )
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  const pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  const image = pet.locator('#app img')
  await expect(image).toBeVisible()
  const context = await pet.evaluate(() => window.piSwitchPet!.getContext())
  const clips = Object.entries(context.manifest.clips).filter(([, clip]) => clip.labels)
  expect(clips).toHaveLength(193)
  expect(clips.filter(([key]) => key.startsWith('indesktop-'))).toHaveLength(92)
  const openMenu = async () => {
    const box = (await image.boundingBox())!
    await pet.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await expect(pet.getByRole('menu')).toBeVisible()
  }
  for (const [clip] of clips) {
    await openMenu()
    await pet.getByRole('menuitem', { name: /播放动作/ }).click()
    await pet.getByRole('searchbox').fill(clip)
    await pet.locator(`[data-clip="${clip}"]`).click()
    await expect(image).toHaveAttribute('src', new RegExp(`/clips/${clip}/`))
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true)
    await expect(pet.getByRole('menu')).toHaveCount(0)
  }
  // Exercise the imported media past its first frame and through completion.
  await openMenu()
  await pet.getByRole('menuitem', { name: /播放动作/ }).click()
  await pet.getByRole('searchbox').fill('舞狮头')
  await expect(pet.locator('[data-clip]')).toHaveCount(1)
  await pet.locator('[data-clip="indesktop-lion-dance"]').click()
  await expect
    .poll(() =>
      image
        .getAttribute('src')
        .then((src) => Number(src?.match(/lion-dance_(\d+)\.webp/)?.[1] ?? 0))
    )
    .toBeGreaterThan(90)
  await pet.screenshot({ path: testInfo.outputPath('lion-dance.png'), omitBackground: true })
  await expect(image).toHaveAttribute('src', /\/clips\/idle\//)
  // Let one short action finish; it must resolve back to the current runtime state.
  await openMenu()
  await pet.getByRole('menuitem', { name: /播放动作/ }).click()
  await pet.getByRole('searchbox').fill('classic-hug')
  await pet.locator('[data-clip="classic-hug"]').click()
  await expect(image).toHaveAttribute('src', /\/clips\/idle\//, { timeout: 6000 })

  const pushActivity = async (activeAgents: number, events: Array<{ type: string }>) => {
    await electronApp.evaluate(
      ({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL().includes('/pet.html'))!
          .webContents.send('pi-harness:pet:state', payload)
      },
      { activeAgents, events }
    )
  }
  // Starting a task dismisses an already-open menu and cancels a manual action.
  await openMenu()
  await pet.getByRole('menuitem', { name: /播放动作/ }).click()
  await pet.getByRole('searchbox').fill('playful-sign-flip')
  await pet.locator('[data-clip="playful-sign-flip"]').click()
  await expect(image).toHaveAttribute('src', /\/clips\/playful-sign-flip\//)
  await openMenu()
  await pushActivity(2, [{ type: 'TASK_STARTED' }, { type: 'THINKING_STARTED' }])
  await expect(pet.getByRole('menu')).toHaveCount(0)
  await expect(image).toHaveAttribute('src', /\/clips\/thinking\//)
  const box = (await image.boundingBox())!
  await pet.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await expect(pet.getByRole('menuitem')).toHaveCount(1)
  await expect(pet.getByRole('menuitem', { name: '打开 Pi-Harness', exact: true })).toBeVisible()
  await pet.getByRole('menuitem', { name: '打开 Pi-Harness', exact: true }).click()
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('/index.html'))!
          .isFocused()
      )
    )
    .toBe(true)
  await pet.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(image).toHaveAttribute('src', /\/clips\/thinking\//)
  const position = () =>
    electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().includes('/pet.html'))!
        .getPosition()
    )
  const before = await position()
  await pet.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await pet.mouse.down()
  await pet.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 30, { steps: 8 })
  await expect(image).toHaveAttribute('src', /\/clips\/thinking\//)
  await pet.mouse.up()
  expect(await position()).not.toEqual(before)
  await expect(image).toHaveAttribute('src', /\/clips\/thinking\//)
  await pushActivity(1, [{ type: 'TASK_SUCCEEDED' }])
  await expect(image).toHaveAttribute('src', /\/clips\/working\//)
  await pet.evaluate(() => window.dispatchEvent(new MouseEvent('contextmenu')))
  await expect(pet.getByRole('menuitem')).toHaveCount(1)
  await pet.keyboard.press('Escape')
  // The activity gate remains active even with visual synchronization disabled.
  await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
    ...context.settings,
    agentSync: false
  })
  // The config event resets the synthetic activity to the host's idle count.
  // Wait for that context to be applied before sending a new activity snapshot;
  // otherwise a late snapshot closes the menu immediately after it opens.
  await expect(pet.locator('html')).toHaveAttribute('data-task-active', 'false')
  await pushActivity(1, [])
  await expect(pet.locator('html')).toHaveAttribute('data-task-active', 'true')
  await pet.evaluate(() => window.dispatchEvent(new MouseEvent('contextmenu')))
  await expect(pet.getByRole('menuitem')).toHaveCount(1)
  await pet.keyboard.press('Escape')
  await pushActivity(0, [])
  await openMenu()
  await pet.screenshot({
    path: testInfo.outputPath('manual-actions-menu.png'),
    omitBackground: true
  })
  await pet.getByRole('menuitem', { name: /播放动作/ }).click()
  await expect(pet.locator('[data-clip]')).toHaveCount(193)
  await pet.screenshot({
    path: testInfo.outputPath('manual-actions-list.png'),
    omitBackground: true
  })
})

test('pet menus keep dark scrollbars and all entries reachable at every pet size', async ({
  page,
  electronApp
}, testInfo) => {
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  await page.evaluate(
    (desktopPet) => window.piSwitch.settings.set({ language: 'zh-CN', desktopPet }),
    { ...settings.desktopPet, enabled: true, size: 160, idleVariants: false }
  )
  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  const pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  await expect(pet.locator('#app img')).toBeVisible()
  for (const size of [96, 160, 240]) {
    await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
      ...settings.desktopPet,
      enabled: true,
      size,
      idleVariants: false
    })
    await expect
      .poll(() => pet.locator('#app img').evaluate((img) => img.getBoundingClientRect().height))
      .toBe(size)
    await pet.evaluate(() => window.dispatchEvent(new MouseEvent('contextmenu')))
    const menu = pet.getByRole('menu')
    await expect(menu).toBeVisible()
    const layout = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        fits:
          rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        colorScheme: style.colorScheme,
        scrollbarWidth: style.scrollbarWidth,
        scrollbarColor: style.scrollbarColor,
        horizontalOverflow: element.scrollWidth > element.clientWidth
      }
    })
    expect(layout).toEqual({
      fits: true,
      colorScheme: 'dark',
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(255, 255, 255, 0.28) rgba(0, 0, 0, 0)',
      horizontalOverflow: false
    })
    if (size === 160)
      await pet.screenshot({ path: testInfo.outputPath('pet-menu-dark-scrollbar.png') })
    await menu.hover()
    await pet.mouse.wheel(0, 1000)
    await expect(
      menu.getByRole('menuitem', { name: '退出 Pi-Harness', exact: true })
    ).toBeInViewport()
    const play = menu.getByRole('menuitem', { name: /播放动作/ })
    await play.click()
    await expect(pet.getByRole('searchbox')).toBeInViewport()
    const actions = menu.locator('[data-clip]')
    await expect(actions).toHaveCount(193)
    await menu.hover()
    await pet.mouse.wheel(0, 10000)
    await expect(actions.last()).toBeInViewport()
    if (size === 160)
      await pet.screenshot({ path: testInfo.outputPath('pet-actions-dark-scrollbar.png') })
    // The last action remains selectable after scrolling the complete list.
    const clip = await actions.last().getAttribute('data-clip')
    await actions.last().click()
    await expect(pet.locator('#app img')).toHaveAttribute('src', new RegExp(`/clips/${clip}/`))
    await expect(menu).toHaveCount(0)
  }
})

test('pet settings use draggable sliders and omit the pack detail card', async ({
  page
}, testInfo) => {
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-desktop-pet').click()
  const section = page.getByTestId('desktop-pet-section')
  await expect(section.getByRole('slider')).toHaveCount(4)
  await expect(page.getByTestId('pet-pack-info')).toHaveCount(0)
  await expect(page.getByTestId('pet-import-zip')).toBeVisible()
  await expect(page.getByTestId('pet-import-folder')).toBeVisible()

  const size = section.getByRole('slider', { name: /宠物大小/ })
  await size.focus()
  await size.press('End')
  await expect(size).toHaveValue('150')
  await size.scrollIntoViewIfNeeded()
  const box = (await size.boundingBox())!
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  const draggedSize = Number(await size.inputValue())
  expect(draggedSize).toBeGreaterThan(60)
  expect(draggedSize).toBeLessThan(150)
  await expect(size).toHaveAttribute('aria-valuetext', `${draggedSize}%`)

  const opacity = section.getByRole('slider', { name: '宠物不透明度（%）', exact: true })
  await opacity.focus()
  await opacity.press('Home')
  await expect(opacity).toHaveValue('30')
  const timeout = section.getByRole('slider', { name: /气泡停留/ })
  await timeout.focus()
  await timeout.press('Home')
  await expect(timeout).toHaveValue('0')
  const bubbleOpacity = section.getByRole('slider', { name: '气泡不透明度（%）', exact: true })
  await bubbleOpacity.focus()
  await bubbleOpacity.press('Home')
  await expect(bubbleOpacity).toHaveValue('30')
  await expect
    .poll(() =>
      page
        .evaluate(() => window.piSwitch.settings.get())
        .then((s) => ({
          size: s.desktopPet.size,
          opacity: s.desktopPet.opacity,
          timeout: s.desktopPet.bubbleTimeoutSeconds,
          bubbleOpacity: s.desktopPet.bubbleOpacity
        }))
    )
    .toEqual({
      size: Math.round((draggedSize / 100) * 160),
      opacity: 0.3,
      timeout: 0,
      bubbleOpacity: 0.3
    })

  await section.getByRole('switch', { name: '状态气泡', exact: true }).click()
  await expect(timeout).toBeDisabled()
  await expect(bubbleOpacity).toBeDisabled()
  await section.getByRole('switch', { name: '状态气泡', exact: true }).click()
  await expect(timeout).toBeEnabled()
  await expect(bubbleOpacity).toBeEnabled()
  await size.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('pet-settings-sliders.png') })
})

// Simulated display events exercise Main coordinates; this is not a physical DPI test.
test('reclamps after display changes and releases display listeners on disable', async ({
  page,
  electronApp
}) => {
  const baseline = await electronApp.evaluate(({ screen }) =>
    screen.listenerCount('display-metrics-changed')
  )
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
      ...settings.desktopPet,
      enabled: true,
      size: 240
    })
    await expect
      .poll(() => electronApp.windows().some((window) => window.url().includes('/pet.html')))
      .toBe(true)
    const result = await electronApp.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('/pet.html')
      )!
      const originalAll = screen.getAllDisplays.bind(screen)
      const originalPrimary = screen.getPrimaryDisplay.bind(screen)
      const display = {
        ...originalPrimary(),
        workArea: { x: 0, y: 0, width: 800, height: 600 }
      }
      screen.getAllDisplays = () => [display]
      screen.getPrimaryDisplay = () => display
      try {
        window.setPosition(800, 700)
        screen.emit('display-metrics-changed', {}, display, ['workArea', 'scaleFactor'])
        const bounds = window.getBounds()
        return { bounds, listeners: screen.listenerCount('display-metrics-changed') }
      } finally {
        screen.getAllDisplays = originalAll
        screen.getPrimaryDisplay = originalPrimary
        screen.emit('display-metrics-changed', {}, originalPrimary(), ['workArea'])
      }
    })
    expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(800)
    expect(result.bounds.y + result.bounds.height).toBeLessThanOrEqual(600)
    expect(result.listeners).toBe(baseline + 1)
    await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
      ...settings.desktopPet,
      enabled: false
    })
    await expect
      .poll(() =>
        electronApp.evaluate(({ screen }) => screen.listenerCount('display-metrics-changed'))
      )
      .toBe(baseline)
  }
})
