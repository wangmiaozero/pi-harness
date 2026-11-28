export const FLOW_TITLE = 'Welcome to Pi-Harness'

// Milliseconds from the first painted frame, independent of app initialization.
export const FLOW_TIMELINE = {
  seed: 0,
  unfold: 500,
  lettering: 3500,
  title: 6500,
  vortex: 9000,
  contraction: 12300,
  mark: 14500,
  iris: 17500,
  end: 19000
} as const

export const BRIEF_FLOW = {
  iris: 4700,
  end: 5150,
  readyTimeout: 2800
} as const

const briefScenes = [
  [0, FLOW_TIMELINE.seed],
  [160, FLOW_TIMELINE.unfold],
  [1150, FLOW_TIMELINE.lettering],
  [1980, FLOW_TIMELINE.title],
  [2650, FLOW_TIMELINE.vortex],
  [3550, FLOW_TIMELINE.contraction],
  [4000, FLOW_TIMELINE.mark],
  [BRIEF_FLOW.iris, FLOW_TIMELINE.iris]
] as const

export function briefFlowTime(elapsed: number): number {
  for (let i = 1; i < briefScenes.length; i++) {
    const [end, sceneEnd] = briefScenes[i]
    if (elapsed > end) continue
    const [start, sceneStart] = briefScenes[i - 1]
    return sceneStart + (sceneEnd - sceneStart) * between(start, end, elapsed)
  }
  return FLOW_TIMELINE.iris
}

export const FLOW_LIMITS = {
  moduleTimeout: 3000,
  readyTimeout: 6500,
  skipReveal: 250,
  pixelBudget: 2_750_000,
  lowPixelBudget: 1_050_000,
  coreFibers: 96,
  extraFibers: 90,
  points: 43
} as const

/** Wall-clock limit. A stalled frame loop must not leave the cover up. */
export function flowDismissalCap(brief: boolean): number {
  const timeline = brief ? BRIEF_FLOW.end : FLOW_TIMELINE.end
  const ready = brief ? BRIEF_FLOW.readyTimeout : FLOW_LIMITS.readyTimeout
  return timeline + ready
}

export function clamp(value: number): number {
  return Math.max(0, Math.min(value, 1))
}

export function between(start: number, end: number, time: number): number {
  return clamp((time - start) / (end - start))
}

export function smooth(start: number, end: number, time: number): number {
  const t = between(start, end, time)
  return t * t * (3 - 2 * t)
}

export function flowStage(time: number) {
  if (time < FLOW_TIMELINE.unfold) return 'seed'
  if (time < FLOW_TIMELINE.lettering) return 'unfold'
  if (time < FLOW_TIMELINE.title) return 'lettering'
  if (time < FLOW_TIMELINE.vortex) return 'title'
  if (time < FLOW_TIMELINE.mark) return 'vortex'
  return 'mark'
}

export function flowResolution(width: number, height: number, dpr: number, low: boolean): number {
  return Math.min(
    dpr || 1,
    low ? 1 : 1.65,
    Math.sqrt(
      (low ? FLOW_LIMITS.lowPixelBudget : FLOW_LIMITS.pixelBudget) / Math.max(1, width * height)
    )
  )
}

export function irisRadius(width: number, height: number, progress: number): number {
  // A small initial opening followed by a long, smooth acceleration and settle.
  const t = clamp(progress)
  return (Math.hypot(width, height) / 2 + 3) * (t * t * (3 - 2 * t))
}
