import type { HarnessSessionEntry, HarnessSessionInfo } from '@shared/types/harness'
import type { AgentSessionLike } from '../agent/pi-sdk'

export function mapHarnessSession(session: AgentSessionLike): HarnessSessionInfo {
  const manager = session.sessionManager
  const branch = readArray(() => manager.getBranch())
  const activeIds = new Set(branch.map(entryId).filter((id): id is string => id !== null))
  const entries = readArray(() => manager.getEntries())
    .map((entry) => mapEntry(entry, activeIds))
    .filter((entry): entry is HarnessSessionEntry => entry !== null)
  const name = readValue(() => manager.getSessionName(), undefined)

  return {
    sessionId: session.sessionId,
    ...(name ? { name } : {}),
    persisted: readValue(() => manager.isPersisted(), false),
    leafId: readValue(() => manager.getLeafId(), null),
    entries
  }
}

function mapEntry(value: unknown, activeIds: Set<string>): HarnessSessionEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string')
    return null
  return {
    id: value.id,
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    type: value.type,
    ...(isRecord(value.message) && typeof value.message.role === 'string'
      ? { role: value.message.role }
      : {}),
    ...(typeof value.timestamp === 'string' ? { timestamp: value.timestamp } : {}),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
    active: activeIds.has(value.id)
  }
}

function entryId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === 'string' ? value.id : null
}

function readArray(read: () => unknown[]): unknown[] {
  return readValue(read, [])
}

function readValue<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
