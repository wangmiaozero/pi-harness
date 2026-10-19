// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { markDownloadOrigin } from './download-origin'

const temporary: string[] = []
afterEach(async () => {
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function file() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-origin-'))
  temporary.push(dir)
  const target = path.join(dir, 'installer.part')
  await fs.writeFile(target, 'download')
  return target
}
const source =
  'https://github.com/wangmiaozero/pi-harness/releases/download/v2.0.1/Pi-Harness-Setup-2.0.1.exe'
it.runIf(process.platform === 'darwin')(
  'marks a real downloaded file for macOS quarantine and preserves it on promotion',
  async () => {
    const target = await file()
    await markDownloadOrigin(target, source)
    await fs.link(target, target + '.dmg')
    const quarantine = execFileSync(
      '/usr/bin/xattr',
      ['-p', 'com.apple.quarantine', target + '.dmg'],
      { encoding: 'utf8' }
    )
    expect(quarantine).toMatch(/^0083;[a-f0-9]+;Pi-Harness;/)
  }
)
it.runIf(process.platform === 'win32')(
  'preserves real Windows Internet Zone ADS across installer promotion',
  async () => {
    const target = await file()
    await markDownloadOrigin(target, source)
    await fs.link(target, target + '.exe')
    expect(await fs.readFile(target + '.exe:Zone.Identifier', 'utf8')).toContain('ZoneId=3\r\n')
    expect(await fs.readFile(target + '.exe:Zone.Identifier', 'utf8')).toContain(
      `HostUrl=${source}`
    )
  }
)
it('refuses nonofficial origin metadata', async () => {
  await expect(markDownloadOrigin(await file(), 'https://evil.example/installer')).rejects.toThrow(
    'Untrusted'
  )
})
