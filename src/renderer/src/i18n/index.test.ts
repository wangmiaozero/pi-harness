import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createI18n } from 'vue-i18n'
import { messages } from './index'
import { MARKET_PACKAGE_DESCRIPTION_KEYS } from './marketplace'

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

  it('compiles npm package names in installation messages', () => {
    for (const locale of Object.keys(messages) as Array<keyof typeof messages>) {
      const instance = createI18n({ legacy: false, locale, messages })
      expect(instance.global.t('overview.installHint')).toContain('@earendil-works/pi-coding-agent')
      expect(instance.global.t('overview.installConfirm')).toContain(
        '@earendil-works/pi-coding-agent'
      )
    }
  })

  it('compiles JSON examples as literal text', () => {
    for (const locale of Object.keys(messages) as Array<keyof typeof messages>) {
      const instance = createI18n({ legacy: false, locale, messages })
      expect(instance.global.t('providers.headersPlaceholder')).toBe('{ "X-Custom": "value" }')
    }
  })

  it('localizes every marketplace package description', () => {
    const english = createI18n({ legacy: false, locale: 'en-US', messages })
    const chinese = createI18n({ legacy: false, locale: 'zh-CN', messages })

    expect(Object.keys(MARKET_PACKAGE_DESCRIPTION_KEYS)).toHaveLength(21)
    for (const key of Object.values(MARKET_PACKAGE_DESCRIPTION_KEYS)) {
      expect(english.global.te(key)).toBe(true)
      expect(chinese.global.te(key)).toBe(true)
      expect(english.global.t(key)).not.toBe(chinese.global.t(key))
    }
  })
})
