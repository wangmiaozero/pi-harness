/**
 * Shared contract for the desktop pet window (BigFish companion).
 *
 * The desktop pet is a read-only visualization of Pi-Harness agent runtime
 * state, rendered in its own transparent frameless window. This module holds
 * the pieces that main, preload and the pet renderer all need:
 *
 * - user-facing settings shape and defaults
 * - pet state → animation clip mapping (with fallbacks)
 * - status bubble copy keys
 * - scheduling constants (minimum play duration, event merge windows)
 *
 * Animation clips come from a pet pack (see docs/desktop-pet/README.md); the
 * BigFish pack ships in `resources/petpacks/bigfish/`. Clip names follow the
 * migrated dsh-dafeiyu / dsh-pet asset layout.
 */

/** Clips available in the bundled BigFish pack (frame counts live in the pack manifest). */
export const BIGFISH_CLIPS = [
  'idle',
  'idle_stretch',
  'idle_yawn',
  'thinking',
  'working',
  'working_search',
  'working_command',
  'waiting',
  'success',
  'error',
  'dragging',
  'dragging_release',
  'head_pat',
  'poke',
  'tail',
  'eat_token'
] as const

export type BigFishClip = (typeof BIGFISH_CLIPS)[number]

export interface PetPackClipInfo {
  dir: string
  frames: number
  loop: boolean
}

export interface PetPackManifest {
  formatVersion: 1
  id: string
  name: string
  nameEn: string
  description?: string
  author: string
  version: string
  license: string
  licenseFiles: string[]
  source?: {
    animationSource?: { repository: string; commit: string; license: string }
    frameConversion?: { repository: string; commit: string; fps: number; crop?: number[] }
  }
  baseWidth: number
  baseHeight: number
  fps: number
  clips: Record<string, PetPackClipInfo>
}

export interface DesktopPetSettings {
  enabled: boolean
  alwaysOnTop: boolean
  /** Pet body height in CSS px; width follows the pack aspect ratio. */
  size: number
  /** Window opacity 0.3–1. */
  opacity: number
  /** Play a random idle variant (stretch / yawn) between idle loops. */
  idleVariants: boolean
  /** Throw/bounce physics after releasing a drag. */
  physics: boolean
  /** Agent state synchronization (pet reacts to runtime events). */
  agentSync: boolean
  /** Show the status bubble. */
  bubbleEnabled: boolean
  /** Seconds before the bubble auto-hides; 0 keeps it while the state holds. */
  bubbleTimeoutSeconds: number
  /** Bubble opacity 0.3–1. */
  bubbleOpacity: number
  /** Reduce motion: no random idle variants, no streaming-driven eat_token. */
  reducedMotion: boolean
  /** Show how many agents/runs are active in the bubble. */
  showAgentCount: boolean
}

export const DESKTOP_PET_SIZE_MIN = 96
export const DESKTOP_PET_SIZE_MAX = 320
export const DESKTOP_PET_SIZE_DEFAULT = 160

export const DEFAULT_DESKTOP_PET_SETTINGS: Readonly<DesktopPetSettings> = Object.freeze({
  enabled: false,
  alwaysOnTop: true,
  size: DESKTOP_PET_SIZE_DEFAULT,
  opacity: 1,
  idleVariants: true,
  physics: true,
  agentSync: true,
  bubbleEnabled: true,
  bubbleTimeoutSeconds: 6,
  bubbleOpacity: 1,
  reducedMotion: false,
  showAgentCount: false
})

/** A fresh mutable copy for stores that need to own their value. */
export function defaultDesktopPetSettings(): DesktopPetSettings {
  return { ...DEFAULT_DESKTOP_PET_SETTINGS }
}

export function normalizeDesktopPetSettings(value: unknown): DesktopPetSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const d = DEFAULT_DESKTOP_PET_SETTINGS
  const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
    return Math.min(max, Math.max(min, n))
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : d.alwaysOnTop,
    size: Math.round(clamp(raw.size, DESKTOP_PET_SIZE_MIN, DESKTOP_PET_SIZE_MAX, d.size)),
    opacity: clamp(raw.opacity, 0.3, 1, d.opacity),
    idleVariants: typeof raw.idleVariants === 'boolean' ? raw.idleVariants : d.idleVariants,
    physics: typeof raw.physics === 'boolean' ? raw.physics : d.physics,
    agentSync: typeof raw.agentSync === 'boolean' ? raw.agentSync : d.agentSync,
    bubbleEnabled: typeof raw.bubbleEnabled === 'boolean' ? raw.bubbleEnabled : d.bubbleEnabled,
    bubbleTimeoutSeconds: Math.round(clamp(raw.bubbleTimeoutSeconds, 0, 60, d.bubbleTimeoutSeconds)),
    bubbleOpacity: clamp(raw.bubbleOpacity, 0.3, 1, d.bubbleOpacity),
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : d.reducedMotion,
    showAgentCount: typeof raw.showAgentCount === 'boolean' ? raw.showAgentCount : d.showAgentCount
  }
}

/**
 * Map a resolved pet state to its primary clip plus a fallback chain.
 * The player walks the chain until it finds a clip that exists in the pack,
 * so packs missing exotic clips degrade gracefully instead of breaking.
 */
export const STATE_CLIP_MAP: Record<string, readonly BigFishClip[]> = {
  idle: ['idle', 'idle_stretch'],
  sleeping: ['idle_yawn', 'idle'],
  thinking: ['thinking', 'working', 'idle'],
  running: ['working', 'thinking', 'idle'],
  'tool-calling': ['working_command', 'working_search', 'working', 'idle'],
  coding: ['working_command', 'working', 'idle'],
  waiting: ['waiting', 'thinking', 'idle'],
  review: ['success', 'idle'],
  success: ['success', 'idle'],
  failed: ['error', 'idle'],
  warning: ['waiting', 'idle']
}

export function clipForState(state: string): readonly BigFishClip[] {
  return STATE_CLIP_MAP[state] ?? ['idle']
}

/**
 * Interaction-driven clips, requested explicitly rather than derived from
 * runtime state. Highest priority while playing, then the runtime state
 * resumes.
 */
export type PetInteractionClip = 'head_pat' | 'poke' | 'tail' | 'eat_token' | 'dragging' | 'dragging_release'

/** Bubble copy: i18n keys under `pet.bubble.*`, resolved in the pet renderer. */
export const STATE_BUBBLE_KEYS: Record<string, string> = {
  idle: 'pet.bubble.idle',
  sleeping: 'pet.bubble.sleeping',
  thinking: 'pet.bubble.thinking',
  running: 'pet.bubble.running',
  'tool-calling': 'pet.bubble.toolCalling',
  coding: 'pet.bubble.coding',
  waiting: 'pet.bubble.waiting',
  review: 'pet.bubble.success',
  success: 'pet.bubble.success',
  failed: 'pet.bubble.failed',
  warning: 'pet.bubble.warning'
}

/** Scheduling guards — prevent animation jitter on high-frequency events. */
export const PET_MIN_STATE_DURATION_MS = 900
/** Streaming/tool events inside this window are merged instead of restarting clips. */
export const PET_EVENT_MERGE_MS = 400
/** eat_token plays at most this often while streaming. */
export const PET_EAT_TOKEN_MIN_INTERVAL_MS = 30_000
