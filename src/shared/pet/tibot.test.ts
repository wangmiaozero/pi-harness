import { describe, expect, it } from 'vitest'
import { normalizeDesktopPetSettings } from './desktop'
import {
  freshTibotCue,
  isTibotPackId,
  normalizeTibotSettings,
  tibotShapeFromPackId,
  TIBOT_AGENT_ACTIONS,
  TIBOT_COLORS
} from './tibot'

describe('tibot settings', () => {
  it('keeps the studio defaults and clamps motion', () => {
    const settings = normalizeTibotSettings(undefined)
    expect(settings).toMatchObject({
      color: TIBOT_COLORS[0],
      energy: 0.65,
      light: 0.75,
      tracking: true,
      auto: true,
      particles: true,
      paused: false,
      cue: null
    })
    expect(normalizeTibotSettings({ energy: 4, light: -1, shape: 'star', friends: 6 })).toMatchObject({
      energy: 1,
      light: 0
    })
    expect(normalizeTibotSettings({ energy: 4 }).energy).toBe(1)
  })

  it('keeps a palette color and a fresh action cue', () => {
    const cue = { action: 'jump' as const, at: 1_000 }
    expect(normalizeTibotSettings({ color: '#FA6291', cue })).toMatchObject({
      color: '#fa6291',
      cue
    })
    expect(normalizeTibotSettings({ color: '#000000', cue: { action: 'fly', at: 1 } }).cue).toBeNull()
    expect(freshTibotCue(cue, 2_000)).toBe('jump')
    expect(freshTibotCue(cue, 6_000)).toBeNull()
  })

  it('round-trips through desktop pet settings', () => {
    const settings = normalizeDesktopPetSettings({
      activePackId: 'tibot',
      tibot: { auto: false }
    })
    expect(settings.activePackId).toBe('tibot-circle')
    expect(settings.tibot.auto).toBe(false)
    expect(settings.tibot.tracking).toBe(true)
    expect(tibotShapeFromPackId('tibot-ghost')).toBe('ghost')
    expect(isTibotPackId('tibot-star')).toBe(true)
    expect(isTibotPackId('bigfish')).toBe(false)
  })

  it('maps agent states onto performances and leaves idle to auto play', () => {
    expect(TIBOT_AGENT_ACTIONS.success).toBe('celebrate')
    expect(TIBOT_AGENT_ACTIONS.sleeping).toBe('sleep')
    expect(TIBOT_AGENT_ACTIONS.idle).toBeUndefined()
  })
})
