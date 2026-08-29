import { describe, expect, it } from 'vitest'
import {
  folderReadonlyFromSettings,
  folderRoleFromSettings,
  parseCodeWorkspace,
  resolveWorkspaceFolderPath,
  serializeCodeWorkspace,
  toWorkspaceRelativePath,
  writePiHarnessSettings
} from './code-workspace'

describe('code-workspace parser', () => {
  it('resolves relative folders against the workspace file directory', () => {
    expect(
      resolveWorkspaceFolderPath('/Users/wangmiao/code/AgentDesk.code-workspace', 'AgentDesk')
    ).toBe('/Users/wangmiao/code/AgentDesk')
    expect(resolveWorkspaceFolderPath('/Users/wangmiao/code/AgentDesk.code-workspace', 'opencode')).toBe(
      '/Users/wangmiao/code/opencode'
    )
  })

  it('keeps absolute POSIX and Windows folder paths', () => {
    expect(resolveWorkspaceFolderPath('/tmp/ws.code-workspace', '/Users/wangmiao/code/AgentDesk')).toBe(
      '/Users/wangmiao/code/AgentDesk'
    )
    expect(
      resolveWorkspaceFolderPath('C:\\Users\\me\\ws.code-workspace', 'D:\\Code\\AgentDesk', 'win32')
    ).toBe('D:\\Code\\AgentDesk')
    expect(resolveWorkspaceFolderPath('C:\\Users\\me\\ws.code-workspace', 'AgentDesk', 'win32')).toBe(
      'C:\\Users\\me\\AgentDesk'
    )
  })

  it('serializes sibling folders as relative paths and preserves unknown settings', () => {
    const parsed = parseCodeWorkspace(`{
      // cursor workspace
      "folders": [
        { "path": "AgentDesk" },
        { "path": "opencode", "name": "OpenCode" }
      ],
      "settings": {
        "editor.fontSize": 14,
        "files.exclude": {},
        "xxx": { "keep": true }
      },
      "extensions": { "recommendations": ["vue.volar"] }
    }`)

    expect(parsed.folders).toEqual([
      { path: 'AgentDesk' },
      { path: 'opencode', name: 'OpenCode' }
    ])
    expect(parsed.settings?.['editor.fontSize']).toBe(14)
    expect(parsed.extensions).toEqual({ recommendations: ['vue.volar'] })

    const saved = serializeCodeWorkspace({
      ...parsed,
      folders: parsed.folders.map((folder) => ({
        ...folder,
        path: toWorkspaceRelativePath(
          '/Users/me/code/ws.code-workspace',
          resolveWorkspaceFolderPath('/Users/me/code/ws.code-workspace', folder.path)
        )
      })),
      settings: writePiHarnessSettings(parsed.settings, {
        mainFolder: 'AgentDesk',
        folderMeta: { opencode: { role: 'reference', readonly: true } }
      })
    })
    const roundTrip = parseCodeWorkspace(saved)
    expect(roundTrip.settings?.['editor.fontSize']).toBe(14)
    expect(roundTrip.settings?.xxx).toEqual({ keep: true })
    expect(roundTrip.extensions).toEqual({ recommendations: ['vue.volar'] })
    expect(roundTrip.settings?.piHarness).toEqual({
      mainFolder: 'AgentDesk',
      folderMeta: { opencode: { role: 'reference', readonly: true } }
    })
  })

  it('reads namespaced folder roles without inventing a second workspace format', () => {
    const folder = { path: 'opencode', resolvedPath: '/code/opencode', name: 'opencode' }
    expect(
      folderRoleFromSettings(folder, 1, {
        mainFolder: 'AgentDesk',
        folderMeta: { opencode: { role: 'dependency' } }
      })
    ).toBe('dependency')
    expect(folderReadonlyFromSettings(folder, { folderMeta: { opencode: { readonly: true } } })).toBe(
      true
    )
    expect(folderRoleFromSettings({ path: 'AgentDesk', resolvedPath: '/code/AgentDesk' }, 0, {})).toBe(
      'main'
    )
  })
})
