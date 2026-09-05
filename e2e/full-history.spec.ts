import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

test('renders full history inside the themed Pi-Harness dialog', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const sessionId = '01a05784-c8cd-7200-97fb-581f0caf60eb'
  seedHistorySession(piAgentDir, workspaceRoot, sessionId)

  await page.setViewportSize({ width: 1869, height: 1050 })
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()
  await page.locator('[data-mascot-option="starshipCockpit"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-visual-skin', 'starship-cockpit')

  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page
    .getByTestId(`session-row-${sessionId}`)
    .getByRole('button', { name: '历史弹窗样式验证', exact: true })
    .click()
  await expect(page.locator('[data-message-role="assistant"]').first()).toBeVisible()

  const windowCount = electronApp.windows().length
  await page
    .getByTestId('chat-status-hud')
    .getByRole('button', { name: /完整历史|Full history/ })
    .click()

  const dialog = page.getByRole('dialog', { name: /完整历史|Full history/ })
  const history = page.getByTestId('full-history-dialog')
  await expect(dialog).toBeVisible()
  await expect(history).toBeVisible()
  await expect(dialog).toContainText('历史弹窗样式验证')
  await expect(dialog.locator('[data-message-role="user"]')).toHaveCount(13)
  await expect(dialog.locator('[data-message-role="assistant"]')).toHaveCount(12)
  await expect(dialog).not.toContainText(`# ${sessionId}`)
  expect(electronApp.windows()).toHaveLength(windowCount)

  const dialogBox = await dialog.boundingBox()
  expect(dialogBox!.width).toBeLessThanOrEqual(822)
  expect(dialogBox!.height).toBeLessThanOrEqual(0.85 * 1050 + 2)
  await expect
    .poll(() =>
      history.evaluate((element) => {
        const scrollRegion = element.parentElement
        if (!scrollRegion) return false
        const style = getComputedStyle(scrollRegion)
        return style.overflowY === 'auto' && scrollRegion.scrollHeight > scrollRegion.clientHeight
      })
    )
    .toBe(true)

  await page.screenshot({ path: path.join(testInfo.outputDir, 'full-history-starship.png') })
  await dialog.getByRole('button', { name: /关闭|Close/ }).click()
  await expect(dialog).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

function seedHistorySession(agentDir: string, cwd: string, sessionId: string): void {
  const safePath = `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(agentDir, 'sessions', safePath)
  const timestamp = '2026-09-05T08:00:00.000Z'
  const entries: Record<string, unknown>[] = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd }
  ]
  let parentId: string | null = null
  for (let index = 0; index < 13; index += 1) {
    const userId = `history-user-${index}`
    entries.push({
      type: 'message',
      id: userId,
      parentId,
      timestamp,
      message: {
        role: 'user',
        content: index === 0 ? '历史弹窗样式验证' : `第 ${index + 1} 条历史消息`,
        timestamp: Date.parse(timestamp)
      }
    })
    parentId = userId
    if (index === 12) continue
    const assistantId = `history-assistant-${index}`
    entries.push({
      type: 'message',
      id: assistantId,
      parentId,
      timestamp,
      message: {
        role: 'assistant',
        provider: 'volcengine',
        model: 'glm-5.3-flash',
        content: [{ type: 'text', text: `已完成第 ${index + 1} 条记录。` }],
        timestamp: Date.parse(timestamp)
      }
    })
    parentId = assistantId
  }
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, `2026-09-05T08-00-00-000Z_${sessionId}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  )
}
