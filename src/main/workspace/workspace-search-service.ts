import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FileSearchHit, FileSearchScope, WorkspaceFolder } from '@shared/types/workspace'
import { isIgnoredWorkspaceDirectoryName } from '@shared/workspace/search-ignore'
import type { FileAccessService } from '../files/file-access-service'

const MAX_MATCHES = 200
const MAX_SCANNED_FILES = 5_000
const MAX_CONTENT_BYTES = 256 * 1024

export class WorkspaceSearchService {
  constructor(private readonly access: FileAccessService) {}

  async search(input: {
    query: string
    folders: WorkspaceFolder[]
    scope: FileSearchScope
    folderId?: string
  }): Promise<FileSearchHit[]> {
    const query = input.query.trim().toLowerCase()
    if (!query) return []
    const targets = selectSearchFolders(input.folders, input.scope, input.folderId)
    const hits: FileSearchHit[] = []
    let scanned = 0

    for (const folder of targets) {
      if (!folder.exists) continue
      const root = await this.access.assertAllowed(folder.resolvedPath, { mustExist: true })
      scanned = await walk(root, folder, query, hits, scanned)
      if (hits.length >= MAX_MATCHES || scanned >= MAX_SCANNED_FILES) break
    }
    return hits.slice(0, MAX_MATCHES)
  }
}

function selectSearchFolders(
  folders: WorkspaceFolder[],
  scope: FileSearchScope,
  folderId?: string
): WorkspaceFolder[] {
  if (scope === 'main') {
    const main = folders.find((folder) => folder.role === 'main')
    return main ? [main] : folders.slice(0, 1)
  }
  if (scope === 'folder' && folderId) {
    return folders.filter((folder) => folder.id === folderId)
  }
  return folders
}

async function walk(
  directory: string,
  folder: WorkspaceFolder,
  query: string,
  hits: FileSearchHit[],
  scanned: number
): Promise<number> {
  let current = scanned
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return current
  }
  for (const entry of entries) {
    if (hits.length >= MAX_MATCHES || current >= MAX_SCANNED_FILES) return current
    if (isIgnoredWorkspaceDirectoryName(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    let isDirectory = entry.isDirectory()
    if (!isDirectory && !entry.isFile()) {
      try {
        isDirectory = (await stat(fullPath)).isDirectory()
      } catch {
        continue
      }
    }
    if (isDirectory) {
      current = await walk(fullPath, folder, query, hits, current)
      continue
    }
    current += 1
    const relativePath = path.relative(folder.resolvedPath, fullPath).split(path.sep).join('/')
    const nameHit = relativePath.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query)
    if (nameHit) {
      hits.push({
        workspaceFolderId: folder.id,
        workspaceFolderName: folder.name,
        relativePath,
        absolutePath: fullPath
      })
      continue
    }
    const contentHit = await matchFileContent(fullPath, query)
    if (contentHit) {
      hits.push({
        workspaceFolderId: folder.id,
        workspaceFolderName: folder.name,
        relativePath,
        absolutePath: fullPath,
        line: contentHit.line,
        preview: contentHit.preview
      })
    }
  }
  return current
}

async function matchFileContent(
  filePath: string,
  query: string
): Promise<{ line: number; preview: string } | null> {
  try {
    const st = await stat(filePath)
    if (!st.isFile() || st.size > MAX_CONTENT_BYTES) return null
    const text = await readFile(filePath, 'utf8')
    if (text.includes('\0')) return null
    const lines = text.split(/\r?\n/)
    const index = lines.findIndex((line) => line.toLowerCase().includes(query))
    if (index === -1) return null
    return { line: index + 1, preview: lines[index]?.slice(0, 240) ?? '' }
  } catch {
    return null
  }
}
