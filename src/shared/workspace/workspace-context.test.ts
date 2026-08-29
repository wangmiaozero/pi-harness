import { describe, expect, it } from 'vitest'
import { applyWorkspacePrompt, formatWorkspaceAgentPrompt, stripWorkspacePrompt } from './workspace-context'
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
    const first = applyWorkspacePrompt('Host prompt', '--- BEGIN PI-HARNESS WORKSPACE ---\nA\n--- END PI-HARNESS WORKSPACE ---')
    const second = applyWorkspacePrompt(first, '--- BEGIN PI-HARNESS WORKSPACE ---\nB\n--- END PI-HARNESS WORKSPACE ---')
    expect(second.startsWith('Host prompt')).toBe(true)
    expect(second).toContain('B')
    expect(second).not.toContain('\nA\n')
    expect(stripWorkspacePrompt(second)).toBe('Host prompt')
  })
})
