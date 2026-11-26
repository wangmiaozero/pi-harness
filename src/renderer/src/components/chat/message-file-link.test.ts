import { describe, expect, it } from 'vitest'
import { parseMessageFileLink, resolveMessageFilePath } from './message-file-link'

describe('chat file links', () => {
  it.each([
    ['migrations/002%20support.sql:20:3', 'migrations/002 support.sql', 20],
    ['README.md:12', 'README.md', 12],
    ['/workspace/packages/main.ts#L9-L14', '/workspace/packages/main.ts', 9],
    ['file:///workspace/My%20File.md#L2', '/workspace/My File.md', 2],
    ['file:///C:/project/README.md', 'C:/project/README.md', undefined],
    ['C:/project/README.md:12', 'C:/project/README.md', 12],
    ['docs/topic%3A10.md', 'docs/topic:10.md', undefined]
  ])('parses %s as a file reference', (href, path, line) => {
    expect(parseMessageFileLink(href)).toEqual({ path, line })
  })

  it.each([
    'https://example.invalid/README.md#L3',
    '//example.invalid/README.md',
    'mailto:team@example.invalid',
    'javascript:alert(1)',
    'javascript:123',
    'javascript%3Aalert(1)',
    '#heading'
  ])('does not interpret %s as a file', (href) => {
    expect(parseMessageFileLink(href)).toBeNull()
  })

  it('resolves relative paths from the conversation workspace', () => {
    expect(resolveMessageFilePath('./src/../README.md', '/workspace/project')).toBe(
      '/workspace/project/README.md'
    )
    expect(resolveMessageFilePath('src/README.md', 'C:\\project')).toBe(
      'C:\\project\\src\\README.md'
    )
    expect(resolveMessageFilePath('../outside.md', '/workspace/project')).toBe(
      '/workspace/outside.md'
    )
    expect(resolveMessageFilePath('README.md', null)).toBeNull()
  })
})
