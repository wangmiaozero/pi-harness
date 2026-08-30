import { describe, expect, it } from 'vitest'
import { getProjectContextMenuLabels, getSessionContextMenuLabels } from './context-menu-labels'

describe('session context menu labels', () => {
  it('returns localized Chinese labels', () => {
    expect(getSessionContextMenuLabels('zh-CN', 'darwin')).toEqual({
      pin: '置顶',
      unpin: '取消置顶',
      open: '打开',
      edit: '编辑',
      rename: '重命名',
      archive: '归档',
      fork: '创建分支',
      exportHtml: '导出 HTML',
      exportMarkdown: '导出 Markdown',
      reveal: '在 Finder 中显示',
      openWorktree: '打开 Worktree',
      delete: '删除'
    })
  })

  it('returns localized project actions', () => {
    expect(getProjectContextMenuLabels('zh-CN', 'darwin')).toEqual({
      pin: '置顶',
      unpin: '取消置顶',
      open: '打开',
      edit: '编辑',
      rename: '重命名',
      exportHtml: '导出 HTML',
      exportMarkdown: '导出 Markdown',
      reveal: '在 Finder 中显示',
      remove: '删除',
      archiveChats: '归档',
      createWorktree: '创建分支',
      setMain: '设为主项目',
      setRole: '设置角色',
      roleReference: '设置为 Reference',
      roleDependency: '设置为 Dependency',
      roleDocs: '设置为 Docs',
      toggleReadonly: '切换只读',
      openTerminal: '在终端中打开',
      relocate: '重新定位'
    })
  })

  it('uses platform-appropriate English reveal labels', () => {
    expect(getSessionContextMenuLabels('en-US', 'win32').reveal).toBe('Show in File Explorer')
    expect(getSessionContextMenuLabels('en-US', 'linux').reveal).toBe('Show in File Manager')
  })
})
