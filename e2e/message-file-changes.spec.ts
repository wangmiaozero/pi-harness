import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from './fixtures'

const sessionId = '01a0ddce-5d0b-75b1-bb98-filechanges'
const runId = 'h:user-file-changes'

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
      runIds: [runId],
      artifactIds: ['artifact-app', 'artifact-state', 'artifact-types', 'artifact-view'].sort()
    })
  const card = page.getByTestId('message-file-changes')
  await expect(card).toBeVisible()
  await expect(card).toContainText(/已编辑 4 个文件|Edited 4 files/)
  await expect(card.locator('[data-testid^="message-file-change-"]')).toHaveCount(3)

  await card.getByTestId('message-file-changes-expand').click()
  await expect(card.locator('[data-testid^="message-file-change-"]')).toHaveCount(4)

  const qaDir = process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir
  fs.mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: path.join(qaDir, 'message-file-changes-card.png') })

  await card.getByTestId('message-file-change-artifact-app').click()
  await expect(page.getByTestId('unified-diff-preview')).toBeVisible()
  await expect(page.getByTestId('unified-diff-preview')).toContainText('const answer = 42')
  await expect(page.locator('[data-tab-id^="diff:"]')).toContainText('src/app.ts')
  await page.screenshot({ path: path.join(qaDir, 'message-file-changes-diff.png') })

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

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
        message: { role: 'user', content: '实现文件改动预览卡片', timestamp: Date.parse(timestamp) }
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
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )
}

function seedHarnessData(testUserData: string, workspaceRoot: string) {
  const startedAt = Date.parse('2026-09-27T08:00:00.000Z')
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
