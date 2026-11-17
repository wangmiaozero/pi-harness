// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createToolSelection,
  listTools
} from '../../../resources/desktop-extension/tool-selection.mjs'

function fixture() {
  const state = {
    active: ['read', 'ext_previous'],
    registered: ['read', 'grep', 'find', 'ls', 'powershell', 'ext_previous', 'ext_new', 'hidden']
  }
  const pi = {
    getAllTools: () =>
      state.registered.map((name) => ({
        name,
        description: name,
        exposure: name === 'hidden' ? 'hidden' : 'direct',
        sourceInfo: { path: `builtin:${name}` }
      })),
    getActiveTools: () => state.active,
    setActiveTools: vi.fn((names: string[]) => {
      state.active = names.filter((name) => state.registered.includes(name))
    })
  }
  return { state, pi, selection: createToolSelection(pi) }
}

describe('desktop tool selection', () => {
  it('enforces exact custom choices and keeps the fixed preset extension history', () => {
    const { state, pi, selection } = fixture()
    selection.apply(['read', 'ext_new'], { custom: true })
    expect(state.active).toEqual(['read', 'ext_new'])
    expect(selection.allows('ext_new')).toBe(true)
    expect(selection.allows('ext_previous')).toBe(false)
    expect(listTools(pi)).toContainEqual({
      name: 'hidden',
      description: 'hidden',
      active: false,
      available: false,
      source: 'builtin'
    })
    selection.apply(['read', 'grep', 'find', 'ls'], { preserveExtensionTools: true })
    expect(selection.allows('ext_new')).toBe(false)
    expect(selection.allows('read')).toBe(true)
    selection.apply([], { preserveExtensionTools: true })
    expect(selection.allows('read')).toBe(false)
    state.active.push('ext_new')
    selection.apply(['read', 'bash'], { preserveExtensionTools: true })
    expect(state.active).toEqual(['read', 'powershell', 'ext_previous'])
  })

  it('retains temporarily unavailable names and excludes newly registered tools', () => {
    const { state, pi, selection } = fixture()
    selection.apply(['ext_absent'], { custom: true, restore: true })
    expect(state.active).toEqual([])
    state.registered.push('ext_absent', 'ext_renamed')
    state.active = ['ext_renamed']
    selection.refresh()
    expect(state.active).toEqual(['ext_absent'])
    state.registered = []
    selection.refresh()
    expect(listTools(pi)).toEqual([])
    expect(selection.allows('ext_renamed')).toBe(false)
  })

  it('keeps the last confirmed selection when an unknown or ineligible tool is requested', () => {
    const { state, pi, selection } = fixture()
    selection.apply(['read'], { custom: true })
    expect(() => selection.apply(['missing'], { custom: true })).toThrow('no longer available')
    expect(() => selection.apply(['hidden'], { custom: true })).toThrow('no longer available')
    pi.setActiveTools.mockImplementationOnce(() => {
      state.active = []
    })
    expect(() => selection.apply(['ext_new'], { custom: true })).toThrow('could not activate')
    expect(state.active).toEqual(['read'])
    expect(selection.allows('ext_new')).toBe(false)
  })
})
