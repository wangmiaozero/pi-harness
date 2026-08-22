import { describe, expect, it } from 'vitest'
import { getProjectContextMenuLabels, getSessionContextMenuLabels } from './context-menu-labels'

describe('session context menu labels', () => {
  it('returns localized Chinese labels', () => {
    expect(getSessionContextMenuLabels('zh-CN', 'darwin')).toEqual({
      pin: '置顶',
      unpin: '取消置顶',
      open: '打开',
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
      reveal: '在 Finder 中显示',
      remove: '移除项目',
      archiveChats: '归档聊天',
      createWorktree: '创建永久工作树'
    })
  })

  it('uses platform-appropriate English reveal labels', () => {
    expect(getSessionContextMenuLabels('en-US', 'win32').reveal).toBe('Show in File Explorer')
    expect(getSessionContextMenuLabels('en-US', 'linux').reveal).toBe('Show in File Manager')
  })
})
