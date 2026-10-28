/**
 * Persisted desktop pet window state (position + per-launch size).
 *
 * Stored as JSON next to the app's other stores via the shared JsonStore so
 * it is crash-safe and follows the same settings directory as the rest of
 * the app. Only the pet's own bounds live here; everything user-configurable
 * belongs to AppSettings.desktopPet.
 */

import path from 'node:path'
import { screen } from 'electron'
import { JsonStore } from '../services/storage'
import { userDataDir } from '../services/app-paths'

export interface PetWindowState {
  x: number | null
  y: number | null
}

interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_PET_WINDOW_STATE: PetWindowState = { x: null, y: null }

/** Margin kept between the pet window and the work-area edges on first launch. */
const FIRST_LAUNCH_MARGIN_PX = 24

/** Bottom-right corner of `area` for a window of the given size. */
function bottomRight(area: WorkArea, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.round(area.x + Math.max(0, area.width - width - FIRST_LAUNCH_MARGIN_PX)),
    y: Math.round(area.y + Math.max(0, area.height - height - FIRST_LAUNCH_MARGIN_PX))
  }
}

export function createPetWindowStateStore(): JsonStore<PetWindowState> {
  return new JsonStore<PetWindowState>(
    path.join(userDataDir(), 'pet-window-state.json'),
    DEFAULT_PET_WINDOW_STATE
  )
}

/**
 * Restore the saved position, clamped into a visible display's work area.
 * Handles unplugged monitors, docked windows, and first launch (null).
 */
export function resolvePetWindowPosition(
  store: JsonStore<PetWindowState>,
  width: number,
  height: number
): { x: number; y: number } {
  const state = store.peek()
  const displays = screen.getAllDisplays()
  const saved = state.x !== null && state.y !== null ? { x: state.x, y: state.y } : null
  if (saved) {
    const home = displays.find(
      (d) =>
        saved.x >= d.workArea.x &&
        saved.y >= d.workArea.y &&
        saved.x < d.workArea.x + d.workArea.width &&
        saved.y < d.workArea.y + d.workArea.height
    )
    if (home) return clampPetPosition(saved.x, saved.y, width, height)
  }
  // First launch: park the pet in the bottom-right corner of the primary
  // display's work area, matching the upstream reference (dsh-dafeiyu
  // PetController.restorePosition). A centered transparent window lands on
  // top of whatever the user is doing — e.g. the settings page.
  const primary = screen.getPrimaryDisplay()
  const target = saved
    ? displays.reduce((best, d) => {
        const cx = d.workArea.x + d.workArea.width / 2
        const cy = d.workArea.y + d.workArea.height / 2
        const bcx = best.workArea.x + best.workArea.width / 2
        const bcy = best.workArea.y + best.workArea.height / 2
        return Math.hypot(cx - saved.x, cy - saved.y) < Math.hypot(bcx - saved.x, bcy - saved.y)
          ? d
          : best
      }, primary)
    : primary
  const area = target.workArea
  if (!saved) return bottomRight(area, width, height)
  // Saved display disappeared: keep the relative position, clamped inside
  // the nearest display's work area (never negative if the window is larger).
  return {
    x: Math.round(Math.min(Math.max(saved.x, area.x), area.x + Math.max(0, area.width - width))),
    y: Math.round(Math.min(Math.max(saved.y, area.y), area.y + Math.max(0, area.height - height)))
  }
}

/**
 * Clamp a moved window position so the pet can never leave screen space.
 * Keeps the complete window visible, including after restoring old positions.
 */
export function clampPetPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const workAreas = [
    screen.getPrimaryDisplay().workArea,
    ...screen.getAllDisplays().map((d) => d.workArea)
  ]
  // Pick the work area containing (or nearest to) the pet's center.
  const centerX = x + width / 2
  const centerY = y + height / 2
  const area = workAreas.reduce((best, a) => {
    const dx = centerX - (a.x + a.width / 2)
    const dy = centerY - (a.y + a.height / 2)
    const bd = Math.hypot(centerX - (best.x + best.width / 2), centerY - (best.y + best.height / 2))
    return Math.hypot(dx, dy) < bd ? a : best
  }, workAreas[0])
  const minX = area.x
  const maxX = area.x + Math.max(0, area.width - width)
  const minY = area.y
  const maxY = area.y + Math.max(0, area.height - height)
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, x))),
    y: Math.round(Math.min(maxY, Math.max(minY, y)))
  }
}
