import { describe, expect, it, vi } from 'vitest'
import { extractToolPath, wrapWorkspaceWriteTools } from './workspace-tool-guard'
import type { AgentSessionLike } from '../agent/pi-sdk'

describe('workspace tool guard', () => {
  it('extracts common tool path arguments', () => {
    expect(extractToolPath({ path: '/code/app.ts' })).toBe('/code/app.ts')
    expect(extractToolPath({ file_path: '/code/app.ts' })).toBe('/code/app.ts')
    expect(extractToolPath({})).toBeNull()
  })

  it('blocks write/edit tools that expose execute', async () => {
    const execute = vi.fn(async () => 'ok')
    const tools = [{ name: 'write', execute }]
    const session = {
      getAllTools: () => tools
    } as unknown as AgentSessionLike
    const assertWritable = vi.fn(async (target: string) => {
      throw new Error(`readonly:${target}`)
    })
    wrapWorkspaceWriteTools(session, assertWritable)
    await expect(
      (session.getAllTools()[0] as unknown as { execute: (args: unknown) => Promise<unknown> }).execute({
        path: '/code/ref/a.ts'
      })
    ).rejects.toThrow('readonly:/code/ref/a.ts')
    expect(execute).not.toHaveBeenCalled()
  })
})
