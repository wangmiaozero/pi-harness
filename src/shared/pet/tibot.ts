/** One procedural jelly pet per shape. Settings live on the desktop pet. */

export const TIBOT_SHAPES = ['circle', 'rounded', 'jelly', 'triangle', 'star', 'ghost'] as const
export type TibotShape = (typeof TIBOT_SHAPES)[number]

/** Bundled pack id for a single shape. The retired group id `tibot` is not a pet. */
export function tibotPackId(shape: TibotShape): string {
  return `tibot-${shape}`
}

export const TIBOT_PACK_IDS = TIBOT_SHAPES.map((shape) => tibotPackId(shape))

export function tibotShapeFromPackId(id: string): TibotShape | null {
  const normalized = id.trim().toLowerCase()
  if (!normalized.startsWith('tibot-')) return null
  const shape = normalized.slice('tibot-'.length)
  return (TIBOT_SHAPES as readonly string[]).includes(shape) ? (shape as TibotShape) : null
}

export function isTibotPackId(id: string): boolean {
  return tibotShapeFromPackId(id) !== null
}

export const TIBOT_COLORS = ['#ff781b', '#11bfae', '#2588f5', '#ffb13d', '#9a6af4', '#fa6291'] as const

export const TIBOT_ACTIONS = [
  'jump',
  'spin',
  'dance',
  'surprise',
  'sleep',
  'celebrate',
  'wobble',
  'dash',
  'wink'
] as const
export type TibotAction = (typeof TIBOT_ACTIONS)[number]

/** Agent runtime state → one-shot performance. Idle stays on auto play. */
export const TIBOT_AGENT_ACTIONS: Partial<Record<string, TibotAction>> = {
  thinking: 'wobble',
  running: 'dance',
  'tool-calling': 'dash',
  waiting: 'wink',
  success: 'celebrate',
  failed: 'surprise',
  warning: 'surprise',
  sleeping: 'sleep'
}

export interface TibotCue {
  action: TibotAction
  /** Epoch ms. The pet plays it once, and ignores a cue older than a few seconds. */
  at: number
}

export interface TibotSettings {
  color: string
  /** 0–1, the HTML "活跃程度". */
  energy: number
  /** 0–1, the HTML "立体光影". */
  light: number
  tracking: boolean
  auto: boolean
  particles: boolean
  paused: boolean
  cue: TibotCue | null
}

export function defaultTibotSettings(): TibotSettings {
  return {
    color: TIBOT_COLORS[0],
    energy: 0.65,
    light: 0.75,
    tracking: true,
    auto: true,
    particles: true,
    paused: false,
    cue: null
  }
}

function isAction(value: unknown): value is TibotAction {
  return typeof value === 'string' && (TIBOT_ACTIONS as readonly string[]).includes(value)
}

export function normalizeTibotSettings(value: unknown): TibotSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const d = defaultTibotSettings()
  const unit = (input: unknown, fallback: number): number => {
    const n = typeof input === 'number' && Number.isFinite(input) ? input : fallback
    return Math.min(1, Math.max(0, n))
  }
  const color =
    typeof raw.color === 'string' && (TIBOT_COLORS as readonly string[]).includes(raw.color.toLowerCase())
      ? raw.color.toLowerCase()
      : d.color
  let cue: TibotCue | null = null
  if (typeof raw.cue === 'object' && raw.cue !== null) {
    const cueRaw = raw.cue as Record<string, unknown>
    if (isAction(cueRaw.action) && typeof cueRaw.at === 'number' && Number.isFinite(cueRaw.at)) {
      cue = { action: cueRaw.action, at: cueRaw.at }
    }
  }
  return {
    color,
    energy: unit(raw.energy, d.energy),
    light: unit(raw.light, d.light),
    tracking: typeof raw.tracking === 'boolean' ? raw.tracking : d.tracking,
    auto: typeof raw.auto === 'boolean' ? raw.auto : d.auto,
    particles: typeof raw.particles === 'boolean' ? raw.particles : d.particles,
    paused: typeof raw.paused === 'boolean' ? raw.paused : d.paused,
    cue
  }
}

/** A settings-page cue is live only for a few seconds, so a restart does not replay it. */
export function freshTibotCue(cue: TibotCue | null, now = Date.now()): TibotAction | null {
  if (!cue) return null
  if (now - cue.at < 0 || now - cue.at > 4000) return null
  return cue.action
}
