import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('optional portrait media', () => {
  it('keeps character art out of the application tree', () => {
    expect(existsSync('src/renderer/src/assets/themes')).toBe(false)
    expect(existsSync('src/renderer/src/assets/mascot')).toBe(false)
    expect(existsSync('src/renderer/src/bigfish-startup/assets')).toBe(false)
    expect(existsSync('resources/petpacks')).toBe(false)
  })
})
