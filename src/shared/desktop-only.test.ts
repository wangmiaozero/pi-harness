import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return runtimeSources(path)
    return /\.(?:ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('desktop-only runtime', () => {
  it('does not expose or invoke a system browser', () => {
    const sources = runtimeSources(join(process.cwd(), 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(sources).not.toMatch(/\bopenExternal\b/)
    expect(sources).not.toMatch(/\bwindow\.open\b/)
    expect(sources).not.toMatch(/updater:open-releases/)
  })

  it('denies renderer attempts to create a new window', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/window/create-window.ts'), 'utf8')

    expect(source).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))")
  })
})
