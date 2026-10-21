import fs from 'node:fs'
import path from 'node:path'
import type { Page, ElectronApplication } from '@playwright/test'
import { expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

/** Shared by source smoke and installed-package regression: no test-only production hooks. */
export async function verifyFileEditing({
  page,
  electronApp,
  workspaceRoot,
  piAgentDir
}: {
  page: Page
  electronApp: ElectronApplication
  workspaceRoot: string
  piAgentDir: string
}) {
  // The fixture removes this tree after Electron closes its workspace watchers.
  const tempRoot = path.join(workspaceRoot, 'editor')
  const sessionId = '01a026a4-0796-73ff-990a-a2be21983540'
  fs.mkdirSync(tempRoot)
  const filePath = path.join(tempRoot, 'editable.ts')
  fs.mkdirSync(path.join(tempRoot, 'node_modules'))
  fs.writeFileSync(path.join(tempRoot, '.env'), 'TOKEN=test\n')
  fs.writeFileSync(filePath, 'export const value = 1\n')
  seedWorkspaceSession(piAgentDir, tempRoot, sessionId)

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
              title: 'Editor fixture session',
              sessionId: selectedSessionId,
              closable: false
            }
          ],
          activeTabId: `chat:${selectedSessionId}`
        })
      )
    },
    { root: tempRoot, selectedSessionId: sessionId }
  )

  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-toggle-files').click()
  await expect(page.getByRole('button', { name: 'node_modules', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '.env', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'editable.ts', exact: true }).click()

  const editor = page.getByTestId('file-code-view').locator('.cm-content')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('export const value = 2\n')
  await page.getByTestId('workspace-collapse-files').click()
  await expect(page.getByTestId('workspace-files-panel')).toHaveCount(0)
  await page.getByTestId('workspace-toggle-files').click()
  await expect(editor).toContainText('export const value = 2')
  const save = page.getByTestId('file-save')
  await expect(save).toBeEnabled()
  // Delay the real write reply to reproduce typing before an earlier save completes.
  await electronApp.evaluate(({ ipcMain }, channel) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>
      }
    )._invokeHandlers
    const original = handlers.get(channel)!
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args) => {
      const result = await original(...args)
      await gate
      return result
    })
    ;(globalThis as typeof globalThis & { releaseFileWrite?: () => void }).releaseFileWrite =
      () => {
        release()
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, original)
      }
  }, IPC_INVOKE.filesWrite)
  await save.click()
  await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('export const value = 2\n')
  await expect(save).toBeDisabled()

  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('export const value = 3\n')
  await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { releaseFileWrite?: () => void }
    state.releaseFileWrite!()
    delete state.releaseFileWrite
  })
  await expect(editor).toContainText('export const value = 3')
  await expect(save).toBeEnabled()
  const savedPreview = await page.evaluate((path) => window.piSwitch.files.read(path), filePath)
  expect(savedPreview).toMatchObject({ kind: 'text', text: 'export const value = 2\n' })
  fs.writeFileSync(filePath, 'external change\n')
  expect(fs.readFileSync(filePath, 'utf8')).toBe('external change\n')
  const externalPreview = await page.evaluate((path) => window.piSwitch.files.read(path), filePath)
  expect(externalPreview).toMatchObject({ kind: 'text', text: 'external change\n' })
  expect(externalPreview.revision).not.toBe(savedPreview.revision)
  const conflict = await page.evaluate(
    async ({ path, revision }) => {
      try {
        const result = await window.piSwitch.files.write(path, 'probe', revision)
        return { ok: true as const, result }
      } catch (error) {
        const ipcError = error as { code?: string; message?: string }
        return {
          ok: false as const,
          code: ipcError.code ?? null,
          message: ipcError.message ?? null
        }
      }
    },
    { path: filePath, revision: savedPreview.revision! }
  )
  expect(conflict).toMatchObject({ ok: false, code: 'FILE_CONFLICT' })
  await save.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(/文件已被外部修改|File changed externally/)
  await dialog.getByRole('button', { name: /取消|Cancel/ }).click()
  expect(fs.readFileSync(filePath, 'utf8')).toBe('external change\n')

  await save.click()
  await dialog.getByRole('button', { name: /覆盖文件|Overwrite file/ }).click()
  await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('export const value = 3\n')
}

export function seedWorkspaceSession(
  agentDir: string,
  cwd: string,
  sessionId: string,
  label = 'Fixture session'
) {
  const safePath = `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(agentDir, 'sessions', safePath)
  const timestamp = '2026-08-29T05:00:00.000Z'
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, `2026-08-29T05-00-00-000Z_${sessionId}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd }),
      JSON.stringify({
        type: 'message',
        id: '01a026a4-0796-73ff-990a-a2be2198353d',
        parentId: null,
        timestamp,
        message: { role: 'user', content: label, timestamp: Date.parse(timestamp) }
      })
    ].join('\n') + '\n'
  )
}
