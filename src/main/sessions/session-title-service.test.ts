import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionDetail } from '@shared/types/workspace'
import { JsonStore } from '../services/storage'
import { SessionTitleService, titleDialogue, type SessionTitles } from './session-title-service'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})
function detail(): SessionDetail {
  return {
    sessionId: 'session',
    filePath: '/sessions/session.jsonl',
    leafId: 'assistant',
    totalActiveMs: 1,
    info: {
      id: 'session',
      path: '/sessions/session.jsonl',
      cwd: '/demo',
      created: '',
      modified: '',
      messageCount: 2,
      firstMessage: '修复会话切换'
    },
    context: {
      entryIds: ['user', 'assistant'],
      entryParents: {},
      thinkingLevel: 'off',
      model: null,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '修复会话切换时状态错乱的问题' },
            { type: 'image', data: 'private-image-base64', mimeType: 'image/png' }
          ]
        },
        {
          role: 'assistant',
          provider: 'fixture',
          model: 'fixture',
          content: [
            {
              type: 'text',
              text: '需要检查会话切换时的异步响应，确保旧会话的结果不会覆盖当前会话的草稿、项目目录和文件树。'.repeat(
                4
              )
            },
            { type: 'thinking', thinking: 'private reasoning' }
          ]
        }
      ]
    }
  }
}
async function store() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-title-test-'))
  directories.push(dir)
  const store = new JsonStore<SessionTitles>(path.join(dir, 'titles.json'), {})
  await store.read()
  return store
}
describe('background session titles', () => {
  it('coalesces requests, persists the model title and notifies without changing the transcript', async () => {
    const data = await store()
    let finish!: (title: string) => void
    const generate = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const changed = vi.fn()
    const service = new SessionTitleService(data, generate, changed)
    const transcript = detail()
    const before = JSON.stringify(transcript)
    service.observe(transcript)
    service.observe(transcript)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    finish('修复会话切换状态')
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith('session'))
    expect(service.title(transcript.info!)).toBe('修复会话切换状态')
    expect(JSON.stringify(transcript)).toBe(before)
    service.observe(transcript)
    await Promise.resolve()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(service.title({ id: 'session', path: '/different.jsonl' })).toBeUndefined()
    service.close()
  })
  it('never renames an explicitly named session and skips trivial exchanges', async () => {
    const generate = vi.fn()
    const service = new SessionTitleService(await store(), generate, vi.fn())
    const named = detail()
    named.info!.name = 'My own title'
    service.observe(named)
    const short = detail()
    short.context.messages = [{ role: 'user', content: 'hi' }]
    service.observe(short)
    await Promise.resolve()
    expect(generate).not.toHaveBeenCalled()
    service.close()
  })
  it('keeps failures quiet and cancels late results during shutdown', async () => {
    const data = await store()
    const changed = vi.fn()
    let finish!: (title: string) => void
    const service = new SessionTitleService(
      data,
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
      changed
    )
    service.observe(detail())
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    service.close()
    finish('Too late')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(changed).not.toHaveBeenCalled()
    expect(data.peek()).toEqual({})
    const failed = new SessionTitleService(
      data,
      vi.fn().mockRejectedValue(new Error('offline')),
      changed
    )
    failed.observe(detail())
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(changed).not.toHaveBeenCalled()
    failed.close()
  })
  it('sends only visible conversation text, never images, reasoning or tools', () => {
    const dialogue = JSON.stringify(titleDialogue(detail()))
    expect(dialogue).toContain('修复会话切换')
    expect(dialogue).not.toMatch(/private|base64|thinking/)
  })
})
