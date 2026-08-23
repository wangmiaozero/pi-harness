import type { PetAnimation, PetManifest, PetState } from './types'

export const PET_ANIMATIONS: Record<PetState, PetAnimation> = {
  idle: { row: 0, frames: 6, fps: 5, loop: true },
  thinking: { row: 1, frames: 6, fps: 7, loop: true },
  running: { row: 2, frames: 8, fps: 10, loop: true },
  coding: { row: 3, frames: 8, fps: 10, loop: true },
  'tool-calling': { row: 4, frames: 8, fps: 10, loop: true },
  waiting: { row: 5, frames: 6, fps: 5, loop: true },
  review: { row: 6, frames: 6, fps: 5, loop: true },
  success: { row: 7, frames: 8, fps: 10, loop: false },
  failed: { row: 8, frames: 6, fps: 5, loop: true },
  warning: { row: 9, frames: 6, fps: 7, loop: true },
  waving: { row: 10, frames: 8, fps: 9, loop: false },
  jumping: { row: 11, frames: 8, fps: 11, loop: false },
  sleeping: { row: 12, frames: 4, fps: 3, loop: true }
}

export const PET_STATE_FALLBACK: Partial<Record<PetState, PetState>> = {
  thinking: 'idle',
  coding: 'running',
  'tool-calling': 'running',
  waiting: 'idle',
  review: 'idle',
  success: 'jumping',
  warning: 'idle',
  sleeping: 'idle'
}

export function singleFrameAnimation(state: PetState): PetAnimation {
  const animation = PET_ANIMATIONS[state]
  return { row: 0, frames: 1, fps: animation.fps, loop: animation.loop }
}

export function resolvePetAnimation(
  manifest: PetManifest,
  state: PetState
): { state: PetState; animation: PetAnimation } | null {
  const visited = new Set<PetState>()
  let candidate: PetState | undefined = state
  while (candidate && !visited.has(candidate)) {
    visited.add(candidate)
    const animation = manifest.animations[candidate]
    if (animation) return { state: candidate, animation }
    candidate = PET_STATE_FALLBACK[candidate]
  }
  const idle = manifest.animations.idle
  return idle ? { state: 'idle', animation: idle } : null
}
