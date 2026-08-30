export type ContextMenuLocale = 'zh-CN' | 'en-US'

export interface SessionContextMenuLabels {
  pin: string
  unpin: string
  open: string
  edit: string
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
  open: string
  edit: string
  rename: string
  exportHtml: string
  exportMarkdown: string
  reveal: string
  remove: string
  archiveChats: string
  createWorktree: string
  setMain: string
  setRole: string
  roleReference: string
  roleDependency: string
  roleDocs: string
  toggleReadonly: string
  openTerminal: string
  relocate: string
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
    edit: isChinese ? '编辑' : 'Edit',
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
    open: isChinese ? '打开' : 'Open',
    edit: isChinese ? '编辑' : 'Edit',
    rename: isChinese ? '重命名' : 'Rename',
    exportHtml: isChinese ? '导出 HTML' : 'Export HTML',
    exportMarkdown: isChinese ? '导出 Markdown' : 'Export Markdown',
    reveal: revealLabel(isChinese, platform),
    remove: isChinese ? '删除' : 'Delete',
    archiveChats: isChinese ? '归档' : 'Archive',
    createWorktree: isChinese ? '创建分支' : 'Create Branch',
    setMain: isChinese ? '设为主项目' : 'Set as Main Project',
    setRole: isChinese ? '设置角色' : 'Set Role',
    roleReference: isChinese ? '设置为 Reference' : 'Set as Reference',
    roleDependency: isChinese ? '设置为 Dependency' : 'Set as Dependency',
    roleDocs: isChinese ? '设置为 Docs' : 'Set as Docs',
    toggleReadonly: isChinese ? '切换只读' : 'Toggle Read-only',
    openTerminal: isChinese ? '在终端中打开' : 'Open in Terminal',
    relocate: isChinese ? '重新定位' : 'Relocate'
  }
}

function revealLabel(isChinese: boolean, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return isChinese ? '在 Finder 中显示' : 'Reveal in Finder'
  if (platform === 'win32') {
    return isChinese ? '在文件资源管理器中显示' : 'Show in File Explorer'
  }
  return isChinese ? '在文件管理器中显示' : 'Show in File Manager'
}
