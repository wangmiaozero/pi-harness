import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

async function dragFilesPanelToLimit(
  page: import('@playwright/test').Page,
  delta: number
): Promise<void> {
  const resizer = page.getByTestId('workspace-files-resizer')
  const box = (await resizer.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(180, box.height / 2))
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + Math.min(180, box.height / 2), {
    steps: 5
  })
  await page.mouse.up()
}

test('file panel keeps navigation and chat visible, isolates sessions, and adapts to narrow windows', async ({
  page,
  workspaceRoot,
  piAgentDir
}) => {
  const projectA = path.join(workspaceRoot, 'project-a')
  const projectB = path.join(workspaceRoot, 'project-b')
  const sessionA = '01a026a4-0796-73ff-990a-a2be219835ab'
  const sessionB = '01a026a4-0796-73ff-990a-a2be219835ac'
  for (const [root, id, title, file] of [
    [projectA, sessionA, 'Conversation A', 'a-only.ts'],
    [projectB, sessionB, 'Conversation B', 'b-only.ts']
  ]) {
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, file), `export const project = '${title}'\n`)
    const dir = path.join(
      piAgentDir,
      'sessions',
      `--${path
        .resolve(root)
        .replace(/^[/\\]/, '')
        .replace(/[/\\:]/g, '-')}--`
    )
    fs.mkdirSync(dir, { recursive: true })
    const timestamp = '2026-08-30T05:00:00.000Z'
    fs.writeFileSync(
      path.join(dir, `2026-08-30T05-00-00-000Z_${id}.jsonl`),
      [
        JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd: root }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp,
          message: { role: 'user', content: title, timestamp: Date.parse(timestamp) }
        })
      ].join('\n') + '\n'
    )
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page
    .getByTestId(`session-row-${sessionA}`)
    .getByRole('button', { name: 'Conversation A', exact: true })
    .click()
  await expect(page.getByTestId('workspace-new-session')).toBeEnabled()
  await page.getByTestId('workspace-toggle-files').click()
  const tree = page.getByTestId('workspace-file-tree')
  const panel = page.getByTestId('workspace-files-panel')
  const navigation = page.getByTestId('workspace-session-tree')
  const composer = page.getByTestId('chat-composer')
  const code = page.getByTestId('file-code-view')
  const resizer = page.getByTestId('workspace-files-resizer')
  const treeMode = page.getByTestId('workspace-files-mode-tree')
  const previewMode = page.getByTestId('workspace-files-mode-preview')

  await expect(treeMode).toHaveAttribute('aria-pressed', 'true')
  await expect(previewMode).toBeDisabled()
  await dragFilesPanelToLimit(page, -1000)
  expect((await panel.boundingBox())!.width).toBe(760)
  await expect(resizer).toHaveAttribute('aria-valuenow', '760')
  await dragFilesPanelToLimit(page, 1000)
  expect((await panel.boundingBox())!.width).toBe(360)
  await expect(resizer).toHaveAttribute('aria-valuenow', '360')
  if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
    await page.screenshot({
      path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'file-panel-min-width.png')
    })
  }
  await resizer.dblclick({ position: { x: 4, y: 120 } })

  await tree.getByRole('button', { name: 'a-only.ts', exact: true }).click()
  await expect(code).toContainText('Conversation A')
  await expect(tree).toHaveCount(0)
  await expect(previewMode).toHaveAttribute('aria-pressed', 'true')
  await treeMode.click()
  await expect(tree).toBeVisible()
  await expect(code).toHaveCount(0)
  await previewMode.click()
  await expect(code).toContainText('Conversation A')
  await expect(navigation).toBeVisible()
  await expect(composer).toBeVisible()
  const [chatBox, panelBox] = await Promise.all([composer.boundingBox(), panel.boundingBox()])
  expect(chatBox!.x + chatBox!.width).toBeLessThanOrEqual(panelBox!.x + 1)

  if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
    await page.screenshot({
      path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'file-panel-wide.png')
    })
  }

  await page.setViewportSize({ width: 900, height: 780 })
  await expect(composer).toBeVisible()
  await expect(navigation).toBeVisible()
  await expect(code).toBeVisible()
  await expect(resizer).toBeHidden()
  const [narrowChat, narrowPanel] = await Promise.all([composer.boundingBox(), panel.boundingBox()])
  expect(narrowChat!.y + narrowChat!.height).toBeLessThanOrEqual(narrowPanel!.y + 1)
  expect(narrowPanel!.x + narrowPanel!.width).toBeLessThanOrEqual(900)
  if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
    await page.screenshot({
      path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'file-panel-narrow.png')
    })
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(resizer).toBeVisible()
  await page
    .getByTestId(`session-row-${sessionB}`)
    .getByRole('button', { name: 'Conversation B', exact: true })
    .click()
  await expect(tree.getByRole('button', { name: 'b-only.ts', exact: true })).toBeVisible()
  await expect(tree.getByRole('button', { name: 'a-only.ts', exact: true })).toHaveCount(0)
  await expect(code).toHaveCount(0)
  await tree.getByRole('button', { name: 'b-only.ts', exact: true }).click()
  await expect(code).toContainText('Conversation B')
  await expect(panel).not.toContainText('a-only.ts')
  await expect(page.getByTestId('workspace-tabs').getByRole('button')).toHaveCount(2)

  await page
    .getByTestId(`session-row-${sessionA}`)
    .getByRole('button', { name: 'Conversation A', exact: true })
    .click()
  await expect(code).toContainText('Conversation A')
  await expect(panel).not.toContainText('b-only.ts')
  await page.getByTestId('workspace-new-session').click()
  await expect(page.getByTestId('workspace-files-unavailable')).toBeVisible()
  await expect(tree).toHaveCount(0)
  await expect(code).toHaveCount(0)
  await expect(navigation).toBeVisible()
  await expect(page.getByTestId('workspace-toggle-files')).toHaveAttribute('aria-expanded', 'true')
})
