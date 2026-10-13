import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

test('indexes Native session metadata without loading the agent SDK in Main or changing history', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}) => {
  const directory = path.join(piAgentDir, 'sessions', '--background-index--')
  fs.mkdirSync(directory, { recursive: true })
  const parentId = '01a126a4-0796-73ff-990a-a2be2198354e'
  const childId = '01a226a4-0796-73ff-990a-a2be2198354e'
  const parent = path.join(directory, 'parent.jsonl')
  const child = path.join(directory, 'child.jsonl')
  const timestamp = '2026-10-13T00:00:00.000Z'
  const header = (id: string, parentSession?: string) => ({
    type: 'session',
    version: 3,
    id,
    timestamp,
    cwd: workspaceRoot,
    ...(parentSession ? { parentSession } : {})
  })
  const lines = [
    header(parentId),
    {
      type: 'message',
      id: 'user-entry',
      parentId: null,
      timestamp,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Native metadata preview' },
          { type: 'image', data: 'TQ==', mimeType: 'image/png' }
        ],
        timestamp: Date.parse(timestamp)
      }
    },
    {
      type: 'session_info',
      id: 'name-entry',
      parentId: 'user-entry',
      timestamp,
      name: 'Native background history'
    }
  ]
  fs.writeFileSync(parent, lines.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  fs.writeFileSync(child, JSON.stringify(header(childId, parent)) + '\n')
  fs.writeFileSync(path.join(directory, 'malformed.jsonl'), 'not a session\n')
  const before = [parent, child].map((file) => fs.readFileSync(file, 'utf8'))

  await electronApp.evaluate(async () => {
    const inspector = process.getBuiltinModule('inspector')!
    const state = globalThis as typeof globalThis & {
      __sessionIndexScripts: string[]
      __sessionIndexInspector: import('node:inspector').Session
    }
    state.__sessionIndexScripts = []
    state.__sessionIndexInspector = new inspector.Session()
    state.__sessionIndexInspector.connect()
    state.__sessionIndexInspector.on('Debugger.scriptParsed', ({ params }) => {
      if (params.url.includes('pi-coding-agent')) state.__sessionIndexScripts.push(params.url)
    })
    await new Promise<void>((resolve, reject) =>
      state.__sessionIndexInspector.post('Debugger.enable', (error) =>
        error ? reject(error) : resolve()
      )
    )
  })

  await page.locator('a[href="#/workspace"]').click()
  const indexed = await page.evaluate(() => window.piSwitch.sessions.list(true))
  const mainScripts = await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __sessionIndexScripts: string[]
      __sessionIndexInspector: import('node:inspector').Session
    }
    state.__sessionIndexInspector.disconnect()
    return state.__sessionIndexScripts
  })
  expect(mainScripts).toEqual([])
  await expect(page.getByTestId(`session-row-${parentId}`)).toBeVisible()

  // Compare against the unchanged public Native reader outside the Main isolate.
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const native = await SessionManager.listAll(directory)
  expect(native).toHaveLength(2)
  for (const session of native) {
    expect(indexed.find((item) => item.id === session.id)).toMatchObject({
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: session.firstMessage,
      parentSessionId: session.parentSessionPath ? parentId : undefined
    })
  }
  expect([parent, child].map((file) => fs.readFileSync(file, 'utf8'))).toEqual(before)
  fs.unlinkSync(child)
  const refreshed = await page.evaluate(() => window.piSwitch.sessions.list(true))
  expect(refreshed.some((session) => session.id === childId)).toBe(false)
})
