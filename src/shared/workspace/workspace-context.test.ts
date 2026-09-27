import { describe, expect, it } from 'vitest'
import {
  applyWorkspacePrompt,
  formatWorkspaceAgentPrompt,
  stripWorkspacePrompt
} from './workspace-context'
import type { AgentWorkspace } from '../types/workspace'

describe('workspace agent context', () => {
  it('describes every folder with role and write policy', () => {
    const workspace: AgentWorkspace = {
      id: 'ws',
      name: 'AgentDesk',
      workspaceFile: '/code/AgentDesk.code-workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {},
      folders: [
        {
          id: 'main',
          name: 'AgentDesk',
          path: 'AgentDesk',
          resolvedPath: '/code/AgentDesk',
          role: 'main',
          readonly: false,
          exists: true
        },
        {
          id: 'ref',
          name: 'opencode',
          path: 'opencode',
          resolvedPath: '/code/opencode',
          role: 'reference',
          readonly: true,
          exists: true
        }
      ]
    }

    const prompt = formatWorkspaceAgentPrompt(workspace)
    expect(prompt).toContain('Projects attached to the current session:')
    expect(prompt).toContain('Primary Project:')
    expect(prompt).toContain('/code/AgentDesk')
    expect(prompt).toContain('Writable')
    expect(prompt).toContain('opencode')
    expect(prompt).toContain('opencode → /code/opencode')
    expect(prompt).toContain('When the user names a folder, resolve it with the map above.')
    expect(prompt).toContain('This workspace folder is read-only.')
  })

  it('replaces a previous workspace prompt block without dropping the host prompt', () => {
    const first = applyWorkspacePrompt(
      'Host prompt',
      '--- BEGIN PI-HARNESS WORKSPACE ---\nA\n--- END PI-HARNESS WORKSPACE ---'
    )
    const second = applyWorkspacePrompt(
      first,
      '--- BEGIN PI-HARNESS WORKSPACE ---\nB\n--- END PI-HARNESS WORKSPACE ---'
    )
    expect(second.startsWith('Host prompt')).toBe(true)
    expect(second).toContain('B')
    expect(second).not.toContain('\nA\n')
    expect(second.match(/BEGIN PI-HARNESS FILE INTEGRITY/g)).toHaveLength(1)
    expect(stripWorkspacePrompt(second)).toContain('File-change integrity:')
  })

  it('requires successful file tools before reporting a file change', () => {
    const prompt = applyWorkspacePrompt('Host prompt', null)

    expect(prompt).toContain('perform the operation with an enabled tool before reporting success')
    expect(prompt).toContain('Never claim that a file was created or changed')
    expect(prompt).toContain(
      'Never substitute guessed sandbox paths such as /mnt/okcomputer/output'
    )
  })
})
