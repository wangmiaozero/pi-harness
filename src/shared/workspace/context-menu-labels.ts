export type ContextMenuLocale = 'zh-CN' | 'en-US'

export interface SessionContextMenuLabels {
  pin: string
  unpin: string
  open: string
  rename: string
  archive: string
  fork: string
  exportHtml: string
  exportMarkdown: string
  reveal: string
  openWorktree: string
  delete: string
}

export interface ProjectContextMenuLabels {
  pin: string
  unpin: string
  reveal: string
  remove: string
  archiveChats: string
  createWorktree: string
}

export function getSessionContextMenuLabels(
  locale: ContextMenuLocale,
  platform: NodeJS.Platform
): SessionContextMenuLabels {
  const isChinese = locale === 'zh-CN'
  return {
    pin: isChinese ? '置顶' : 'Pin',
    unpin: isChinese ? '取消置顶' : 'Unpin',
    open: isChinese ? '打开' : 'Open',
    rename: isChinese ? '重命名' : 'Rename',
    archive: isChinese ? '归档' : 'Archive',
    fork: isChinese ? '创建分支' : 'Fork',
    exportHtml: isChinese ? '导出 HTML' : 'Export HTML',
    exportMarkdown: isChinese ? '导出 Markdown' : 'Export Markdown',
    reveal: revealLabel(isChinese, platform),
    openWorktree: isChinese ? '打开 Worktree' : 'Open Worktree',
    delete: isChinese ? '删除' : 'Delete'
  }
}

export function getProjectContextMenuLabels(
  locale: ContextMenuLocale,
  platform: NodeJS.Platform
): ProjectContextMenuLabels {
  const isChinese = locale === 'zh-CN'
  return {
    pin: isChinese ? '置顶' : 'Pin',
    unpin: isChinese ? '取消置顶' : 'Unpin',
    reveal: revealLabel(isChinese, platform),
    remove: isChinese ? '移除项目' : 'Remove Project',
    archiveChats: isChinese ? '归档聊天' : 'Archive Chats',
    createWorktree: isChinese ? '创建永久工作树' : 'Create Permanent Worktree'
  }
}

function revealLabel(isChinese: boolean, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return isChinese ? '在 Finder 中显示' : 'Reveal in Finder'
  if (platform === 'win32') {
    return isChinese ? '在文件资源管理器中显示' : 'Show in File Explorer'
  }
  return isChinese ? '在文件管理器中显示' : 'Show in File Manager'
}
