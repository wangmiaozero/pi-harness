import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from './fixtures'
import { seedWorkspaceSession, verifyFileEditing } from './workspace-fixtures'

test(
  'preserves in-flight edits, saves and external conflict protection in the installed editor',
  verifyFileEditing
)

test('opens files from chat links and confirms before leaving the app', async ({
  page,
  electronApp,
  workspaceRoot,
  piAgentDir
}) => {
  const sessionId = '01a026a4-0796-73ff-990a-a2be21983541'
  const filePath = path.join(workspaceRoot, 'migrations', '002 support.sql')
  const website = 'https://example.invalid/docs?tab=migrations'
  fs.mkdirSync(path.dirname(filePath))
  fs.writeFileSync(filePath, '-- Schema migration\nSELECT 2;\nSELECT 3;\n')
  seedWorkspaceSession(
    piAgentDir,
    workspaceRoot,
    sessionId,
    'Show the migration',
    `[V002 迁移](migrations/002%20support.sql:2) · [Absolute file](${pathToFileURL(filePath).href}#L3) · [Website](${website})`
  )
  await electronApp.evaluate(({ shell }) => {
    const opened: string[] = []
    Reflect.set(globalThis, 'openedChatLinks', opened)
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })

  await page.evaluate(
    async ({ workspaceRoot, sessionId }) => {
      await window.piSwitch.workspace.allowRoot(workspaceRoot)
      localStorage.setItem(
        'pi-harness.workspace.v1',
        JSON.stringify({
          tabs: [
            {
              id: `chat:${sessionId}`,
              kind: 'chat',
              title: 'Migration',
              sessionId,
              closable: false
            }
          ],
          activeTabId: `chat:${sessionId}`
        })
      )
    },
    { workspaceRoot, sessionId }
  )
  await page.locator('a[href="#/workspace"]').click()

  const dialog = page.getByRole('dialog', { name: /打开外部链接|Open external link/ })
  const editor = page.getByTestId('file-code-view')
  await page.getByRole('link', { name: 'V002 迁移' }).click()
  await expect(editor.locator('.cm-line.cm-activeLine')).toHaveText('SELECT 2;')
  await expect(dialog).toBeHidden()

  await page.getByTestId('workspace-files-mode-tree').click()
  await page.getByRole('link', { name: 'Absolute file' }).click()
  await expect(editor.locator('.cm-line.cm-activeLine')).toHaveText('SELECT 3;')

  const link = page.getByRole('link', { name: 'Website' })
  const openedUrls = () => electronApp.evaluate(() => Reflect.get(globalThis, 'openedChatLinks'))
  await link.click()
  await expect(dialog).toContainText(website)
  expect(await openedUrls()).toEqual([])
  await dialog.getByRole('button', { name: /取消|Cancel/ }).click()
  await expect(dialog).toBeHidden()
  expect(await openedUrls()).toEqual([])

  await link.click()
  await dialog.getByRole('button', { name: /打开|Open/ }).click()
  await expect.poll(openedUrls).toEqual([website])

  await page.getByTestId('composer-full-history').click()
  const history = page.getByTestId('full-history-dialog')
  await history.getByRole('link', { name: 'V002 迁移' }).click()
  await expect(history).toBeHidden()
  await expect(editor.locator('.cm-line.cm-activeLine')).toHaveText('SELECT 2;')
})
