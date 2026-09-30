import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from './fixtures'

const sessionId = '01a0ddce-5d0b-75b1-bb98-role-layout'

const test = base.extend({
  piAgentDir: async ({ testUserData, workspaceRoot }, use) => {
    const root = path.resolve(import.meta.dirname, '..')
    const piAgentDir = path.join(testUserData, 'mock-pi-role-layout')
    fs.cpSync(path.join(root, 'fixtures', 'mock-pi'), piAgentDir, { recursive: true })
    fs.writeFileSync(path.join(testUserData, 'settings.json'), JSON.stringify({ theme: 'light' }))
    seedSession(piAgentDir, workspaceRoot)
    await use(piAgentDir)
  }
})

test('places user messages on the right and visually separates agent output', async ({
  page,
  workspaceRoot
}, testInfo) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(
    async ({ root, selectedSessionId }) => {
      await window.piSwitch.workspace.allowRoot(root)
      localStorage.setItem(
        'pi-harness.workspace.v1',
        JSON.stringify({
          projectKey: null,
          pickedCwd: null,
          projectRoots: [],
          tabs: [
            {
              id: `chat:${selectedSessionId}`,
              kind: 'chat',
              title: 'Message roles',
              sessionId: selectedSessionId,
              closable: false
            }
          ],
          activeTabId: `chat:${selectedSessionId}`
        })
      )
    },
    { root: workspaceRoot, selectedSessionId: sessionId }
  )

  await page.locator('a[href="#/workspace"]').click()
  const user = page.locator('[data-message-role="user"]').first()
  const assistant = page.locator('[data-message-role="assistant"]').first()
  const toolResult = page.locator('[data-message-role="toolResult"]').first()
  await expect(user).toBeVisible()
  await expect(assistant).toBeVisible()
  await expect(toolResult).toBeVisible()
  await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(1)
  await expect(page.locator('.message-hud')).toHaveCount(3)
  await expect(user.locator('.message-role-badge')).toHaveText('我')
  await expect(assistant.locator('.message-role-badge')).toHaveText('助手')

  const [userBox, assistantBox, toolResultBox] = await Promise.all([
    user.boundingBox(),
    assistant.boundingBox(),
    toolResult.boundingBox()
  ])
  expect(userBox!.x).toBeCloseTo(assistantBox!.x, 0)
  expect(userBox!.width).toBeCloseTo(assistantBox!.width, 0)
  expect(toolResultBox!.x).toBeCloseTo(assistantBox!.x, 0)
  expect(toolResultBox!.width).toBeCloseTo(assistantBox!.width, 0)

  const colors = await page.evaluate(() => {
    const userBody = document.querySelector<HTMLElement>('.user-message-body')
    const assistantBody = document.querySelector<HTMLElement>('.assistant-message-body')
    if (!userBody || !assistantBody) throw new Error('Message bodies not found')
    const userStyle = getComputedStyle(userBody)
    const assistantStyle = getComputedStyle(assistantBody)
    return {
      userBackground: userStyle.backgroundColor,
      userBorder: userStyle.borderRightColor,
      assistantBackground: assistantStyle.backgroundColor,
      assistantBorder: assistantStyle.borderLeftColor
    }
  })
  expect(colors.userBackground).not.toBe(colors.assistantBackground)
  expect(colors.userBorder).not.toBe(colors.assistantBorder)

  const qaDir = process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir
  fs.mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: path.join(qaDir, 'chat-message-role-layout.png') })

  await page.locator('a[href="#/settings"]').click()
  const userNameInput = page.getByTestId('user-name-input')
  const assistantNameInput = page.getByTestId('assistant-name-input')
  await expect(userNameInput).toHaveValue('我')
  await expect(assistantNameInput).toHaveValue('助手')
  await userNameInput.fill('阿明')
  await assistantNameInput.fill('小策')
  await assistantNameInput.blur()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.piSwitch.settings
          .get()
          .then(({ userName, assistantName }) => ({ userName, assistantName }))
      )
    )
    .toEqual({ userName: '阿明', assistantName: '小策' })
  await page.screenshot({ path: path.join(qaDir, 'chat-name-settings.png') })

  await page.locator('a[href="#/workspace"]').click()
  await expect(page.locator('[data-message-role="user"] .message-role-badge').first()).toHaveText(
    '阿明'
  )
  await expect(
    page.locator('[data-message-role="assistant"] .message-role-badge').first()
  ).toHaveText('小策')
  await page.screenshot({ path: path.join(qaDir, 'chat-message-custom-names.png') })

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

function seedSession(piAgentDir: string, workspaceRoot: string): void {
  const safePath = `--${path
    .resolve(workspaceRoot)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(piAgentDir, 'sessions', safePath)
  const timestamp = '2026-09-28T12:00:00.000Z'
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, `2026-09-28T12-00-00-000Z_${sessionId}.jsonl`),
    [
      { type: 'session', version: 3, id: sessionId, timestamp, cwd: workspaceRoot },
      {
        type: 'message',
        id: 'role-layout-user',
        parentId: null,
        timestamp,
        message: {
          role: 'user',
          content: '请优化对话区域，让用户和 Agent 的消息更容易区分。',
          timestamp: Date.parse(timestamp)
        }
      },
      {
        type: 'message',
        id: 'role-layout-tool-result',
        parentId: 'role-layout-user',
        timestamp: '2026-09-28T12:00:00.500Z',
        message: {
          role: 'toolResult',
          toolCallId: 'role-layout-tool-call',
          toolName: 'write',
          content: [{ type: 'text', text: '已写入示例文件' }]
        }
      },
      {
        type: 'message',
        id: 'role-layout-empty-assistant',
        parentId: 'role-layout-tool-result',
        timestamp: '2026-09-28T12:00:00.750Z',
        message: {
          role: 'assistant',
          model: 'gpt-5',
          provider: 'openai',
          stopReason: 'stop',
          content: [{ type: 'text', text: '   \n' }]
        }
      },
      {
        type: 'message',
        id: 'role-layout-assistant',
        parentId: 'role-layout-empty-assistant',
        timestamp: '2026-09-28T12:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'gpt-5',
          provider: 'openai',
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: '已将用户消息放到右侧，并为用户与 Agent 使用不同的背景、边框和角色标签。\n\n- 用户：强调色气泡\n- Agent：中性面板气泡'
            }
          ]
        }
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )
}
