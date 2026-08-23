import { describe, expect, it } from 'vitest'
import { categorizePetTool, isCodingTool } from './tool-detector'

describe('pet tool detector', () => {
  it('distinguishes code mutations from read-only tools', () => {
    expect(isCodingTool('apply_patch')).toBe(true)
    expect(isCodingTool('edit_file')).toBe(true)
    expect(isCodingTool('replace-code')).toBe(true)
    expect(isCodingTool('read_file')).toBe(false)
    expect(isCodingTool('search_files')).toBe(false)
  })

  it('categorizes common runtime tools for status copy', () => {
    expect(categorizePetTool('apply_patch')).toBe('coding')
    expect(categorizePetTool('exec_command')).toBe('shell')
    expect(categorizePetTool('git_diff')).toBe('git')
    expect(categorizePetTool('mcp_browser_open')).toBe('mcp')
    expect(categorizePetTool('read_file')).toBe('filesystem')
  })
})
