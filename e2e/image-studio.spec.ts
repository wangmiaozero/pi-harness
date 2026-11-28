import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'

const modelId = 'gpt-image-2-2026-04-21'

async function waitForTemplateArt(studio: Locator): Promise<void> {
  const templates = studio.getByTestId(/^image-template-/)
  await expect(templates).toHaveCount(8)
  await templates.locator('.image-template__art').evaluateAll(async (elements) => {
    const sources = new Set(elements.map((element) => getComputedStyle(element).backgroundImage))
    await Promise.all(
      Array.from(sources, (source) => {
        const image = new Image()
        image.src = source.slice(5, -2)
        return image.decode()
      })
    )
  })
}

test('opens Images below Home and shows the gallery with a floating composer', async ({
  page
}, testInfo) => {
  const links = page.getByTestId('app-navigation-rail').locator('nav a')
  await expect(links.nth(1)).toHaveAttribute('href', '#/images')
  await links.nth(1).click()
  const studio = page.getByTestId('image-studio')
  await expect(studio).toBeVisible()
  await expect(studio.getByTestId('image-studio-featured')).toHaveAttribute('aria-pressed', 'true')
  const model = studio.getByRole('button', { name: '选择模型' })
  await model.click()
  await expect(page.getByRole('option', { name: '暂无已配置的图像模型' })).toBeDisabled()
  await expect(page).toHaveURL(/#\/images$/)
  await model.press('Escape')
  await expect(studio.getByRole('button', { name: '输出尺寸' })).toHaveCount(0)
  await expect(studio.getByTestId('image-studio-generate')).toBeDisabled()
  const gallery = studio.getByRole('main')
  const prompt = studio.getByTestId('image-studio-prompt')
  const galleryBox = (await gallery.boundingBox())!
  const promptBox = (await prompt.boundingBox())!
  expect(promptBox.y).toBeGreaterThan(galleryBox.y + galleryBox.height * 0.65)
  expect(promptBox.y).toBeLessThan(galleryBox.y + galleryBox.height)
  await waitForTemplateArt(studio)
  await page.screenshot({ path: testInfo.outputPath('image-studio-layout.png') })

  await studio.getByTestId('image-studio-templates').click()
  await studio.getByTestId('image-template-landscape').click()
  const templateDialog = page.getByTestId('image-template-dialog')
  await expect(templateDialog).toBeVisible()
  await expect(templateDialog).toContainText('胶片摄影')
  await expect(templateDialog.getByRole('heading', { name: '高山蓝调时刻' })).toBeVisible()
  await templateDialog.getByTestId('image-template-apply').click()
  await expect(templateDialog).toHaveCount(0)
  await expect(prompt).toHaveValue(/胶片摄影/)
})

test('selects image models from all configured providers including hidden models and uses their chosen strength', async ({
  page
}, testInfo) => {
  const imagePath = path.join(import.meta.dirname, 'fixtures', 'portrait.png')
  const image = fs.readFileSync(imagePath)
  const requests: { url: string; contentType: string; body: string }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({
      url: request.url ?? '',
      contentType: request.headers['content-type'] ?? '',
      body: Buffer.concat(chunks).toString('utf8')
    })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Image API fixture did not bind')
    await page.evaluate(
      async ({ baseUrl, modelId }) => {
        const common = {
          protocol: 'openai-completions' as const,
          apiKey: null,
          headers: {},
          authHeader: false,
          enabled: true,
          timeout: null
        }
        await window.piSwitch.providers.create({
          ...common,
          key: 'first-fixture',
          name: 'First Studio',
          displayName: 'First Studio',
          baseUrl: baseUrl.replace('/v1', '/first/v1'),
          defaultModelId: 'gpt-image-1.5'
        })
        await window.piSwitch.providers.create({
          ...common,
          key: 'art-fixture',
          name: 'Second Studio',
          displayName: 'Second Studio',
          baseUrl,
          defaultModelId: modelId
        })
        const hidden = (await window.piSwitch.models.list()).find(
          (model) => model.modelId === modelId && model.providerId === 'art-fixture'
        )!
        await window.piSwitch.models.setVisibility([{ id: hidden.id, enabled: false }])
      },
      { baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId }
    )

    await page.reload()
    await expect(page.getByTestId('startup-animation')).toHaveCount(0)
    await page.locator('a[href="#/images"]').click()
    await expect(page).toHaveURL(/#\/images$/)

    const studio = page.getByTestId('image-studio')
    await studio.getByRole('button', { name: '选择模型' }).click()
    const vendors = page.locator('[data-select-cascade-group]')
    const first = vendors.filter({ hasText: 'First Studio' })
    await expect(first).toBeVisible()
    await first.hover()
    await expect(
      page.locator('[data-select-cascade-submenu]').getByRole('option', { name: 'gpt-image-1.5' })
    ).toBeEnabled()
    const second = vendors.filter({ hasText: 'Second Studio' })
    await second.hover()
    await waitForTemplateArt(studio)
    await page.screenshot({ path: testInfo.outputPath('image-studio-model-menu.png') })
    await page
      .locator('[data-select-cascade-submenu]')
      .getByRole('option', { name: modelId })
      .click()
    await expect(page.getByTestId('image-studio-model')).toContainText(modelId)
    await expect(page).toHaveURL(/#\/images$/)
    const quality = studio.getByRole('button', { name: '生成强度' })
    await quality.click()
    const slider = page.getByRole('dialog', { name: '生成强度' }).getByRole('slider')
    await expect(slider).toHaveAttribute('aria-valuetext', '自动')
    const sliderBox = (await slider.boundingBox())!
    await slider.click({ position: { x: sliderBox.width * 0.65, y: sliderBox.height / 2 } })
    await expect(slider).toHaveAttribute('aria-valuetext', '中')
    await page.screenshot({ path: testInfo.outputPath('image-studio-strength.png') })
    await slider.press('End')
    await expect(slider).toHaveAttribute('aria-valuetext', '高')
    await slider.press('Escape')
    await expect(slider).toHaveCount(0)
    await expect(quality).toHaveText('高')
    await expect(studio.getByRole('button', { name: '输出尺寸' })).toHaveCount(0)
    const prompt = page.getByTestId('image-studio-prompt')
    await prompt.fill('A study of coastal light')
    await prompt.press('Enter')
    const card = page.getByTestId('studio-image')
    await expect(card).toHaveCount(1)
    await expect(card.getByRole('img')).toBeVisible()
    expect(requests[0]?.url).toBe('/v1/images/generations')
    expect(JSON.parse(requests[0]!.body)).toEqual({
      model: modelId,
      prompt: 'A study of coastal light',
      quality: 'high'
    })

    await card.getByRole('button', { name: '用作参考图' }).click()
    await prompt.fill('Add warmer light')
    await page.getByTestId('image-studio-generate').click()
    await expect(card).toHaveCount(2)
    expect(requests[1]?.url).toBe('/v1/images/edits')
    expect(requests[1]?.contentType).toContain('multipart/form-data')
    expect(requests[1]?.body).toContain('Add warmer light')
    expect(requests[1]?.body).toMatch(/name="quality"\r\n\r\nhigh/)
    expect(requests[1]?.body).not.toContain('name="size"')
    expect(requests[1]?.body).not.toContain('response_format')

    await page.reload()
    await page.getByTestId('image-studio-library').click()
    await expect(card).toHaveCount(2)
    await expect(card.first().getByRole('img')).toBeVisible()
    await card.first().getByRole('button', { name: '生成结果' }).click()
    await expect(page.getByTestId('chat-image-preview')).toBeVisible()
    await expect(page.getByTestId('chat-image-copy')).toBeVisible()
    await expect(page.getByTestId('chat-image-download')).toBeVisible()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
