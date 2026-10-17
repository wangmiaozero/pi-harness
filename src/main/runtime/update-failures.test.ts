// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { RuntimeManager } from './runtime-manager'
import { catalog } from './distribution.mjs'
const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
for (const failure of ['network', 'timeout', 'http', 'checksum', 'corrupted-archive'] as const) {
  it(`preserves active runtime configuration and session data on ${failure} download failure`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-failure-'))
    temporary.push(root)
    const stateFile = path.join(root, 'state.json')
    const baseline = {
      configuration: { pi: { source: 'bundled' }, node: { source: 'bundled' } },
      active: {},
      previous: {}
    }
    await fs.writeFile(stateFile, JSON.stringify(baseline))
    await fs.writeFile(path.join(root, 'session.jsonl'), 'retained session')
    const manager = new RuntimeManager({
      bundledRoot: path.join(root, 'bundled'),
      userRoot: path.join(root, 'managed'),
      stateFile,
      cache: path.join(root, 'cache'),
      fetcher: async (url) => {
        if (failure === 'network') throw new Error('Network unavailable')
        if (failure === 'timeout') throw new DOMException('Request timed out', 'TimeoutError')
        if (failure === 'http') return new Response(null, { status: 503 })
        if (url.endsWith(catalog.pi.checksumsFile))
          return new Response(
            await fs.readFile(path.resolve(`fixtures/runtime/pi-${catalog.pi.version}-SHA256SUMS`))
          )
        return new Response(failure === 'checksum' ? 'wrong archive' : 'corrupt archive bytes')
      }
    })
    await expect(manager.update('pi')).rejects.toThrow()
    expect(JSON.parse(await fs.readFile(stateFile, 'utf8'))).toEqual(baseline)
    expect(await fs.readFile(path.join(root, 'session.jsonl'), 'utf8')).toBe('retained session')
    expect(await manager.configuration()).toEqual(baseline.configuration)
    const entries = await fs.readdir(path.join(root, 'cache')).catch(() => [])
    expect(entries.some((file) => file.endsWith('.part'))).toBe(false)
  })
}
