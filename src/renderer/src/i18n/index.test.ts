import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { messages } from './index'

function leafPaths(tree: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [path] : leafPaths(value as Record<string, unknown>, path)
  })
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(child)
    return /\.(?:ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [child] : []
  })
}

describe('localized copy', () => {
  it('keeps English and Simplified Chinese message keys in sync', () => {
    const english = leafPaths(messages['en-US']).sort()
    const chinese = leafPaths(messages['zh-CN']).sort()

    expect(chinese).toEqual(english)
  })

  it('does not ship empty localized messages', () => {
    for (const locale of Object.keys(messages) as Array<keyof typeof messages>) {
      const values = Object.values(messages[locale]).flatMap((section) => Object.values(section))
      expect(values.every((value) => value.trim().length > 0)).toBe(true)
    }
  })

  it('defines every static message key used by renderer components', () => {
    const available = new Set(leafPaths(messages['en-US']))
    const used = sourceFiles(join(process.cwd(), 'src/renderer/src')).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return Array.from(source.matchAll(/(?:\$t|\bt)\(['"]([\w.-]+)['"]/g), (match) => match[1])
    })

    expect(used.filter((key) => !available.has(key))).toEqual([])
  })
})
