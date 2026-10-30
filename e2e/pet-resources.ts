import fs from 'node:fs'
import { expect, type Page, type ElectronApplication } from '@playwright/test'

/** Exercise the real IPC registry and image protocol, including archived frames. */
export async function verifyPetResources(
  page: Page,
  application: ElectronApplication
): Promise<void> {
  if (process.env.PI_HARNESS_E2E_VARIANT === 'nomascot') {
    expect(await page.evaluate(() => window.piSwitch.pets.list())).toEqual([])
    return
  }
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.piSwitch.pets.list()).some((pack) => pack.id === 'bigfish' && pack.compatible)
      )
    )
    .toBe(true)
  const pack = await page.evaluate(() => window.piSwitch.pets.detail('bigfish'))
  expect(pack?.bundled).toBe(true)
  const source = JSON.parse(fs.readFileSync('resources/petpacks/bigfish/pet-pack.json', 'utf8'))
  expect(Object.keys(pack!.clips).sort()).toEqual(Object.keys(source.clips).sort())
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  try {
    await page.evaluate((desktopPet) => window.piSwitch.settings.set({ desktopPet }), {
      ...settings.desktopPet,
      enabled: true,
      idleVariants: false
    })
    await expect
      .poll(() => application.windows().some((win) => win.url().includes('/pet.html')))
      .toBe(true)
    const renderer = application.windows().find((win) => win.url().includes('/pet.html'))!
    await renderer.waitForLoadState('domcontentloaded')
    for (const name of ['idle', 'indesktop-lion-dance']) {
      const clip = pack!.clips[name]
      expect(clip).toBeDefined()
      const directory = clip.dir ?? name
      const stem = directory.split('/').pop()!
      for (const index of [1, clip.frames]) {
        const file = `${stem}_${String(index).padStart(3, '0')}.webp`
        const dimensions = await renderer.evaluate(async (url) => {
          const image = new Image()
          image.src = url
          await image.decode()
          return [image.naturalWidth, image.naturalHeight]
        }, `pi-pet://petpack/bigfish/${directory}/${file}`)
        expect(dimensions[0]).toBeGreaterThan(0)
        expect(dimensions[1]).toBeGreaterThan(0)
      }
    }
  } finally {
    await page.evaluate(
      (desktopPet) => window.piSwitch.settings.set({ desktopPet }),
      settings.desktopPet
    )
  }
}
