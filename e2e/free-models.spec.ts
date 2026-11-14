import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { test as base, expect, startFixtureSession } from './fixtures'

const id = 'dots-studio/dots-3-note-preview:free'
const marker = '来自工作区文件的内容'
const answer = '已读取工作区文件'
type RequestBody = {
  model: string
  max_tokens?: number
  reasoning?: { effort?: string; enabled?: boolean }
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
}

function messageText(content: RequestBody['messages'][number]['content']): string {
  return typeof content === 'string'
    ? content
    : (content?.map((part) => part.text ?? '').join('') ?? '')
}

const test = base.extend<{ freeRequests: RequestBody[] }>({
  freeRequests: async ({}, use) => {
    const requests: RequestBody[] = []
    await use(requests)
  },
  freeModelsTest: async ({ freeRequests, workspaceRoot }, use) => {
    const upstream = http.createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            data: [
              {
                id,
                name: 'Fixture Free Coder',
                isFree: true,
                context_length: 512_000,
                top_provider: { max_completion_tokens: 460_800 },
                supported_parameters: ['tools', 'reasoning']
              },
              { id: 'fixture/text:free', name: 'Fixture Text Only', isFree: true }
            ]
          })
        )
        return
      }
      if (req.url !== '/v1/chat/completions' || req.headers.authorization) {
        res.writeHead(401).end()
        return
      }
      let input = ''
      for await (const chunk of req) input += chunk
      const body = JSON.parse(input) as RequestBody
      freeRequests.push(body)
      if (body.max_tokens === undefined || body.max_tokens > 262_144) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Invalid output limit' } }))
        return
      }
      const toolResult = body.messages.some(({ role }) => role === 'tool')
      const delta = toolResult
        ? { content: answer }
        : {
            tool_calls: [
              {
                index: 0,
                id: 'call_fixture',
                type: 'function',
                function: {
                  name: 'read',
                  arguments: JSON.stringify({ path: path.join(workspaceRoot, 'demo.txt') })
                }
              }
            ]
          }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const [change, finish] of [
        [delta, null],
        [{}, toolResult ? 'stop' : 'tool_calls']
      ]) {
        res.write(
          `data: ${JSON.stringify({
            id: 'fixture',
            model: id,
            choices: [{ index: 0, delta: change, finish_reason: finish }]
          })}\n\n`
        )
      }
      res.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as { port: number }
    try {
      await use(`http://127.0.0.1:${port}/v1`)
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  }
})

test('selects a keyless free model, runs a Pi tool and restores the original model', async ({
  page,
  electronApp,
  workspaceRoot,
  piAgentDir,
  testUserData,
  freeRequests,
  freeModelsTest
}) => {
  await fs.writeFile(path.join(workspaceRoot, 'demo.txt'), marker)
  await page.locator('a[href="#/workspace"]').click()
  const picker = page.getByTestId('workspace-model-select').getByRole('button')
  await picker.click()
  const panel = page.getByTestId('composer-model-panel')
  const quick = panel.getByTestId('composer-free-group')
  if (await quick.isVisible()) await quick.click()
  else
    await page
      .getByTestId('composer-vendor-panel')
      .getByRole('button', { name: '免费模型' })
      .click()
  await expect(panel.getByRole('option').filter({ hasText: 'Fixture Text Only' })).toBeDisabled()
  await expect(panel.getByTestId('composer-free-refresh')).toBeVisible()
  const search = panel.getByTestId('composer-model-search')
  await search.fill('glm-5.3')
  await expect(panel.getByRole('option')).toHaveCount(0)
  await search.press('Enter')
  await expect(page.getByTestId('free-model-privacy-continue')).toHaveCount(0)
  expect(freeRequests).toHaveLength(0)
  await search.clear()
  await expect(panel).toContainText('尚未试过')
  await panel.getByTestId('composer-model-search').fill('free coder')
  await panel.getByTestId('composer-model-search').press('Enter')
  await expect(page.getByRole('dialog')).toContainText('Kilo')
  expect(freeRequests).toHaveLength(0)
  await page.getByTestId('free-model-privacy-continue').click()
  await expect(picker).toContainText('Fixture Free Coder')
  await picker.click()
  const thinking = panel.getByTestId('composer-thinking-slider')
  await thinking.press('End')
  await expect(thinking).toHaveAttribute('aria-valuetext', 'high')
  await thinking.press('Escape')

  const composer = page.getByTestId('chat-composer')
  await composer.getByRole('button', { name: '权限模式', exact: true }).click()
  await page.getByRole('option', { name: /完全访问权限/ }).click()
  const editor = page.getByTestId('composer-editor')
  const prompt = `请读取 ${path.join(workspaceRoot, 'demo.txt')}`
  await editor.fill(prompt)
  await editor.press('Enter')
  await expect(page.getByTestId('chat-scroller')).toContainText(answer)
  await expect(page.getByTestId('composer-abort')).toBeHidden()
  const calls = freeRequests.filter((request) =>
    request.messages.some((message) => messageText(message.content) === prompt)
  )
  expect(calls).toHaveLength(2)
  expect(calls.every((request) => request.model === id)).toBe(true)
  expect(calls.map((request) => request.reasoning)).toEqual([
    { effort: 'high' },
    { effort: 'high' }
  ])
  expect(
    calls[1].messages.some(
      ({ role, content }) => role === 'tool' && messageText(content).includes(marker)
    )
  ).toBe(true)
  const nativeConfig = await fs.readFile(path.join(piAgentDir, 'models.json'), 'utf8')
  expect(nativeConfig).not.toContain('pi-harness-free')

  const sessions = await page.evaluate(() => window.piSwitch.sessions.list(true))
  const sessionId = sessions.find((session) => session.messageCount >= 2)!.id
  await page.locator('a[href="#/models"]').click()
  await expect(
    page.getByTestId('provider-row').filter({ hasText: 'Fixture Free Coder' })
  ).toHaveCount(0)

  const child = electronApp.process()
  const executablePath = child.spawnfile
  const args = child.spawnargs.slice(1)
  await electronApp.close()
  const relaunched = await electron.launch({
    executablePath,
    args,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      PI_HARNESS_AGENT_MODE: process.env.PI_HARNESS_E2E_AGENT_MODE ?? 'sdk',
      PI_HARNESS_PI_CLI_PATH: path.join(testUserData, 'missing-pi-cli'),
      PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
      PI_CODING_AGENT_DIR: piAgentDir,
      PI_HARNESS_USER_DATA: testUserData,
      PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home'),
      PI_HARNESS_DISABLE_ACCOUNT_DISCOVERY: '1',
      PI_HARNESS_FREE_MODELS_TEST: freeModelsTest
    }
  })
  try {
    const reopened = await relaunched.firstWindow()
    await reopened.waitForLoadState('domcontentloaded')
    await reopened.locator('a[href="#/workspace"]').click()
    await reopened.getByTestId(`session-row-${sessionId}`).click()
    await expect(reopened.getByTestId('chat-scroller')).toContainText(answer)
    const restored = await startFixtureSession(reopened, { sessionId })
    const state = await reopened.evaluate(
      (id) => window.piSwitch.agent.state(id),
      restored.sessionId
    )
    expect(state?.model).toMatchObject({ provider: 'pi-harness-free', id: `kilo/${id}` })
    expect(await reopened.evaluate(() => window.piSwitch.freeModels.snapshot())).toMatchObject({
      privacyAccepted: true
    })
  } finally {
    await relaunched.close()
  }
})
