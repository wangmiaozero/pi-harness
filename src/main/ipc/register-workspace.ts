import { BrowserWindow, Menu, dialog, type OpenDialogOptions } from 'electron'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  allowRootSchema,
  agentCommandSchema,
  fileListSchema,
  fileReadSchema,
  fileWriteSchema,
  fileUploadSchema,
  gitDiffSchema,
  gitPathListSchema,
  gitGenerateCommitMessageSchema,
  gitCommitSchema,
  gitHistorySchema,
  gitOverviewSchema,
  gitCommitDetailsSchema,
  gitCommitDiffSchema,
  gitActionSchema,
  gitBranchContextMenuSchema,
  gitStatusManySchema,
  gitStatusSchema,
  promptAgentSchema,
  projectContextMenuSchema,
  sessionFolderContextMenuSchema,
  sessionContextMenuSchema,
  sessionContextSchema,
  sessionExportSchema,
  projectExportSchema,
  sessionIdSchema,
  sessionRenameSchema,
  startAgentSessionSchema,
  workspaceBindSessionSchema,
  workspaceOpenFileSchema,
  workspaceOpenTerminalSchema,
  workspaceRelocateFolderSchema,
  workspaceSaveSchema,
  workspaceSearchSchema,
  workspaceSessionIdSchema,
  workspaceSyncSchema,
  worktreeCreateSchema,
  worktreeListSchema,
  worktreeRemoveSchema
} from '@shared/schemas/workspace'
import { groupSessionsByProject } from '@shared/workspace/session-tree'
import { ValidationError } from '../services/errors'
import type { FileAccessService } from '../files/file-access-service'
import type { FileService } from '../files/file-service'
import type { GitService } from '../git/git-service'
import type { GitCommitMessageService } from '../git/commit-message-service'
import type { WorktreeService } from '../git/worktree-service'
import type { SessionService } from '../sessions/session-service'
import type { SessionExportService } from '../sessions/session-export-service'
import type { AgentRuntime } from '../agent/runtime'
import type { WorkspaceService } from '../workspace/workspace-service'
import type {
  ProjectContextAction,
  GitBranchContextAction,
  GitContextMenuSelection,
  SessionContextAction,
  SessionFolderContextAction
} from '@shared/types/workspace'
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
  gitCommitMessages: GitCommitMessageService
  worktrees: WorktreeService
  sessions: SessionService
  sessionExport: SessionExportService
  agent: AgentRuntime
  workspaceState: WorkspaceService
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
  const {
    access,
    files,
    git,
    gitCommitMessages,
    worktrees,
    sessions,
    sessionExport,
    agent,
    workspaceState,
    beforeAgentStart
  } = services

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
  ipcMain.handle(IPC_INVOKE.workspacePickWorkspaceSources, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const options: OpenDialogOptions = {
        properties: ['openFile', 'openDirectory', 'multiSelections', 'createDirectory'],
        filters: [{ name: 'Projects or Workspace', extensions: ['code-workspace'] }]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return []
      return Promise.all(
        result.filePaths.map((source) =>
          source.toLowerCase().endsWith('.code-workspace')
            ? Promise.resolve(source)
            : access.authorizeRoot(source)
        )
      )
    })
  )
  ipcMain.handle(IPC_INVOKE.workspacePickWorkspaceFile, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = win
        ? await dialog.showOpenDialog(win, {
            properties: ['openFile'],
            filters: [{ name: 'Workspace', extensions: ['code-workspace'] }]
          })
        : await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Workspace', extensions: ['code-workspace'] }]
          })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceSaveWorkspaceFile, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = win
        ? await dialog.showSaveDialog(win, {
            filters: [{ name: 'Workspace', extensions: ['code-workspace'] }],
            defaultPath: 'workspace.code-workspace'
          })
        : await dialog.showSaveDialog({
            filters: [{ name: 'Workspace', extensions: ['code-workspace'] }],
            defaultPath: 'workspace.code-workspace'
          })
      return result.canceled ? null : (result.filePath ?? null)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceGetActive, () => wrap(async () => workspaceState.getActive()))
  ipcMain.handle(IPC_INVOKE.workspaceSync, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceSyncSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid workspace', { issues: parsed.error.issues })
      return workspaceState.sync(parsed.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceOpenFile, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceOpenFileSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid workspace file', { issues: parsed.error.issues })
      return workspaceState.openWorkspaceFile(parsed.data.path)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceSave, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceSaveSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid workspace save', { issues: parsed.error.issues })
      const dest = parsed.data.path ?? parsed.data.workspaceFile
      if (!dest) throw new ValidationError('Workspace save path is required')
      return workspaceState.saveWorkspaceFile(dest, parsed.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceSearch, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceSearchSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid search', { issues: parsed.error.issues })
      return workspaceState.search(parsed.data.query, parsed.data.scope, parsed.data.folderId)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceOpenTerminal, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceOpenTerminalSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid terminal directory', { issues: parsed.error.issues })
      await workspaceState.openInTerminal(parsed.data.directory)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceRelocateFolder, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceRelocateFolderSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid relocate', { issues: parsed.error.issues })
      return workspaceState.relocateFolder(parsed.data.folderId, parsed.data.path)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceListRecent, () => wrap(() => workspaceState.listRecent()))
  ipcMain.handle(IPC_INVOKE.workspaceBindSession, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceBindSessionSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid session binding', { issues: parsed.error.issues })
      await workspaceState.bindSession(parsed.data.sessionId, {
        workspaceId: parsed.data.workspaceId,
        mainFolderId: parsed.data.mainFolderId,
        folders: parsed.data.folders
      })
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceGetSessionBinding, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = workspaceSessionIdSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid session', { issues: parsed.error.issues })
      return workspaceState.getSessionBinding(parsed.data.sessionId)
    })
  )
  ipcMain.handle(IPC_INVOKE.workspaceListSessionBindings, () =>
    wrap(() => workspaceState.listSessionBindings())
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
  ipcMain.handle(IPC_INVOKE.workspaceSessionFolderContextMenu, (e, input: unknown) =>
    wrap(async () => {
      const parsed = sessionFolderContextMenuSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid session folder menu', {
          issues: parsed.error.issues
        })
      const win = BrowserWindow.fromWebContents(e.sender)
      return showSessionFolderMenu(win, parsed.data.locale ?? 'en-US')
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
      await workspaceState.unbindSession(id)
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
  ipcMain.handle(IPC_INVOKE.projectExport, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = projectExportSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid project export', { issues: parsed.error.issues })
      return sessionExport.exportProject(
        parsed.data.name,
        parsed.data.sessionIds,
        parsed.data.format
      )
    })
  )
  ipcMain.handle(IPC_INVOKE.sessionContextMenu, (e, input: unknown) =>
    wrap(async () => {
      const parsed = sessionContextMenuSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid menu', { issues: parsed.error.issues })
      const win = BrowserWindow.fromWebContents(e.sender)
      return showSessionMenu(win, parsed.data.locale ?? 'en-US')
    })
  )

  ipcMain.handle(IPC_INVOKE.agentStart, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = startAgentSessionSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid start', { issues: parsed.error.issues })
      if (parsed.data.cwd) await access.assertAllowed(parsed.data.cwd, { mustExist: true })
      await beforeAgentStart?.(parsed.data.cwd, parsed.data.sessionId)
      const started = await agent.start(parsed.data)
      if (!parsed.data.sessionId) await workspaceState.bindActiveToSession(started.sessionId)
      return started
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
  ipcMain.handle(IPC_INVOKE.gitStatusMany, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitStatusManySchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid cwd list', { issues: parsed.error.issues })
      return git.statusMany(parsed.data.cwds)
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
  ipcMain.handle(IPC_INVOKE.gitStage, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitPathListSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid stage request', { issues: parsed.error.issues })
      await git.stage(parsed.data.cwd, parsed.data.filePaths)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitUnstage, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitPathListSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid unstage request', { issues: parsed.error.issues })
      await git.unstage(parsed.data.cwd, parsed.data.filePaths)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitGenerateCommitMessage, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitGenerateCommitMessageSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid commit message request', {
          issues: parsed.error.issues
        })
      const context = await git.commitMessageContext(parsed.data.cwd, parsed.data.draft)
      return gitCommitMessages.generate(context)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitCommit, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitCommitSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid commit request', { issues: parsed.error.issues })
      return git.commit(parsed.data.cwd, parsed.data.message)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitHistory, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitHistorySchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid git history request', { issues: parsed.error.issues })
      return git.history(parsed.data.cwd, parsed.data.limit)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitOverview, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitOverviewSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid git overview request', { issues: parsed.error.issues })
      return git.overview(parsed.data.cwd)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitCommitDetails, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitCommitDetailsSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid commit details request', { issues: parsed.error.issues })
      return git.commitDetails(parsed.data.cwd, parsed.data.hash)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitCommitDiff, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitCommitDiffSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid commit diff request', { issues: parsed.error.issues })
      return git.commitDiff(parsed.data.cwd, parsed.data.hash, parsed.data.filePath)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitAction, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = gitActionSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid git action request', { issues: parsed.error.issues })
      return git.action(parsed.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.gitBranchContextMenu, (e, input: unknown) =>
    wrap(async () => {
      const parsed = gitBranchContextMenuSchema.safeParse(input)
      if (!parsed.success)
        throw new ValidationError('Invalid branch menu request', { issues: parsed.error.issues })
      return showGitBranchMenu(BrowserWindow.fromWebContents(e.sender), parsed.data)
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
      { id: 'rename', label: labels.rename, click: () => finish('rename') },
      { id: 'delete', label: labels.delete, click: () => finish('delete') }
    ]
    const menu = Menu.buildFromTemplate(items)
    menu.popup({
      window: win ?? undefined,
      callback: () => finish(null)
    })
  })
}

function showSessionFolderMenu(
  win: BrowserWindow | null,
  locale: 'zh-CN' | 'en-US'
): Promise<SessionFolderContextAction | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (action: SessionFolderContextAction | null) => {
      if (settled) return
      settled = true
      resolve(action)
    }
    const menu = Menu.buildFromTemplate([
      {
        label: locale === 'zh-CN' ? '移除' : 'Remove',
        click: () => finish('remove')
      }
    ])
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
        id: isPinned ? 'unpin' : 'pin',
        label: isPinned ? labels.unpin : labels.pin,
        click: () => finish(isPinned ? 'unpin' : 'pin')
      },
      { id: 'open', label: labels.open, click: () => finish('open') },
      { id: 'edit', label: labels.edit, click: () => finish('edit') },
      { id: 'rename', label: labels.rename, click: () => finish('rename') },
      { id: 'archive-chats', label: labels.archiveChats, click: () => finish('archive-chats') },
      {
        id: 'create-worktree',
        label: labels.createWorktree,
        click: () => finish('create-worktree')
      },
      { type: 'separator' },
      { id: 'export-html', label: labels.exportHtml, click: () => finish('export-html') },
      { id: 'export-md', label: labels.exportMarkdown, click: () => finish('export-md') },
      { id: 'reveal', label: labels.reveal, click: () => finish('reveal') },
      { type: 'separator' },
      { id: 'remove', label: labels.remove, click: () => finish('remove') }
    ])
    menu.popup({
      window: win ?? undefined,
      callback: () => finish(null)
    })
  })
}

function showGitBranchMenu(
  win: BrowserWindow | null,
  input: {
    locale: 'zh-CN' | 'en-US'
    branchName: string
    branchType: 'local' | 'remote'
    current: boolean
    upstream: string | null
    upstreamChoices: string[]
  }
): Promise<GitContextMenuSelection<GitBranchContextAction> | null> {
  return new Promise((resolve) => {
    const zh = input.locale === 'zh-CN'
    let settled = false
    const finish = (action: GitBranchContextAction | null, value?: string) => {
      if (settled) return
      settled = true
      resolve(action ? { action, ...(value ? { value } : {}) } : null)
    }
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: zh ? `检出 ${input.branchName}` : `Checkout ${input.branchName}`,
        enabled: !input.current,
        click: () => finish('checkout')
      }
    ]
    if (input.branchType === 'local') {
      items.push({ label: zh ? '推送' : 'Push', click: () => finish('push') })
    }
    items.push(
      { type: 'separator' },
      {
        label: zh ? '合并到当前分支' : 'Merge into current branch',
        enabled: !input.current,
        click: () => finish('merge')
      },
      {
        label: zh ? '将当前分支 Rebase 到此分支' : 'Rebase current branch onto this branch',
        enabled: !input.current,
        click: () => finish('rebase')
      },
      { type: 'separator' },
      {
        label: zh ? '从此处创建分支…' : 'Create branch here…',
        click: () => finish('create-branch')
      }
    )
    if (input.branchType === 'local') {
      items.push(
        { label: zh ? '重命名…' : 'Rename…', click: () => finish('rename') },
        {
          label: zh ? '设置上游分支' : 'Set upstream',
          enabled: input.upstreamChoices.length > 0,
          submenu: input.upstreamChoices.map((choice) => ({
            label: choice,
            type: 'radio' as const,
            checked: choice === input.upstream,
            click: () => finish('set-upstream', choice)
          }))
        }
      )
      if (input.upstream) {
        items.push({ label: zh ? '取消上游分支' : 'Unset upstream', click: () => finish('unset-upstream') })
      }
      items.push(
        { type: 'separator' },
        {
          label: zh ? '删除分支…' : 'Delete branch…',
          enabled: !input.current,
          click: () => finish('delete')
        }
      )
    }
    items.push(
      { type: 'separator' },
      { label: zh ? '复制分支名称' : 'Copy branch name', click: () => finish('copy-name') }
    )
    const menu = Menu.buildFromTemplate(items)
    menu.popup({ window: win ?? undefined, callback: () => finish(null) })
  })
}
