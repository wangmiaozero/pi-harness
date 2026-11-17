import { describe, expect, it } from 'vitest'
import { DEFAULT_TOOL_PRESET, getPresetFromTools, getToolNamesForPreset } from './tool-presets'

const active = (...names: string[]) =>
  names.map((name) => ({ name, description: '', active: true }))

describe('tool presets', () => {
  it.each([
    ['none', []],
    ['read-only', ['read', 'grep', 'find', 'ls']],
    ['default', ['read', 'bash', 'edit', 'write']],
    ['full', ['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']]
  ] as const)('round-trips %s with its original tools', (preset, names) => {
    expect(getToolNamesForPreset(preset)).toEqual(names)
    expect(getPresetFromTools(active(...names))).toBe(preset)
    expect(DEFAULT_TOOL_PRESET).toBe('full')
  })

  it('recognizes custom combinations and a platform shell variant', () => {
    expect(getPresetFromTools(active('read'))).toBe('custom')
    expect(getPresetFromTools(active('read', 'bash', 'edit', 'write', 'extension_x'))).toBe(
      'custom'
    )
    expect(getPresetFromTools(active('read', 'powershell', 'edit', 'write'))).toBe('default')
    expect(getPresetFromTools(active('read', 'bash', 'powershell', 'edit', 'write'))).toBe('custom')
  })
})
