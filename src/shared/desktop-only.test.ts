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
  it('allows only the fixed official Node.js and application release downloads', () => {
    const sourcePaths = runtimeSources(join(process.cwd(), 'src'))
    const externalCallSites = sourcePaths.filter((path) =>
      /\bopenExternal\b/.test(readFileSync(path, 'utf8'))
    )
    const sources = sourcePaths.map((path) => readFileSync(path, 'utf8')).join('\n')
    const registerSource = readFileSync(join(process.cwd(), 'src/main/ipc/register.ts'), 'utf8')
    const installConstants = readFileSync(
      join(process.cwd(), 'src/shared/constants/pi-install.ts'),
      'utf8'
    )
    const updaterSource = readFileSync(join(process.cwd(), 'src/main/updater/index.ts'), 'utf8')

    expect(externalCallSites).toEqual([
      join(process.cwd(), 'src/main/ipc/register.ts'),
      join(process.cwd(), 'src/main/updater/index.ts')
    ])
    expect(registerSource.match(/\bopenExternal\b/g)).toHaveLength(1)
    expect(registerSource).toContain('shell.openExternal(NODE_DOWNLOAD_URL)')
    expect(installConstants).toContain("NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download'")
    expect(updaterSource.match(/\bopenExternal\b/g)).toHaveLength(1)
    expect(updaterSource).toContain('shell.openExternal(LATEST_RELEASE_URL)')
    expect(updaterSource).toContain(
      "LATEST_RELEASE_URL = 'https://github.com/wangmiaozero/pi-harness/releases/latest'"
    )
    expect(registerSource).toContain(
      "parseInput(noArgsSchema, args, 'Unexpected release page arguments')"
    )
    expect(sources).not.toMatch(/\bwindow\.open\b/)
    expect(sources).not.toMatch(/updater:open-releases/)
  })

  it('denies renderer attempts to create a new window', () => {
    const guard = readFileSync(join(process.cwd(), 'src/main/window/renderer-guards.ts'), 'utf8')
    const mainWindow = readFileSync(join(process.cwd(), 'src/main/window/create-window.ts'), 'utf8')
    const overlay = readFileSync(
      join(process.cwd(), 'src/main/window/screen-motion-overlay.ts'),
      'utf8'
    )

    expect(guard).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(mainWindow).toContain('attachRendererGuards(')
    expect(overlay).toContain('attachRendererGuards(')
  })

  it('keeps the screen-motion overlay preload listen-only', () => {
    const source = readFileSync(join(process.cwd(), 'src/preload/overlay.ts'), 'utf8')

    expect(source).not.toMatch(/ipcRenderer\.invoke/)
    expect(source).toContain('onActive')
    expect(source).toContain('OVERLAY_API_NAMESPACE')
    expect(source).not.toContain('IPC_INVOKE')
  })
})
