import type {
  BranchSiblings,
  SessionForkNode,
  SessionInfo,
  SessionProjectGroup
} from '../types/workspace'
import { projectIdentityKey } from './project-identity'

export function projectDisplayName(projectRoot: string): string {
  const trimmed = projectRoot.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed) || projectRoot || '(unknown)'
}

/**
 * Keep explicitly opened project roots visible even when Pi has no session for
 * them yet, then append projects discovered from existing Pi sessions.
 */
export function mergeWorkspaceProjects(
  projectRoots: string[],
  sessionGroups: SessionProjectGroup[],
  platform?: NodeJS.Platform
): SessionProjectGroup[] {
  const groupsByKey = new Map(sessionGroups.map((group) => [group.projectKey, group]))
  const merged: SessionProjectGroup[] = []
  const seen = new Set<string>()

  for (const projectRoot of projectRoots) {
    const projectKey = projectIdentityKey(projectRoot, platform)
    if (!projectKey || seen.has(projectKey)) continue
    const existing = groupsByKey.get(projectKey)
    merged.push({
      projectKey,
      projectRoot,
      name: projectDisplayName(projectRoot),
      sessions: existing?.sessions ?? []
    })
    seen.add(projectKey)
  }

  for (const group of sessionGroups) {
    if (seen.has(group.projectKey)) continue
    merged.push(group)
    seen.add(group.projectKey)
  }

  return merged
}

export function groupSessionsByProject(
  sessions: SessionInfo[],
  platform?: NodeJS.Platform
): SessionProjectGroup[] {
  const groups = new Map<string, SessionProjectGroup>()
  for (const session of sessions) {
    const projectRoot = session.projectRoot || session.cwd || ''
    const projectKey = session.projectKey || projectIdentityKey(projectRoot, platform)
    const existing = groups.get(projectKey)
    if (existing) {
      existing.sessions.push(session)
      continue
    }
    groups.set(projectKey, {
      projectKey,
      projectRoot,
      name: projectDisplayName(projectRoot),
      sessions: [session]
    })
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((a, b) => b.modified.localeCompare(a.modified))
    }))
    .sort((a, b) => {
      const aMod = a.sessions[0]?.modified ?? ''
      const bMod = b.sessions[0]?.modified ?? ''
      return bMod.localeCompare(aMod)
    })
}

export function buildSessionForkTree(sessions: SessionInfo[]): SessionForkNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const children = new Map<string, SessionInfo[]>()
  const roots: SessionInfo[] = []

  for (const session of sessions) {
    const parentId = session.parentSessionId
    if (parentId && byId.has(parentId)) {
      const list = children.get(parentId) ?? []
      list.push(session)
      children.set(parentId, list)
    } else {
      roots.push(session)
    }
  }

  const walk = (session: SessionInfo): SessionForkNode => ({
    session,
    children: (children.get(session.id) ?? [])
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .map(walk)
  })

  return roots.sort((a, b) => b.modified.localeCompare(a.modified)).map(walk)
}

export function getSiblingBranchIds(
  entries: Array<{ id: string; parentId: string | null }>,
  entryId: string
): BranchSiblings {
  const target = entries.find((entry) => entry.id === entryId)
  if (!target) return { ids: [entryId], index: 0 }
  const ids = entries.filter((entry) => entry.parentId === target.parentId).map((entry) => entry.id)
  const index = Math.max(0, ids.indexOf(entryId))
  return { ids, index }
}
