import { describe, expect, it } from 'vitest'
import type { ToolCallContent, ToolResultMessage } from '@shared/types/workspace'
import { toolExitCode, toolOutcome } from './tool-outcome'

const call = (command: string): ToolCallContent => ({
  type: 'toolCall',
  toolCallId: '1',
  toolName: 'bash',
  input: { command }
})
function result(text = 'Command exited with code 1'): ToolResultMessage {
  return { role: 'toolResult', toolCallId: '1', isError: true, content: [{ type: 'text', text }] }
}

describe('tool outcome presentation', () => {
  it('recognizes a literal search with no output without rewriting Native results', () => {
    const raw = result()
    const before = structuredClone(raw)
    expect(toolOutcome(call('rg -n "missing|also missing" src'), raw)).toBe('no-match')
    expect(toolExitCode(raw)).toBe(1)
    expect(raw).toEqual(before)
    expect(
      toolOutcome(
        { ...call(''), toolName: 'grep' },
        { ...raw, isError: false, content: [{ type: 'text', text: 'No matches found' }] }
      )
    ).toBe('no-match')
    expect(
      toolOutcome(call('rg missing src'), { ...raw, content: [], details: { exitCode: 1 } })
    ).toBe('no-match')
  })

  it.each([
    'pnpm test',
    'rg missing src && pnpm test',
    'rg missing src | head -80',
    'rg x src; exit 1',
    'rg "$(false)" src',
    'rg `false` src',
    'rg x > output',
    'rg "unclosed',
    'rg x\nfalse',
    'custom-search missing',
    'bash -c "rg x"'
  ])('keeps ambiguous or non-search commands as errors: %s', (command) => {
    expect(toolOutcome(call(command), result())).toBe('error')
  })

  it.each([
    'rg: missing: No such file or directory\n\nCommand exited with code 2',
    'rg: regex parse error\n\nCommand exited with code 2',
    'Permission denied\n\nCommand exited with code 1',
    'Command timed out after 5 seconds',
    'Command aborted',
    '3:matching result\n\nCommand exited with code 1'
  ])('never hides diagnostics or partial output: %s', (text) => {
    expect(toolOutcome(call('rg x src'), result(text))).toBe('error')
  })

  it('retains cancellation and unknown outcomes, even when the exit code is one', () => {
    expect(
      toolOutcome(call('rg x'), { ...result(), details: { exitCode: 1, cancelled: true } })
    ).toBe('error')
    expect(toolOutcome(undefined, result())).toBe('error')
    expect(toolOutcome(call('rg x'))).toBe('pending')
    expect(toolOutcome(call('rg x'), { ...result('3:match'), isError: false })).toBe('success')
  })
})
