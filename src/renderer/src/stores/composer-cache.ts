import { toComposerThinkingLevel } from '@shared/constants/index'
import { isToolPreset, type ToolPreset } from '@shared/workspace/tool-presets'

export const COMPOSER_CACHE_KEY = 'pi-harness.composer.v1'
const MAX_SESSION_ENTRIES = 80
const THINKING_LEVELS = new Set<string>([
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
])

export type ComposerSelection = {
  thinkingLevel: string
  toolPreset: ToolPreset
}

export type ComposerCacheState = ComposerSelection & {
  bySession: Record<string, ComposerSelection>
}

const EMPTY_CACHE: ComposerCacheState = {
  thinkingLevel: 'auto',
  toolPreset: 'default',
  bySession: {}
}

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function readComposerCache(): ComposerCacheState {
  try {
    const raw = storage()?.getItem(COMPOSER_CACHE_KEY)
    if (!raw) return { ...EMPTY_CACHE, bySession: {} }
    const parsed = JSON.parse(raw) as Partial<ComposerCacheState>
    const bySession: Record<string, ComposerSelection> = {}
    if (parsed.bySession && typeof parsed.bySession === 'object') {
      for (const [sessionId, value] of Object.entries(parsed.bySession)) {
        const selection = normalizeSelection(value)
        if (selection) bySession[sessionId] = selection
      }
    }
    return {
      thinkingLevel: normalizeThinking(parsed.thinkingLevel),
      toolPreset: normalizePreset(parsed.toolPreset),
      bySession
    }
  } catch {
    return { ...EMPTY_CACHE, bySession: {} }
  }
}

export function rememberComposerCache(
  sessionId: string | null,
  selection: ComposerSelection
): ComposerCacheState {
  const next: ComposerCacheState = {
    thinkingLevel: normalizeThinking(selection.thinkingLevel),
    toolPreset: normalizePreset(selection.toolPreset),
    bySession: { ...readComposerCache().bySession }
  }
  if (sessionId) {
    const { [sessionId]: _removed, ...rest } = next.bySession
    next.bySession = {
      ...rest,
      [sessionId]: { thinkingLevel: next.thinkingLevel, toolPreset: next.toolPreset }
    }
    const ids = Object.keys(next.bySession)
    if (ids.length > MAX_SESSION_ENTRIES) delete next.bySession[ids[0] ?? '']
  }
  writeComposerCache(next)
  return next
}

export function forgetComposerCache(sessionId: string): void {
  const current = readComposerCache()
  if (!current.bySession[sessionId]) return
  const { [sessionId]: _removed, ...bySession } = current.bySession
  writeComposerCache({ ...current, bySession })
}

export function hydrateComposerSelections(
  target: Map<string, ComposerSelection>
): ComposerSelection {
  const cached = readComposerCache()
  target.clear()
  for (const [sessionId, selection] of Object.entries(cached.bySession)) {
    target.set(sessionId, selection)
  }
  return { thinkingLevel: cached.thinkingLevel, toolPreset: cached.toolPreset }
}

function writeComposerCache(state: ComposerCacheState): void {
  try {
    storage()?.setItem(COMPOSER_CACHE_KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode */
  }
}

function normalizeSelection(value: unknown): ComposerSelection | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ComposerSelection>
  return {
    thinkingLevel: normalizeThinking(record.thinkingLevel),
    toolPreset: normalizePreset(record.toolPreset)
  }
}

function normalizeThinking(value: unknown): string {
  if (typeof value !== 'string') return 'auto'
  const normalized = toComposerThinkingLevel(value)
  if (THINKING_LEVELS.has(normalized)) return normalized
  return 'medium'
}

function normalizePreset(value: unknown): ToolPreset {
  return isToolPreset(value) ? value : 'default'
}
