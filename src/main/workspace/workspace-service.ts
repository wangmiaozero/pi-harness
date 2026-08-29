import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentWorkspace,
  FileSearchHit,
  FileSearchScope,
  RecentWorkspace,
  SessionWorkspaceBinding,
  WorkspaceFolder,
  WorkspaceFolderRole
} from '@shared/types/workspace'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import { projectDisplayName } from '@shared/workspace/session-tree'
import {
  folderReadonlyFromSettings,
  folderRoleFromSettings,
  parseCodeWorkspace,
  readPiHarnessSettings,
  resolveWorkspaceFolderPath,
  serializeCodeWorkspace,
  toWorkspaceRelativePath,
  workspaceDisplayName,
  workspaceIdentity,
  writePiHarnessSettings,
  type CodeWorkspaceDocument
} from '@shared/workspace/code-workspace'
import { ensureSingleMainFolder } from '@shared/workspace/workspace-permission'
import { formatWorkspaceAgentPrompt } from '@shared/workspace/workspace-context'
import { atomicWriteText, type JsonStore } from '../services/storage'
import type { FileAccessService } from '../files/file-access-service'
import { ValidationError } from '../services/errors'
import { WorkspaceSearchService } from './workspace-search-service'
import { WorkspaceWatcherService } from './workspace-watcher-service'
import { openDirectoryInTerminal } from './open-terminal'

export interface WorkspaceStateRecord {
  active: PersistedActiveWorkspace | null
  recent: RecentWorkspace[]
  sessionBindings: Record<string, SessionWorkspaceBinding>
}

export interface PersistedActiveWorkspace {
  workspaceFile: string | null
  folders: Array<{
    path: string
    resolvedPath: string
    name?: string
    role: WorkspaceFolderRole
    readonly: boolean
  }>
  settings: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface WorkspaceSyncInput {
  workspaceFile?: string | null
  folders: Array<{
    path: string
    resolvedPath?: string
    name?: string
    role?: WorkspaceFolderRole
    readonly?: boolean
  }>
  settings?: Record<string, unknown>
}

const MAX_RECENT = 20

export class WorkspaceService {
  private active: AgentWorkspace | null = null
  private sessionBindings: Record<string, SessionWorkspaceBinding> = {}
  private rawDocument: CodeWorkspaceDocument | null = null
  private readonly searcher: WorkspaceSearchService
  private readonly watcher = new WorkspaceWatcherService()

  constructor(
    private readonly access: FileAccessService,
    private readonly store: JsonStore<WorkspaceStateRecord>
  ) {
    this.searcher = new WorkspaceSearchService(access)
  }

  onFilesChanged(listener: ((roots: string[]) => void) | null): void {
    this.watcher.onChange(listener)
  }

  async load(): Promise<AgentWorkspace | null> {
    const state = await this.store.read()
    this.sessionBindings = { ...state.sessionBindings }
    if (!state.active?.folders.length) {
      this.active = null
      this.access.setWorkspaceFolders([])
      await this.watcher.sync([])
      return null
    }
    this.active = await this.hydrate(state.active)
    this.access.setWorkspaceFolders(this.active.folders)
    await this.watcher.sync(existingFolderPaths(this.active))
    return this.active
  }

  getActive(): AgentWorkspace | null {
    return this.active
  }

  getPrompt(): string | null {
    return this.active?.folders.length ? formatWorkspaceAgentPrompt(this.active) : null
  }

  async listRecent(): Promise<RecentWorkspace[]> {
    return (await this.store.read()).recent
  }

  async getSessionBinding(sessionId: string): Promise<SessionWorkspaceBinding | null> {
    return this.sessionBindings[sessionId] ?? null
  }

  async listSessionBindings(): Promise<Record<string, SessionWorkspaceBinding>> {
    return { ...this.sessionBindings }
  }

  async bindSession(sessionId: string, binding: SessionWorkspaceBinding): Promise<void> {
    this.sessionBindings = { ...this.sessionBindings, [sessionId]: binding }
    const state = await this.store.read()
    await this.store.write({
      ...state,
      sessionBindings: this.sessionBindings
    })
  }

  async unbindSession(sessionId: string): Promise<void> {
    if (!this.sessionBindings[sessionId]) return
    const nextBindings = { ...this.sessionBindings }
    delete nextBindings[sessionId]
    this.sessionBindings = nextBindings
    const state = await this.store.read()
    await this.store.write({
      ...state,
      sessionBindings: this.sessionBindings
    })
  }

  async bindActiveToSession(sessionId: string): Promise<void> {
    if (!this.active?.folders.length) return
    const main =
      this.active.folders.find((folder) => folder.role === 'main') ?? this.active.folders[0]
    await this.bindSession(sessionId, {
      workspaceId: this.active.workspaceFile ?? `session:${sessionId}`,
      mainFolderId: main?.id,
      folders: this.active.folders.map((folder) => ({
        id: folder.id,
        path: folder.resolvedPath,
        role: folder.id === main?.id ? 'main' : 'reference',
        readonly: folder.readonly
      }))
    })
  }

  getFoldersForSession(sessionId: string): WorkspaceFolder[] {
    const binding = this.sessionBindings[sessionId]
    if (!binding?.folders.length) return []
    const folders = [...binding.folders].sort((a, b) =>
      a.id === binding.mainFolderId ? -1 : b.id === binding.mainFolderId ? 1 : 0
    )
    return folders.map((folder, index) => {
      const activeFolder = this.active?.folders.find(
        (candidate) =>
          candidate.id === folder.id ||
          projectIdentityKey(candidate.resolvedPath) === projectIdentityKey(folder.path)
      )
      return {
        id: folder.id || projectIdentityKey(folder.path),
        name: activeFolder?.name ?? projectDisplayName(folder.path),
        path: folder.path,
        resolvedPath: activeFolder?.resolvedPath ?? folder.path,
        role: index === 0 ? 'main' : 'reference',
        readonly: folder.readonly === true,
        exists: activeFolder?.exists ?? true
      }
    })
  }

  getPromptForSession(sessionId: string): string | null {
    const folders = this.getFoldersForSession(sessionId)
    if (!folders.length) return null
    return formatWorkspaceAgentPrompt({
      id: `session:${sessionId}`,
      name: 'Session projects',
      workspaceFile: null,
      folders,
      settings: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  }

  async activateSession(
    sessionId: string,
    fallbackRoot?: string | null
  ): Promise<AgentWorkspace | null> {
    let binding = this.sessionBindings[sessionId]
    if (!binding?.folders.length && fallbackRoot) {
      const id = projectIdentityKey(fallbackRoot)
      binding = {
        workspaceId: `session:${sessionId}`,
        mainFolderId: id,
        folders: [{ id, path: fallbackRoot, role: 'main' }]
      }
      await this.bindSession(sessionId, binding)
    }
    if (!binding?.folders.length) return null
    const folders = [...binding.folders].sort((a, b) =>
      a.id === binding.mainFolderId ? -1 : b.id === binding.mainFolderId ? 1 : 0
    )
    return this.sync({
      folders: folders.map((folder, index) => ({
        path: folder.path,
        resolvedPath: folder.path,
        role: index === 0 ? 'main' : 'reference',
        readonly: folder.readonly
      })),
      settings: {}
    })
  }

  async sync(input: WorkspaceSyncInput): Promise<AgentWorkspace> {
    const workspaceFile = input.workspaceFile ?? null
    const now = Date.now()
    const folders = await this.resolveFolders(workspaceFile, input.folders)
    const settings = input.settings ?? this.active?.settings ?? {}
    const createdAt = this.active?.createdAt ?? now
    const workspace = this.toWorkspace({
      workspaceFile,
      folders,
      settings,
      createdAt,
      updatedAt: now
    })
    this.active = workspace
    this.access.setWorkspaceFolders(workspace.folders)
    await this.watcher.sync(existingFolderPaths(workspace))
    await this.persist(workspace)
    return workspace
  }

  async openWorkspaceFile(filePath: string): Promise<AgentWorkspace> {
    const requestedFile = path.resolve(filePath)
    const resolvedFile = await realpath(requestedFile).catch(() => requestedFile)
    let text: string
    try {
      text = await readFile(resolvedFile, 'utf8')
    } catch {
      throw new ValidationError('Unable to read workspace file', { path: resolvedFile })
    }
    const document = parseCodeWorkspace(text)
    this.rawDocument = document
    const piHarness = readPiHarnessSettings(document.settings)
    const folders = await Promise.all(
      document.folders.map(async (folder, index) => {
        const resolvedPath = resolveWorkspaceFolderPath(resolvedFile, folder.path)
        const exists = await directoryExists(resolvedPath)
        if (exists) {
          try {
            await this.access.authorizeRoot(resolvedPath)
          } catch {
            /* keep as missing/unreadable */
          }
        }
        const name = folder.name?.trim() || projectDisplayName(resolvedPath)
        const role = folderRoleFromSettings({ ...folder, resolvedPath }, index, piHarness)
        const readonly = folderReadonlyFromSettings({ ...folder, resolvedPath }, piHarness)
        return {
          path: folder.path,
          resolvedPath,
          name,
          role,
          readonly,
          exists
        }
      })
    )
    return this.sync({
      workspaceFile: resolvedFile,
      folders,
      settings: document.settings ?? {}
    })
  }

  async saveWorkspaceFile(destPath: string, input: WorkspaceSyncInput): Promise<AgentWorkspace> {
    const resolvedDest = await canonicalizeNewPath(destPath)
    const workspace = await this.sync({ ...input, workspaceFile: resolvedDest })
    const document = this.rawDocument ?? { folders: [], settings: workspace.settings }
    const relativeFolders = workspace.folders.map((folder) => {
      const previous = document.folders.find(
        (entry) =>
          entry.path === folder.path ||
          resolveWorkspaceFolderPath(resolvedDest, entry.path) === folder.resolvedPath
      )
      return {
        ...(previous ?? {}),
        path: toWorkspaceRelativePath(resolvedDest, folder.resolvedPath),
        ...(folder.name && folder.name !== projectDisplayName(folder.resolvedPath)
          ? { name: folder.name }
          : {})
      }
    })
    const main = workspace.folders.find((folder) => folder.role === 'main')
    const folderMeta: Record<string, { role?: WorkspaceFolderRole; readonly?: boolean }> = {}
    for (const folder of workspace.folders) {
      const key = toWorkspaceRelativePath(resolvedDest, folder.resolvedPath)
      folderMeta[key] = {
        ...(folder.role !== 'main' && folder.role !== 'reference' ? { role: folder.role } : {}),
        ...(folder.readonly ? { readonly: true } : {})
      }
      if (!Object.keys(folderMeta[key] ?? {}).length) delete folderMeta[key]
    }
    const settings = writePiHarnessSettings(workspace.settings, {
      ...(main ? { mainFolder: toWorkspaceRelativePath(resolvedDest, main.resolvedPath) } : {}),
      ...(Object.keys(folderMeta).length ? { folderMeta } : {})
    })
    const payload: CodeWorkspaceDocument = {
      ...document,
      folders: relativeFolders,
      settings
    }
    await atomicWriteText(resolvedDest, serializeCodeWorkspace(payload))
    this.rawDocument = payload
    return this.sync({
      workspaceFile: resolvedDest,
      folders: workspace.folders,
      settings
    })
  }

  async search(query: string, scope: FileSearchScope, folderId?: string): Promise<FileSearchHit[]> {
    if (!this.active) return []
    return this.searcher.search({
      query,
      folders: this.active.folders,
      scope,
      folderId
    })
  }

  async openInTerminal(directory: string): Promise<void> {
    const realDir = await this.access.assertAllowed(directory, { mustExist: true })
    await openDirectoryInTerminal(realDir)
  }

  async relocateFolder(folderId: string, nextPath: string): Promise<AgentWorkspace> {
    if (!this.active) throw new ValidationError('No active workspace')
    const resolved = await this.access.authorizeRoot(nextPath)
    const folders = this.active.folders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            path: this.active?.workspaceFile
              ? toWorkspaceRelativePath(this.active.workspaceFile, resolved)
              : resolved,
            resolvedPath: resolved,
            name: folder.name || projectDisplayName(resolved),
            exists: true
          }
        : folder
    )
    return this.sync({
      workspaceFile: this.active.workspaceFile,
      folders,
      settings: this.active.settings
    })
  }

  async close(): Promise<void> {
    await this.watcher.close()
  }

  private async hydrate(record: PersistedActiveWorkspace): Promise<AgentWorkspace> {
    const folders = await this.resolveFolders(
      record.workspaceFile,
      record.folders.map((folder) => ({
        path: folder.path,
        resolvedPath: folder.resolvedPath,
        name: folder.name,
        role: folder.role,
        readonly: folder.readonly
      }))
    )
    return this.toWorkspace({ ...record, folders })
  }

  private async resolveFolders(
    workspaceFile: string | null,
    folders: WorkspaceSyncInput['folders']
  ): Promise<
    Array<{
      path: string
      resolvedPath: string
      name: string
      role: WorkspaceFolderRole
      readonly: boolean
      exists: boolean
    }>
  > {
    const resolved = await Promise.all(
      folders.map(async (folder, index) => {
        const resolvedPath = folder.resolvedPath
          ? path.resolve(folder.resolvedPath)
          : workspaceFile
            ? resolveWorkspaceFolderPath(workspaceFile, folder.path)
            : path.resolve(folder.path)
        const exists = await directoryExists(resolvedPath)
        const canonicalPath = exists
          ? await realpath(resolvedPath).catch(() => resolvedPath)
          : resolvedPath
        return {
          path: folder.path,
          resolvedPath: canonicalPath,
          name: folder.name?.trim() || projectDisplayName(canonicalPath),
          role: folder.role ?? (index === 0 ? 'main' : 'reference'),
          readonly: folder.readonly === true,
          exists
        }
      })
    )
    const mainIndex = Math.max(
      0,
      resolved.findIndex((folder) => folder.role === 'main')
    )
    return ensureSingleMainFolder(resolved, mainIndex === -1 ? 0 : mainIndex)
  }

  private toWorkspace(input: {
    workspaceFile: string | null
    folders: Array<{
      path: string
      resolvedPath: string
      name: string
      role: WorkspaceFolderRole
      readonly: boolean
      exists: boolean
    }>
    settings: Record<string, unknown>
    createdAt: number
    updatedAt: number
  }): AgentWorkspace {
    const folders: WorkspaceFolder[] = input.folders.map((folder) => ({
      id: projectIdentityKey(folder.resolvedPath),
      name: folder.name,
      path: folder.path,
      resolvedPath: folder.resolvedPath,
      role: folder.role,
      readonly: folder.readonly,
      exists: folder.exists
    }))
    return {
      id: workspaceIdentity(
        input.workspaceFile,
        folders.map((folder) => folder.resolvedPath)
      ),
      name: workspaceDisplayName(input.workspaceFile, folders),
      workspaceFile: input.workspaceFile,
      folders,
      settings: input.settings,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    }
  }

  private async persist(workspace: AgentWorkspace): Promise<void> {
    const state = await this.store.read()
    const recent = upsertRecent(state.recent, {
      id: workspace.id,
      name: workspace.name,
      workspaceFile: workspace.workspaceFile,
      folderPaths: workspace.folders.map((folder) => folder.resolvedPath),
      lastOpenedAt: workspace.updatedAt
    })
    await this.store.write({
      ...state,
      active: {
        workspaceFile: workspace.workspaceFile,
        folders: workspace.folders.map((folder) => ({
          path: folder.path,
          resolvedPath: folder.resolvedPath,
          name: folder.name,
          role: folder.role,
          readonly: folder.readonly
        })),
        settings: workspace.settings,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt
      },
      recent
    })
  }
}

function existingFolderPaths(workspace: AgentWorkspace): string[] {
  return workspace.folders.filter((folder) => folder.exists).map((folder) => folder.resolvedPath)
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function canonicalizeNewPath(target: string): Promise<string> {
  const resolved = path.resolve(target)
  const parent = await realpath(path.dirname(resolved)).catch(() => path.dirname(resolved))
  return path.join(parent, path.basename(resolved))
}

function upsertRecent(recent: RecentWorkspace[], entry: RecentWorkspace): RecentWorkspace[] {
  return [entry, ...recent.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENT)
}
