import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

test.beforeEach(({ testUserData }) => {
  const startup = path.join(testUserData, 'market', 'themes', 'deepseek', 'assets', 'startup')
  fs.mkdirSync(startup, { recursive: true })
  fs.writeFileSync(path.join(startup, 'line-6.mp3'), Buffer.from('ID3-startup-voice'))
})

test('startup voice lines from an installed theme pack can be fetched by the renderer', async ({
  page
}) => {
  const result = await page.evaluate(async () => {
    try {
      const response = await fetch('pi-market://theme/deepseek/assets/startup/line-6.mp3')
      return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  expect(result).toEqual({ ok: true, bytes: 'ID3-startup-voice'.length })
})

test('the renderer still cannot fetch arbitrary remote URLs', async ({ page }) => {
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/')
      return false
    } catch {
      return true
    }
  })
  expect(blocked).toBe(true)
})
