import { expect, type Page, type ElectronApplication } from '@playwright/test'

/** Optional pet frames are installed from the resource market, not shipped in the app. */
export async function verifyPetResources(
  page: Page,
  _application: ElectronApplication
): Promise<void> {
  const packs = await page.evaluate(async () => await window.piSwitch.pets.list())
  expect(packs.some((pack) => pack.id === 'bigfish' && pack.bundled)).toBe(false)
}
