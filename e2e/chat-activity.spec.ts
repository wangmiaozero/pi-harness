import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from './fixtures'
import { IPC_EVENT } from '../src/shared/ipc/channels'
import type { AgentMessage } from '../src/shared/types/workspace'

const sessionId = '01a1-compact-tool-activity'
const test = base.extend({
  piAgentDir: async ({ testUserData, workspaceRoot }, use) => {
    const directory = path.join(testUserData, 'activity-pi')
    fs.cpSync(path.resolve(import.meta.dirname, '../fixtures/mock-pi'), directory, {
      recursive: true
    })
    fs.writeFileSync(
      path.join(testUserData, 'settings.json'),
      JSON.stringify({ theme: 'dark', language: 'zh-CN' })
    )
    seed(directory, workspaceRoot)
    await use(directory)
  }
})

test('shows compact activity with two independent expansion levels', async ({
  page,
  electronApp
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('a[href="#/workspace"]').click()
  await page
    .getByTestId(`session-row-${sessionId}`)
    .getByRole('button', { name: /^检查项目的类型错误/ })
    .click()
  const chat = page.getByTestId('chat-scroller')
  await expect(chat.getByText('我先读取配置文件，再检查类型。', { exact: true })).toBeVisible()
  await expect(chat.getByText('检查完成，请修复示例中的类型错误。', { exact: true })).toBeVisible()
  await expect(chat.getByTestId('assistant-turn')).toHaveCount(1)
  await expect(chat.locator('[data-message-role="assistant"] .message-role-badge')).toHaveCount(1)
  await expect(chat.getByTestId('copy-assistant-message')).toHaveCount(1)
  const group = chat.getByTestId('message-activity')
  await expect(group).toHaveCount(1)
  await expect(group).not.toHaveAttribute('open')
  await expect(group.locator('summary').first()).toContainText('已读取文件')
  await expect(group.locator('summary').first()).toContainText('已运行命令')
  await expect(group.locator('summary').first()).toContainText('失败')
  await expect(chat.locator('pre')).toHaveCount(0)
  const compaction = chat.getByTestId('compaction-details')
  await expect(compaction).not.toHaveAttribute('open')
  await expect(compaction.locator('summary')).toHaveText(/上下文.*压缩|压缩.*完成/)
  await expect(chat).not.toContainText('Internal context summary')
  await page.screenshot({ path: testInfo.outputPath('activity-collapsed.png') })

  await group.locator('summary').first().click()
  const tools = group.locator('.tool-call-hud')
  await expect(tools).toHaveCount(3)
  await expect(tools.nth(0).getByText('package.json', { exact: true })).toBeVisible()
  await expect(tools.nth(2).getByText('pnpm typecheck', { exact: true })).toBeVisible()
  await expect(tools.nth(1)).toHaveAttribute('data-outcome', 'no-match')
  await expect(tools.nth(1).locator('summary')).toContainText('未找到结果')
  await expect(group).toHaveAttribute('data-outcome', 'completed-with-errors')
  await expect(chat.locator('pre')).toHaveCount(0)
  await expect(group.getByTestId('thinking-details')).not.toHaveAttribute('open')
  await page.screenshot({ path: testInfo.outputPath('activity-first-level.png') })

  const summaryY = Math.round((await tools.nth(2).locator('summary').boundingBox())!.y)
  await tools.nth(2).locator('summary').click()
  await expect(tools.nth(2).locator('pre').last()).toContainText('TS2322: Type mismatch')
  await expect(tools.nth(0).locator('pre')).toHaveCount(0)
  await expect
    .poll(async () => Math.round((await tools.nth(2).locator('summary').boundingBox())!.y))
    .toBe(summaryY)
  await expect(chat.locator('[data-message-role="toolResult"]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('activity-second-level.png') })
  await group.locator('summary').first().click()
  await expect(tools.nth(2).locator('pre').last()).toBeHidden()
  await group.locator('summary').first().click()
  await expect(tools.nth(2).locator('pre').last()).toBeVisible()

  // Native tool-result images remain available behind the same disclosure.
  await tools.nth(0).locator('summary').click()
  await expect(tools.nth(0).locator('img')).toHaveAttribute('src', /^data:image\/gif;base64,/)
  await tools.nth(0).getByRole('button', { name: '预览图片' }).click()
  await expect(page.getByRole('dialog', { name: '预览图片' })).toBeVisible()
  await page
    .getByRole('dialog', { name: '预览图片' })
    .getByRole('button', { name: '关闭', exact: true })
    .click()

  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden()
  await expect(page.getByTestId('message-activity')).not.toHaveAttribute('open')
  await expect(page.getByTestId('chat-scroller').locator('pre')).toHaveCount(0)
  // Exercise the real event → store → presentation path without a model request.
  async function emit(event: Record<string, unknown>) {
    await electronApp.evaluate(
      ({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('#/workspace'))!
          .webContents.send(payload.channel, { sessionId: payload.sessionId, event: payload.event })
      },
      { channel: IPC_EVENT.agentEvent, sessionId, event }
    )
  }
  await emit({ type: 'agent_start' })
  await expect(chat.getByTestId('assistant-loading')).toBeVisible()
  await emit({
    type: 'message_end',
    message: {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      content: [
        {
          type: 'toolCall',
          toolCallId: 'live-tool',
          toolName: 'bash',
          input: { command: 'pnpm check-live' }
        }
      ]
    }
  })
  const live = page.getByTestId('message-activity').last()
  await expect(live.locator('summary').first()).toContainText('正在运行')
  await expect(live).not.toHaveAttribute('open')
  await live.locator('summary').first().focus()
  await page.keyboard.press('Enter')
  const liveTool = live.locator('.tool-call-hud')
  await expect(liveTool).not.toHaveAttribute('open')
  await liveTool.locator('summary').click()
  await emit({
    type: 'message_end',
    message: {
      role: 'toolResult',
      toolCallId: 'live-tool',
      toolName: 'bash',
      content: [{ type: 'text', text: 'Live checks passed' }]
    }
  })
  await expect(live.locator('summary').first()).toContainText('已运行命令')
  await expect(liveTool.locator('pre').last()).toHaveText('Live checks passed')
  await expect(live).toHaveAttribute('open')
  await expect(liveTool).toHaveAttribute('open')
  await expect(page.getByTestId('assistant-turn')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('shows loading before content and follows final output unless the user scrolls up', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('a[href="#/workspace"]').click()
  await page
    .getByTestId(`session-row-${sessionId}`)
    .getByRole('button', { name: /^检查项目的类型错误/ })
    .click()
  const chat = page.getByTestId('chat-scroller')
  await expect(chat.getByText('检查完成，请修复示例中的类型错误。', { exact: true })).toBeVisible()
  const directory = path.join(
    piAgentDir,
    'sessions',
    `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  const file = path.join(
    directory,
    fs.readdirSync(directory).find((name) => name.endsWith('.jsonl'))!
  )
  let parentId = `activity-${fs.readFileSync(file, 'utf8').trim().split('\n').length - 2}`
  async function emit(event: Record<string, unknown>) {
    await electronApp.evaluate(
      ({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('#/workspace'))!
          .webContents.send(payload.channel, { sessionId: payload.sessionId, event: payload.event })
      },
      { channel: IPC_EVENT.agentEvent, sessionId, event }
    )
  }
  function persist(message: AgentMessage, id: string) {
    fs.appendFileSync(
      file,
      JSON.stringify({
        type: 'message',
        id,
        parentId,
        timestamp: new Date().toISOString(),
        message
      }) + '\n'
    )
    parentId = id
  }
  const distance = () => chat.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
  for (const readingHistory of [false, true]) {
    const user: AgentMessage = { role: 'user', content: `Loading and scrolling ${readingHistory}` }
    persist(user, `loading-user-${readingHistory}`)
    await emit({ type: 'agent_start' })
    await emit({ type: 'message_end', message: user })
    const spinner = chat.getByTestId('assistant-loading')
    await expect(spinner).toBeVisible()
    await expect(spinner).toHaveClass(/animate-spin/)
    await expect(chat.getByTestId('assistant-turn')).toHaveCount(readingHistory ? 3 : 2)
    const reply: AgentMessage = {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      stopReason: 'stop',
      content: [
        {
          type: 'text',
          text: `| Row | Value |\n| --- | --- |\n${Array.from({ length: 90 }, (_, i) => `| ${i} | Markdown output |`).join('\n')}\n\nFinal output ${readingHistory}`
        }
      ]
    }
    await emit({ type: 'message_start', message: reply })
    await expect.poll(distance).toBeLessThanOrEqual(24)
    if (readingHistory) {
      await chat.hover()
      await page.mouse.wheel(0, -650)
      await expect.poll(distance).toBeGreaterThan(100)
    }
    persist(reply, `loading-reply-${readingHistory}`)
    await emit({ type: 'message_end', message: reply })
    await emit({ type: 'prompt_done', success: true })
    await expect(spinner).toHaveCount(0)
    await expect(chat).toContainText(`Final output ${readingHistory}`)
    if (readingHistory) await expect.poll(distance).toBeGreaterThan(100)
    else await expect.poll(distance).toBeLessThanOrEqual(24)
  }
  await page.getByRole('button', { name: '滚动到底部', exact: true }).click()
  await expect.poll(distance).toBeLessThanOrEqual(24)
  await expect(chat.getByTestId('assistant-turn')).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('reply-complete-at-bottom.png') })
})

function seed(directory: string, cwd: string) {
  const timestamp = '2026-10-27T12:00:00.000Z'
  const messages: AgentMessage[] = [
    { role: 'user', content: '检查项目的类型错误' },
    {
      role: 'custom',
      customType: 'compaction',
      display: true,
      content: 'Internal context summary\n' + 'Long context\n'.repeat(80)
    },
    {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      content: [{ type: 'text', text: '我先读取配置文件，再检查类型。' }]
    },
    {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      content: [
        { type: 'thinking', thinking: '先检查配置，再运行类型检查。' },
        {
          type: 'toolCall',
          toolCallId: 'read-config',
          toolName: 'read',
          input: { path: 'package.json' }
        }
      ]
    },
    {
      role: 'toolResult',
      toolCallId: 'read-config',
      toolName: 'read',
      content: [
        { type: 'text', text: '{"scripts":{"typecheck":"tsc --noEmit"}}' },
        {
          type: 'image',
          mimeType: 'image/gif',
          data: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
        }
      ]
    },
    {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      content: [
        {
          type: 'toolCall',
          toolCallId: 'empty-search',
          toolName: 'bash',
          input: { command: 'rg -n "missing|absent" package.json' }
        }
      ]
    },
    {
      role: 'toolResult',
      toolCallId: 'empty-search',
      toolName: 'bash',
      isError: true,
      content: [{ type: 'text', text: 'Command exited with code 1' }]
    },
    {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      content: [
        {
          type: 'toolCall',
          toolCallId: 'typecheck',
          toolName: 'bash',
          input: { command: 'pnpm typecheck' }
        }
      ]
    },
    {
      role: 'toolResult',
      toolCallId: 'typecheck',
      toolName: 'bash',
      isError: true,
      content: [
        { type: 'text', text: `TS2322: Type mismatch\n${'diagnostic detail\n'.repeat(60)}` }
      ]
    },
    {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      stopReason: 'stop',
      content: [{ type: 'text', text: '检查完成，请修复示例中的类型错误。' }]
    }
  ]
  const sessionDir = path.join(
    directory,
    'sessions',
    `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, `${timestamp.replaceAll(':', '-')}_${sessionId}.jsonl`),
    [
      { type: 'session', version: 3, id: sessionId, timestamp, cwd },
      ...messages.map((message, index) => ({
        type: 'message',
        id: `activity-${index}`,
        parentId: index ? `activity-${index - 1}` : null,
        timestamp,
        message
      }))
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )
}
