import type { HarnessArtifact, HarnessRun } from '@shared/types/harness'
import type { AgentMessage } from '@shared/types/workspace'

export interface MessageFileChange {
  artifactId: string
  name: string
  path: string
  displayPath: string
  additions: number
  deletions: number
  patch: string | null
  patchTruncated: boolean
}

export interface MessageFileChanges {
  runId: string
  status: 'verified' | 'missing-evidence'
  files: MessageFileChange[]
  additions: number
  deletions: number
}

const FILE_MUTATION_CLAIMS = [
  /(?:我)?(?:已|已经|现已|成功)(?:在.{0,48})?(?:创建|生成|写入|保存|修改|更新|编辑|新增)(?:了)?(?:.{0,48})(?:文件|页面|代码|项目)/s,
  /(?:文件|页面|代码|项目)(?:.{0,48})(?:已|已经|现已|成功)(?:.{0,24})(?:创建|生成|写入|保存|修改|更新|编辑|新增)/s,
  /\b(?:created|generated|wrote|written|saved|updated|modified|edited)\b.{0,80}\b(?:file|files|page|code|project)\b/is,
  /\b(?:file|files|page|code|project)\b.{0,80}\b(?:created|generated|written|saved|updated|modified|edited)\b/is
]

export function buildMessageFileChanges(
  messages: readonly AgentMessage[],
  entryIds: readonly string[],
  runs: readonly HarnessRun[],
  artifacts: readonly HarnessArtifact[]
): Map<string, MessageFileChanges> {
  const result = new Map<string, MessageFileChanges>()
  const artifactsByRun = new Map<string, HarnessArtifact[]>()
  for (const artifact of artifacts) {
    if (artifact.type !== 'file' || !artifact.path) continue
    const grouped = artifactsByRun.get(artifact.runId) ?? []
    grouped.push(artifact)
    artifactsByRun.set(artifact.runId, grouped)
  }

  for (const run of runs) {
    if (!run.anchorEntryId) continue
    const startIndex = entryIds.indexOf(run.anchorEntryId)
    if (startIndex < 0) continue
    const finalAssistantIndex = findFinalAssistantIndex(messages, startIndex)
    const finalEntryId = entryIds[finalAssistantIndex]
    if (!finalEntryId) continue

    const runArtifacts = artifactsByRun.get(run.id) ?? []
    const files = uniqueFiles(runArtifacts.map((artifact) => toFileChange(artifact, run.cwd)))
    if (!files.length) {
      const finalMessage = messages[finalAssistantIndex]
      if (!finalMessage || !claimsFileMutation(finalMessage)) continue
      result.set(finalEntryId, {
        runId: run.id,
        status: 'missing-evidence',
        files: [],
        additions: 0,
        deletions: 0
      })
      continue
    }
    result.set(finalEntryId, {
      runId: run.id,
      status: 'verified',
      files,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0)
    })
  }
  return result
}

function claimsFileMutation(message: AgentMessage): boolean {
  if (message.role !== 'assistant') return false
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
  return FILE_MUTATION_CLAIMS.some((pattern) => pattern.test(text))
}

function findFinalAssistantIndex(messages: readonly AgentMessage[], startIndex: number): number {
  let finalIndex = -1
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role === 'user') break
    if (message?.role === 'assistant') finalIndex = index
  }
  return finalIndex
}

function toFileChange(artifact: HarnessArtifact, cwd: string | null): MessageFileChange {
  const metadata = artifact.metadata
  const resolvedPath = stringValue(metadata.resolvedPath) ?? resolveAgainstCwd(cwd, artifact.path!)
  const displayPath = relativeDisplayPath(cwd, resolvedPath, artifact.path!)
  return {
    artifactId: artifact.id,
    name: artifact.name,
    path: resolvedPath,
    displayPath,
    additions: numberValue(metadata.additions),
    deletions: numberValue(metadata.deletions),
    patch: stringValue(metadata.patch),
    patchTruncated: metadata.patchTruncated === true
  }
}

function uniqueFiles(files: MessageFileChange[]): MessageFileChange[] {
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = normalizeSlashes(file.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveAgainstCwd(cwd: string | null, filePath: string): string {
  if (!cwd || isAbsolutePath(filePath)) return filePath
  return `${cwd.replace(/[\\/]+$/, '')}/${filePath.replace(/^[\\/]+/, '')}`
}

function relativeDisplayPath(
  cwd: string | null,
  resolvedPath: string,
  originalPath: string
): string {
  if (!cwd) return originalPath
  const normalizedCwd = normalizeSlashes(cwd).replace(/\/$/, '')
  const normalizedPath = normalizeSlashes(resolvedPath)
  return normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : originalPath
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}
