import { BrowserWindow, Menu, dialog } from 'electron'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  allowRootSchema,
  agentCommandSchema,
  fileListSchema,
  fileReadSchema,
  fileWriteSchema,
  fileUploadSchema,
  gitDiffSchema,
  gitStatusSchema,
  promptAgentSchema,
  projectContextMenuSchema,
  sessionContextMenuSchema,
  sessionContextSchema,
  sessionExportSchema,
  sessionIdSchema,
  sessionRenameSchema,
  startAgentSessionSchema,
  worktreeCreateSchema,
  worktreeListSchema,
  worktreeRemoveSchema
} from '@shared/schemas/workspace'
import { groupSessionsByProject } from '@shared/workspace/session-tree'
import { ValidationError } from '../services/errors'
import type { FileAccessService } from '../files/file-access-service'
import type { FileService } from '../files/file-service'
import type { GitService } from '../git/git-service'
import type { WorktreeService } from '../git/worktree-service'
import type { SessionService } from '../sessions/session-service'
import type { SessionExportService } from '../sessions/session-export-service'
import type { AgentRuntime } from '../agent/runtime'
import type { ProjectContextAction, SessionContextAction } from '@shared/types/workspace'
import {
  getProjectContextMenuLabels,
  getSessionContextMenuLabels
} from '@shared/workspace/context-menu-labels'
import type { IpcHandleRegistrar } from './trusted-ipc'
import { optionalBooleanSchema } from '@shared/schemas/ipc'

export interface WorkspaceServices {
  access: FileAccessService
  files: FileService
  git: GitService
  worktrees: WorktreeService
  sessions: SessionService
  sessionExport: SessionExportService
  agent: AgentRuntime
  beforeAgentStart?: (
    cwd: string | null | undefined,
    sessionId: string | null | undefined
  ) => Promise<void>
}

type Wrap = <T>(
  fn: () => Promise<T>
) => Promise<{ ok: true; data: T } | { ok: false; error: unknown }>

export function registerWorkspaceIpc(
  ipcMain: IpcHandleRegistrar,
  wrap: Wrap,
  services: WorkspaceServices
): void {
  const { access, files, git, worktrees, sessions, sessionExport, agent, beforeAgentStart } =
    services

  ipcMain.handle(IPC_INVOKE.workspaceListProjects, () =>
    wrap(async () => groupSessionsByProject(await sessions.list()))
  )
  ipcMain.handle(IPC_INVOKE.workspacePickDirectory, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      const dir = result.canceled ? null : (result.filePaths[0] ?? null)
      return dir ? access.authorizeRoot(dir) : null
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceAuthorizeDroppedRoot, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = allowRootSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid dropped root', { issues: parsed.error.issues })
      return access.authorizeRoot(parsed.data.root)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceAllowRoot, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = allowRootSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid root', { issues: parsed.error.issues })
      await access.restoreRoot(parsed.data.root)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceProjectContextMenu, (e, input: unknown) =>
    wrap(async () => {
      const parsed = projectContextMenuSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid project menu', { issues: parsed.error.issues })
      const win = BrowserWindow.fromWebContents(e.sender)
      return showProjectMenu(win, parsed.data.isPinned === true, parsed.data.locale ?? 'en-US')
    })
  )

  ipcMain.handle(IPC_INVOKE.sessionList, (_e, force: unknown) =>
    wrap(() => {
      const parsed = optionalBooleanSchema.safeParse(force)
      if (!parsed.success)
        throw new ValidationError('Invalid refresh option', { issues: parsed.error.issues })
      return sessions.list(parsed.data ?? false)
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionGet, (_e, sessionId: unknown) =>
    wrap(async () => {
      const id = sessionIdSchema.parse(sessionId)
      return sessions.get(id)
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionRename, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = sessionRenameSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid rename', { issues: parsed.error.issues })
      await sessions.rename(parsed.data.sessionId, parsed.data.name)
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionDelete, (_e, sessionId: unknown) =>
    wrap(async () => {
      const id = sessionIdSchema.parse(sessionId)
      await agent.stop(id)
      await sessions.remove(id)
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionContext, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = sessionContextSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid context query', { issues: parsed.error.issues })
      const detail = await sessions.get(parsed.data.sessionId, parsed.data.leafId)
      return detail.context
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionExport, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = sessionExportSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid export', { issues: parsed.error.issues })
      return sessionExport.exportToFile(parsed.data.sessionId, parsed.data.format)
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionViewHistory, (e, sessionId: unknown) =>
    wrap(async () => {
      const id = sessionIdSchema.parse(sessionId)
      await sessionExport.viewFullHistory(id, BrowserWindow.fromWebContents(e.sender))
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionContextMenu, (e, input: unknown) =>
    wrap(async () => {
      const parsed = sessionContextMenuSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid menu', { issues: parsed.error.issues })
      const win = BrowserWindow.fromWebContents(e.sender)
      return showSessionMenu(
        win,
        parsed.data.isWorktree === true,
        parsed.data.isPinned === true,
        parsed.data.locale ?? 'en-US'
      )
    })
  )

  ipcMain.handle(IPC_INVOKE.agentStart, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = startAgentSessionSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid start', { issues: parsed.error.issues })
      if (parsed.data.cwd) await access.assertAllowed(parsed.data.cwd, { mustExist: true })
      await beforeAgentStart?.(parsed.data.cwd, parsed.data.sessionId)
      return agent.start(parsed.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.agentPrompt, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = promptAgentSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid prompt', { issues: parsed.error.issues })
      return agent.prompt(parsed.data.sessionId, parsed.data.message, {
        images: parsed.data.images,
        streamingBehavior: parsed.data.streamingBehavior
      })
    })
  )
  ipcMain.handle(IPC_INVOKE.agentAbort, (_e, sessionId: unknown) =>
    wrap(async () => {
      await agent.abort(sessionIdSchema.parse(sessionId))
    })
  )
  ipcMain.handle(IPC_INVOKE.agentState, (_e, sessionId: unknown) =>
    wrap(() => agent.getState(sessionIdSchema.parse(sessionId)))
  )
  ipcMain.handle(IPC_INVOKE.agentRunning, () => wrap(async () => agent.listRunning()))
  ipcMain.handle(IPC_INVOKE.agentCommand, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = agentCommandSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid command', { issues: parsed.error.issues })
      const { sessionId, ...command } = parsed.data
      return agent.command(sessionId, command)
    })
  )

  ipcMain.handle(IPC_INVOKE.filesList, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = fileListSchema.safeParse(
        typeof input === 'string' ? { directory: input } : input
      )
      if (!parsed.success)
        throw new ValidationError('Invalid directory', { issues: parsed.error.issues })
      return files.list(parsed.data.directory)
    })
  )
  ipcMain.handle(IPC_INVOKE.filesRead, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = fileReadSchema.safeParse(typeof input === 'string' ? { path: input } : input)
      if (!parsed.success)
        throw new ValidationError('Invalid path', { issues: parsed.error.issues })
      return files.readPreview(parsed.data.path)
    })
  )
  ipcMain.handle(IPC_INVOKE.filesWrite, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = fileWriteSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid file write', { issues: parsed.error.issues })
      return files.writeText(
        parsed.data.path,
        parsed.data.text,
        parsed.data.expectedRevision,
        parsed.data.overwrite
      )
    })
  )
  ipcMain.handle(IPC_INVOKE.filesUpload, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = fileUploadSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid upload', { issues: parsed.error.issues })
      return files.upload(
        parsed.data.directory,
        parsed.data.fileName,
        parsed.data.dataBase64,
        parsed.data.overwrite
      )
    })
  )

  ipcMain.handle(IPC_INVOKE.gitStatus, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitStatusSchema.safeParse(typeof input === 'string' ? { cwd: input } : input)
      if (!parsed.success) throw new ValidationError('Invalid cwd', { issues: parsed.error.issues })
      return git.status(parsed.data.cwd)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitDiff, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitDiffSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid diff query', { issues: parsed.error.issues })
      return git.diff(parsed.data.cwd, parsed.data.filePath)
    })
  )

  ipcMain.handle(IPC_INVOKE.worktreeList, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = worktreeListSchema.safeParse(
        typeof input === 'string' ? { cwd: input } : input
      )
      if (!parsed.success) throw new ValidationError('Invalid cwd', { issues: parsed.error.issues })
      return worktrees.list(parsed.data.cwd)
    })
  )
  ipcMain.handle(IPC_INVOKE.worktreeCreate, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = worktreeCreateSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid worktree', { issues: parsed.error.issues })
      return worktrees.create(parsed.data.cwd, parsed.data.branch)
    })
  )
  ipcMain.handle(IPC_INVOKE.worktreeRemove, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = worktreeRemoveSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid worktree', { issues: parsed.error.issues })
      await worktrees.remove(parsed.data.cwd, parsed.data.worktreePath, parsed.data.force)
    })
  )
}

function showSessionMenu(
  win: BrowserWindow | null,
  isWorktree: boolean,
  isPinned: boolean,
  locale: 'zh-CN' | 'en-US'
): Promise<SessionContextAction | null> {
  return new Promise((resolve) => {
    const labels = getSessionContextMenuLabels(locale, process.platform)
    let settled = false
    const finish = (action: SessionContextAction | null) => {
      if (settled) return
      settled = true
      resolve(action)
    }
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: isPinned ? labels.unpin : labels.pin,
        click: () => finish(isPinned ? 'unpin' : 'pin')
      },
      { label: labels.open, click: () => finish('open') },
      { label: labels.rename, click: () => finish('rename') },
      { label: labels.archive, click: () => finish('archive') },
      { label: labels.fork, click: () => finish('fork') },
      { type: 'separator' },
      { label: labels.exportHtml, click: () => finish('export-html') },
      { label: labels.exportMarkdown, click: () => finish('export-md') },
      { label: labels.reveal, click: () => finish('reveal') }
    ]
    if (isWorktree) {
      items.push({ label: labels.openWorktree, click: () => finish('open-worktree') })
    }
    items.push({ type: 'separator' }, { label: labels.delete, click: () => finish('delete') })
    const menu = Menu.buildFromTemplate(items)
    menu.popup({
      window: win ?? undefined,
      callback: () => finish(null)
    })
  })
}

function showProjectMenu(
  win: BrowserWindow | null,
  isPinned: boolean,
  locale: 'zh-CN' | 'en-US'
): Promise<ProjectContextAction | null> {
  return new Promise((resolve) => {
    const labels = getProjectContextMenuLabels(locale, process.platform)
    let settled = false
    const finish = (action: ProjectContextAction | null) => {
      if (settled) return
      settled = true
      resolve(action)
    }
    const menu = Menu.buildFromTemplate([
      {
        label: isPinned ? labels.unpin : labels.pin,
        click: () => finish(isPinned ? 'unpin' : 'pin')
      },
      { label: labels.reveal, click: () => finish('reveal') },
      { label: labels.createWorktree, click: () => finish('create-worktree') },
      { type: 'separator' },
      { label: labels.archiveChats, click: () => finish('archive-chats') },
      { type: 'separator' },
      { label: labels.remove, click: () => finish('remove') }
    ])
    menu.popup({
      window: win ?? undefined,
      callback: () => finish(null)
    })
  })
}
