import { describe, expect, it } from 'vitest'
import { getPresetFromTools, getToolNamesForPreset } from './tool-presets'

describe('tool presets', () => {
  it('round-trips preset names to tool lists', () => {
    expect(getToolNamesForPreset('none')).toEqual([])
    expect(getToolNamesForPreset('read-only')).toEqual(['read', 'grep', 'find', 'ls'])
    expect(getPresetFromTools([{ name: 'read', description: '', active: true }])).toBe('default')
    expect(
      getPresetFromTools(
        getToolNamesForPreset('full').map((name) => ({ name, description: '', active: true }))
      )
    ).toBe('full')
  })
})
