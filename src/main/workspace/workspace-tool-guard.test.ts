import { describe, expect, it, vi } from 'vitest'
import { extractToolPath, resolveWorkspaceToolPath } from './workspace-tool-guard'
import { createDesktopExtension } from '../agent/desktop-extension'
import type { ExtensionAPI, ToolCallEvent } from '@earendil-works/pi-coding-agent'

describe('workspace tool guard', () => {
  it.each([
    ['file.txt', '/workspace/file.txt'],
    ['@file.txt', '/workspace/file.txt'],
    ['~/file.txt', '/home/fixture/file.txt'],
    ['../outside.txt', '/outside.txt'],
    ['file:///workspace/a%20b.txt', '/workspace/a b.txt'],
    ['a\u202fb.txt', '/workspace/a b.txt']
  ])('resolves native path spelling %s before authorization', (input, expected) => {
    expect(resolveWorkspaceToolPath(input, '/workspace', 'darwin', '/home/fixture')).toBe(expected)
  })

  it.each([
    '/c/project/file.txt',
    '/mnt/c/project/file.txt',
    '/cygdrive/c/project/file.txt',
    'file:///C:/project/file.txt',
    '@C:\\project\\file.txt'
  ])('normalizes Windows native tool path %s', (input) => {
    expect(resolveWorkspaceToolPath(input, 'C:\\workspace', 'win32', 'C:\\Users\\fixture')).toBe(
      'C:\\project\\file.txt'
    )
  })
  it('extracts common tool path arguments', () => {
    expect(extractToolPath({ path: '/code/app.ts' })).toBe('/code/app.ts')
    expect(extractToolPath({ file_path: '/code/app.ts' })).toBe('/code/app.ts')
    expect(extractToolPath({})).toBeNull()
  })

  it('blocks writes through the public tool_call hook, without mutating metadata', async () => {
    let toolCall!: (event: ToolCallEvent, ctx: { signal: AbortSignal }) => Promise<unknown>
    const api = {
      on: (name: string, handler: typeof toolCall) => {
        if (name === 'tool_call') toolCall = handler
      }
    } as unknown as ExtensionAPI
    const assertWritable = vi.fn(async (target: string) => {
      throw new Error(`readonly:${target}`)
    })
    createDesktopExtension(
      { forceEmpty: false, workspacePromptProvider: null },
      { assertWritable }
    )(api)
    const signal = new AbortController().signal
    const result = await toolCall(
      {
        type: 'tool_call',
        toolCallId: 'call',
        toolName: 'write',
        input: { path: '/code/ref/a.ts', content: 'blocked' }
      },
      { signal }
    )
    expect(result).toMatchObject({ block: true })
    expect(assertWritable).toHaveBeenCalledWith('/code/ref/a.ts', signal)
  })
})
