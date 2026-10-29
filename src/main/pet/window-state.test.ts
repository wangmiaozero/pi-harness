import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

const screenMocks = vi.hoisted(() => ({
  displays: [] as Array<{ id: number; workArea: WorkArea }>,
  primary: null as { id: number; workArea: WorkArea } | null
}))

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => screenMocks.displays,
    getPrimaryDisplay: () => screenMocks.primary
  }
}))

import { JsonStore } from '../services/storage'
import {
  DEFAULT_PET_WINDOW_STATE,
  resolvePetWindowPosition,
  clampPetPosition,
  petWindowSize
} from './window-state'

async function makeStore(state: { x: number | null; y: number | null }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'petwinstate-'))
  return { store: new JsonStore(path.join(dir, 'state.json'), state), dir }
}

describe('resolvePetWindowPosition', () => {
  const WINDOW_W = 294
  const WINDOW_H = 235
  const MARGIN = 24

  beforeEach(() => {
    screenMocks.displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1728, height: 1117 } }]
    screenMocks.primary = screenMocks.displays[0]
  })

  afterEach(async () => {
    // JsonStore writes are fire-and-forget; drain before removing the sandbox.
    await new Promise((r) => setTimeout(r, 50))
  })

  it('first launch parks the pet in the bottom-right corner with a margin', async () => {
    const { store, dir } = await makeStore({ ...DEFAULT_PET_WINDOW_STATE })
    try {
      const pos = resolvePetWindowPosition(store, WINDOW_W, WINDOW_H)
      expect(pos.x).toBe(1728 - WINDOW_W - MARGIN)
      expect(pos.y).toBe(1117 - WINDOW_H - MARGIN)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps a saved position that is still on a visible display', async () => {
    const { store, dir } = await makeStore({ x: 300, y: 500 })
    try {
      expect(resolvePetWindowPosition(store, WINDOW_W, WINDOW_H)).toEqual({ x: 300, y: 500 })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('clamps a saved position back into the work area when its display disappears', async () => {
    screenMocks.displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1000, height: 800 } }]
    screenMocks.primary = screenMocks.displays[0]
    const { store, dir } = await makeStore({ x: 5000, y: 5000 })
    try {
      const pos = resolvePetWindowPosition(store, WINDOW_W, WINDOW_H)
      expect(pos.x).toBe(1000 - WINDOW_W)
      expect(pos.y).toBe(800 - WINDOW_H)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('repairs an old saved position with the body partly off screen', async () => {
    const { store, dir } = await makeStore({ x: 1700, y: 1100 })
    try {
      expect(resolvePetWindowPosition(store, WINDOW_W, WINDOW_H)).toEqual({
        x: 1728 - WINDOW_W,
        y: 1117 - WINDOW_H
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the entire window inside each edge and supports negative display coordinates', () => {
    expect(clampPetPosition(1700, 1100, WINDOW_W, WINDOW_H)).toEqual({ x: 1434, y: 882 })
    expect(clampPetPosition(-100, -100, WINDOW_W, WINDOW_H)).toEqual({ x: 0, y: 0 })
    screenMocks.displays.push({ id: 2, workArea: { x: -1200, y: 0, width: 1200, height: 900 } })
    expect(clampPetPosition(-1300, 850, WINDOW_W, WINDOW_H)).toEqual({ x: -1200, y: 665 })
  })

  it('never produces negative coordinates when the window exceeds the work area', async () => {
    screenMocks.displays = [{ id: 1, workArea: { x: 0, y: 0, width: 200, height: 150 } }]
    screenMocks.primary = screenMocks.displays[0]
    const { store, dir } = await makeStore({ ...DEFAULT_PET_WINDOW_STATE })
    try {
      const pos = resolvePetWindowPosition(store, WINDOW_W, WINDOW_H)
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.y).toBeGreaterThanOrEqual(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

it('keeps a maximum-size pet close to the screen edges without a large transparent gutter', () => {
  const size = petWindowSize(240, 412 / 344)
  expect(size).toEqual({ width: 287, height: 353 })
  expect(size.width - (240 * 412) / 344).toBeLessThan(1)
  expect(clampPetPosition(-500, 0, size.width, size.height).x).toBe(0)
})
