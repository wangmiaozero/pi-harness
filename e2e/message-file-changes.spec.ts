import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect, type Page } from './fixtures'
import { MASCOT_STYLES } from '../src/shared/constants/mascot'
import { APP_THEMES } from '../src/shared/constants/theme'

async function settleStartup(page: Page): Promise<void> {
  const startup = page.getByTestId('startup-animation')
  const cinematic = page.locator('html[data-cinematic-startup="on"]')
  const splash = page.locator('#dsh-startup-root')
  const video = page.locator('.dsvs-boot')
  await expect(startup).toBeHidden()
  if ((await cinematic.count()) === 0) return
  await expect(splash.or(video)).toBeVisible()
  if ((await splash.count()) > 0) {
    await page.keyboard.press('Escape')
    await expect(splash).toHaveCount(0)
  }
  if ((await video.count()) > 0) {
    await expect(video).toHaveCSS('z-index', '2147483647')
    await page.keyboard.press('Escape')
    await expect(video).toHaveCount(0)
  }
  await expect(cinematic).toHaveCount(0)
  await expect(startup).toBeHidden()
}

const sessionId = '01a0ddce-5d0b-75b1-bb98-filechanges'
const runId = 'h:user-file-changes'
const missingEvidenceRunId = 'h:user-no-write'

const test = base.extend({
  piAgentDir: async ({ testUserData, workspaceRoot }, use) => {
    const root = path.resolve(import.meta.dirname, '..')
    const piAgentDir = path.join(testUserData, 'mock-pi-file-changes')
    fs.cpSync(path.join(root, 'fixtures', 'mock-pi'), piAgentDir, { recursive: true })
    seedSession(piAgentDir, workspaceRoot)
    seedHarnessData(testUserData, workspaceRoot)
    await use(piAgentDir)
  }
})

test('shows final-response file changes and opens the selected diff preview', async ({
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
  await openFixture(page, workspaceRoot)
  await expect
    .poll(() =>
      page.evaluate(async (selectedSessionId) => {
        const [runs, artifacts] = await Promise.all([
          window.piSwitch.harness.listRuns(selectedSessionId),
          window.piSwitch.harness.listArtifacts(selectedSessionId)
        ])
        return {
          runIds: runs.map((run) => run.id).sort(),
          artifactIds: artifacts.map((artifact) => artifact.id).sort()
        }
      }, sessionId)
    )
    .toEqual({
      runIds: [missingEvidenceRunId, runId].sort(),
      artifactIds: ['artifact-app', 'artifact-state', 'artifact-types', 'artifact-view'].sort()
    })
  const card = page.getByTestId('message-file-changes').first()
  await expect(card).toBeVisible()
  await expect(card).toContainText(/已编辑 4 个文件|Edited 4 files/)
  await expect(card.locator('[data-testid^="message-file-change-"]')).toHaveCount(3)

  await card.getByTestId('message-file-changes-expand').click()
  await expect(card.locator('[data-testid^="message-file-change-"]')).toHaveCount(4)

  const qaDir = process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir
  fs.mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: path.join(qaDir, 'message-file-changes-card.png') })

  const missingEvidence = page.getByTestId('message-file-changes-missing')
  await expect(missingEvidence).toBeVisible()
  await expect(missingEvidence).toContainText(/未检测到文件改动|No file changes detected/)
  await page.screenshot({ path: path.join(qaDir, 'message-file-changes-missing.png') })

  await card.getByTestId('message-file-change-artifact-app').click()
  await expect(page.getByTestId('unified-diff-preview')).toBeVisible()
  await expect(page.getByTestId('unified-diff-preview')).toContainText('const answer = 42')
  await expect(page.getByTestId('run-changes-preview')).toContainText('src/app.ts')
  await expect(page.getByTestId('chat-window')).toBeVisible()
  await page.getByTestId('changes-reveal-file').click()
  await expect(page.locator('[data-file-path][aria-current="true"]')).toHaveText('app.ts')
  const elapsed = page.getByTestId('assistant-turn-duration').first()
  await expect(elapsed).toContainText('0:03')
  await elapsed.click()
  await expect(page.getByTestId('message-activity').first()).toBeVisible()
  await expect(card.getByTestId('message-file-changes-undo')).toBeEnabled()
  await card.getByTestId('message-file-changes-undo').click()
  await page.getByRole('dialog').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(card.getByTestId('message-file-changes-undo')).toHaveText('已撤销')
  expect(fs.readFileSync(path.join(workspaceRoot, 'src/app.ts'), 'utf8')).toBe(
    'export const before = true\n'
  )
  await page.screenshot({ path: path.join(qaDir, 'message-file-changes-diff.png') })

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('scene transcripts, titlebar actions and minimum sidebar width stay usable in every skin', async ({
  page,
  workspaceRoot
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.piSwitch.settings.unlockMascot('1024'))
  await openFixture(page, workspaceRoot)
  for (const mascotStyle of MASCOT_STYLES) {
    await page.evaluate(
      (mascotStyle) => window.piSwitch.settings.set({ mascotStyle, theme: 'dark' }),
      mascotStyle
    )
    await page.reload()
    await settleStartup(page)
    await expect(page.getByTestId('message-file-changes').first()).toBeVisible()
    await page.getByTestId('chat-scroller').dispatchEvent('wheel', { deltaY: -1000 })
    await page.getByTestId('chat-scroller').evaluate((node) => {
      node.scrollTop = 0
    })
    const user = page.locator('.chat-scroll-content [data-message-role="user"]').first()
    await expect(user).toBeInViewport()
    if (mascotStyle !== 'none') {
      const styles = await user.evaluate((node) => {
        const css = getComputedStyle(node)
        return {
          border: css.borderTopWidth,
          background: css.backgroundColor,
          shadow: css.boxShadow
        }
      })
      expect(styles).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)', shadow: 'none' })
      const inner = await user
        .locator('.user-message-body')
        .evaluate((node) => ({
          border: getComputedStyle(node).borderTopWidth,
          background: getComputedStyle(node).backgroundColor
        }))
      expect(inner).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)' })
      expect(
        await page
          .locator('.chat-scroll-content')
          .evaluate((node) => getComputedStyle(node).borderTopWidth)
      ).toBe('1px')
    }
    const settings = page.getByTestId('navigation-settings')
    expect(
      await settings.evaluate((node) => {
        const box = node.getBoundingClientRect()
        return node.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        )
      })
    ).toBe(true)
    const toggle = page.getByTestId('workspace-sidebar-toggle')
    await expect(toggle).toBeVisible()
    for (const brand of await page
      .locator('.app-titlebar-brand-button, .starship-titlebar-identity')
      .all()) {
      if (!(await brand.isVisible())) continue
      const a = (await toggle.boundingBox())!,
        b = (await brand.boundingBox())!
      expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)).toBeLessThanOrEqual(0)
    }
    if (mascotStyle === 'starshipCockpit') {
      const bounds = await page.locator('.starship-engine-hud').evaluate((node) => {
        const sidebar = node.closest('[data-testid="workspace-sidebar"]')!.getBoundingClientRect()
        const box = node.getBoundingClientRect()
        return { within: box.left >= sidebar.left && box.right <= sidebar.right + 1 }
      })
      expect(bounds.within).toBe(true)
    }
    await expect(
      page.locator('#titlebar-workspace-actions').getByTestId('workspace-toggle-files')
    ).toBeVisible()
    const controls = page.locator('.command-console-controls')
    expect(
      await controls.evaluate((node) => {
        const row = node.getBoundingClientRect()
        const buttons = [...node.querySelectorAll('button')].filter(
          (button) => button.getBoundingClientRect().width > 0
        )
        const first = buttons[0].getBoundingClientRect()
        const center = first.y + first.height / 2
        return buttons.every((button) => {
          const box = button.getBoundingClientRect()
          return (
            box.left >= row.left &&
            box.right <= row.right + 1 &&
            Math.abs(box.y + box.height / 2 - center) < 2
          )
        })
      })
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`content-${mascotStyle}.png`) })
    const separator = page.getByTestId('workspace-sidebar-resizer')
    await separator.focus()
    await page.keyboard.press('Home')
    const heading = page.getByTestId('workspace-new-session').locator('span')
    expect(
      await heading.evaluate((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        return range.getClientRects().length
      })
    ).toBe(1)
    await expect(page.getByTestId('workspace-search')).toBeVisible()
    await page.getByTestId('workspace-search').click()
    const input = page.getByTestId('palette-input')
    await expect(input).toBeFocused()
    expect(await input.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
    await page.keyboard.press('Escape')
    await expect(input).toBeHidden()
    await settings.click()
    await expect(page).toHaveURL(/#\/settings\//)
    await page.locator('a[href="#/workspace"]').click()
  }
})

test('conversation layout stays contained in every appearance', async ({
  page,
  workspaceRoot
}, testInfo) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page, workspaceRoot)
  for (const theme of APP_THEMES) {
    await page.evaluate(
      (theme) => window.piSwitch.settings.set({ mascotStyle: 'none', theme }),
      theme
    )
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden()
    await expect(page.getByTestId('message-file-changes').first()).toBeVisible()
    expect(
      await page
        .getByTestId('chat-window')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`appearance-${theme}.png`) })
  }
})

test('Zhang decorations stay outside the transcript and composer', async ({
  page,
  workspaceRoot
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.piSwitch.settings.unlockMascot('1024'))
  await openFixture(page, workspaceRoot)
  await page.evaluate(() => window.piSwitch.settings.set({ mascotStyle: 'zhangJuzhengSnow' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden()
  await expect(page.getByTestId('message-file-changes').first()).toBeVisible()
  await page.getByTestId('chat-scroller').dispatchEvent('wheel', { deltaY: -1000 })
  await page.getByTestId('chat-scroller').evaluate((node) => {
    node.scrollTop = 0
  })
  await expect(page.getByTestId('zhang-edge-scroll-top')).toBeHidden()
  const vow = (await page.getByTestId('zhang-juzheng-vow').boundingBox())!
  const composer = (await page.getByTestId('chat-composer').boundingBox())!
  expect(vow.y + vow.height).toBeLessThanOrEqual(composer.y)
  await page.screenshot({ path: testInfo.outputPath('zhang-content.png') })
  await page.getByTestId('workspace-search').click()
  await expect(page.getByTestId('palette-input')).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('zhang-search.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-input')).toBeHidden()
})

async function openFixture(page: Page, workspaceRoot: string) {
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
              title: 'File changes',
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
}

function seedSession(piAgentDir: string, workspaceRoot: string) {
  const safePath = `--${path
    .resolve(workspaceRoot)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(piAgentDir, 'sessions', safePath)
  const timestamp = '2026-09-27T08:00:00.000Z'
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true })
  for (const file of ['app.ts', 'state.ts', 'types.ts', 'view.vue']) {
    fs.writeFileSync(path.join(workspaceRoot, 'src', file), 'export const before = true\n')
  }
  fs.writeFileSync(
    path.join(sessionDir, `2026-09-27T08-00-00-000Z_${sessionId}.jsonl`),
    [
      { type: 'session', version: 3, id: sessionId, timestamp, cwd: workspaceRoot },
      {
        type: 'message',
        id: 'user-file-changes',
        parentId: null,
        timestamp,
        message: {
          role: 'user',
          content: Array.from(
            { length: 8 },
            (_, i) =>
              `第 ${i + 1} 项：检查当前工作区的主题和消息排版，保留现有文件、会话和工具功能。`
          ).join('\n\n'),
          timestamp: Date.parse(timestamp)
        }
      },
      {
        type: 'message',
        id: 'assistant-tool',
        parentId: 'user-file-changes',
        timestamp: '2026-09-27T08:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'gpt-5',
          provider: 'openai',
          content: [
            {
              type: 'toolCall',
              toolCallId: 'write-1',
              toolName: 'write',
              input: { path: 'src/app.ts', content: 'export const answer = 42\n' }
            }
          ]
        }
      },
      {
        type: 'message',
        id: 'tool-result',
        parentId: 'assistant-tool',
        timestamp: '2026-09-27T08:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'write-1',
          toolName: 'write',
          content: [{ type: 'text', text: 'Wrote src/app.ts' }]
        }
      },
      {
        type: 'message',
        id: 'assistant-final',
        parentId: 'tool-result',
        timestamp: '2026-09-27T08:00:03.000Z',
        message: {
          role: 'assistant',
          model: 'gpt-5',
          provider: 'openai',
          stopReason: 'stop',
          content: [{ type: 'text', text: '已完成文件改动预览。' }]
        }
      },
      {
        type: 'message',
        id: 'user-no-write',
        parentId: 'assistant-final',
        timestamp: '2026-09-27T08:00:04.000Z',
        message: {
          role: 'user',
          content: '在当前目录生成 pelican-bike.html',
          timestamp: Date.parse('2026-09-27T08:00:04.000Z')
        }
      },
      {
        type: 'message',
        id: 'assistant-no-write',
        parentId: 'user-no-write',
        timestamp: '2026-09-27T08:00:05.000Z',
        message: {
          role: 'assistant',
          model: 'step-3.7-flash',
          provider: 'step-plan',
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: '我已经在当前目录下生成了完整页面，文件名为 `pelican-bike.html`。'
            }
          ]
        }
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )
}

function seedHarnessData(testUserData: string, workspaceRoot: string) {
  const startedAt = Date.parse('2026-09-27T08:00:00.000Z')
  fs.mkdirSync(path.join(testUserData, 'file-undo'), { recursive: true })
  fs.writeFileSync(
    path.join(testUserData, 'file-undo', 'snapshots.json'),
    JSON.stringify({
      runs: [
        {
          sessionId,
          runId,
          sealed: true,
          unsupported: false,
          files: [
            {
              path: path.join(workspaceRoot, 'src/app.ts'),
              before: 'export const before = true\n',
              after: 'export const answer = 42\n'
            }
          ]
        }
      ]
    })
  )
  fs.writeFileSync(path.join(workspaceRoot, 'src/app.ts'), 'export const answer = 42\n')
  fs.writeFileSync(
    path.join(testUserData, 'harness-runs.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runs: [
          {
            id: runId,
            sessionId,
            parentRunId: null,
            relation: 'original',
            forkedFromRunId: null,
            forkedFromEventId: null,
            forkedFromCheckpointId: null,
            status: 'success',
            source: 'history',
            anchorEntryId: 'user-file-changes',
            cwd: workspaceRoot,
            agentId: null,
            taskId: null,
            orchestrationId: null,
            startedAt,
            finishedAt: startedAt + 3_000,
            model: 'gpt-5',
            provider: 'openai',
            prompt: '实现文件改动预览卡片',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              totalTokens: 0,
              estimatedCost: null
            },
            toolCallCount: 1,
            toolFailureCount: 0,
            contextUsage: null,
            result: '已完成文件改动预览。',
            error: null,
            budgetExceeded: null,
            steps: [],
            checkpointIds: []
          },
          {
            id: missingEvidenceRunId,
            sessionId,
            parentRunId: runId,
            relation: 'original',
            forkedFromRunId: null,
            forkedFromEventId: null,
            forkedFromCheckpointId: null,
            status: 'success',
            source: 'history',
            anchorEntryId: 'user-no-write',
            cwd: workspaceRoot,
            agentId: null,
            taskId: null,
            orchestrationId: null,
            startedAt: startedAt + 4_000,
            finishedAt: startedAt + 5_000,
            model: 'step-3.7-flash',
            provider: 'step-plan',
            prompt: '在当前目录生成 pelican-bike.html',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              totalTokens: 0,
              estimatedCost: null
            },
            toolCallCount: 0,
            toolFailureCount: 0,
            contextUsage: null,
            result: '我已经在当前目录下生成了完整页面，文件名为 pelican-bike.html。',
            error: null,
            budgetExceeded: null,
            steps: [],
            checkpointIds: []
          }
        ]
      },
      null,
      2
    )}\n`
  )

  const files = [
    ['artifact-app', 'src/app.ts', 2, 1, 'const answer = 42'],
    ['artifact-state', 'src/state.ts', 8, 2, 'const state = true'],
    ['artifact-types', 'src/types.ts', 4, 0, 'type Ready = true'],
    ['artifact-view', 'src/view.vue', 12, 3, '<template>Ready</template>']
  ] as const
  const artifacts = files.map(([id, relativePath, additions, deletions, addedLine], index) => ({
    id,
    runId,
    sessionId,
    type: 'file',
    name: path.basename(relativePath),
    path: relativePath,
    createdAt: Date.parse('2026-09-27T08:00:01.000Z') + index,
    sourceEventId: null,
    producedByAgentId: null,
    producedByTaskId: null,
    consumedByAgentIds: [],
    consumedByTaskIds: [],
    metadata: {
      mutation: 'write/edit',
      resolvedPath: path.join(workspaceRoot, relativePath),
      additions,
      deletions,
      patch: [
        `diff --git a/${relativePath} b/${relativePath}`,
        `--- a/${relativePath}`,
        `+++ b/${relativePath}`,
        '@@ -1 +1 @@',
        '-export const before = true',
        `+${addedLine}`
      ].join('\n'),
      patchTruncated: false
    }
  }))
  fs.writeFileSync(
    path.join(testUserData, 'harness-artifacts.json'),
    `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`
  )
}
