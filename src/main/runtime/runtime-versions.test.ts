// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { RuntimeVersionService } from './runtime-versions'
import { installedSdkVersions } from './sdk-matrix.mjs'
import { latestStable, PI_SDK_PACKAGES, upstreamJson } from './version-sources.mjs'
import { catalog } from './distribution.mjs'
import type { ResolvedRuntime } from '@shared/runtime/schema'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})
const runtime = (kind: 'pi' | 'node'): ResolvedRuntime => ({
  source: 'bundled',
  executablePath: null,
  version: catalog[kind].version,
  platform: process.platform,
  arch: process.arch,
  valid: true,
  integrity: 'verified',
  diagnosticMessages: []
})
const info = () => ({ pi: runtime('pi'), node: runtime('node') })
const matrix = async () =>
  Object.fromEntries(PI_SDK_PACKAGES.map((name) => [name, catalog.pi.version]))
function sources() {
  return vi.fn(async (url: string) => {
    if (url.includes('nodejs.org'))
      return Response.json([
        { version: 'v26.12.0', lts: false },
        { version: `v${catalog.node.version}`, lts: 'Krypton' }
      ])
    if (url.includes('/releases?'))
      return Response.json([
        { tag_name: 'v99.0.0', draft: true, prerelease: false },
        { tag_name: 'v98.0.0-rc.1', draft: false, prerelease: true },
        {
          tag_name: url.includes('earendil-works') ? `v${catalog.pi.version}` : 'v2.1.1',
          draft: false,
          prerelease: false
        }
      ])
    return Response.json({
      'dist-tags': { latest: '2.0.0-beta.1' },
      versions: { [catalog.pi.version]: {}, '2.0.0-beta.1': {} }
    })
  })
}
async function setup(fetcher = sources()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-versions-'))
  temporary.push(root)
  const cacheFile = path.join(root, 'versions.json')
  return {
    root,
    cacheFile,
    fetcher,
    service: new RuntimeVersionService({
      cacheFile,
      fetcher,
      sdkVersions: matrix,
      appVersion: '2.1.1'
    })
  }
}
it('reads the actual installed SDK packages and verifies every component against the bundled Pi version', async () => {
  expect(await installedSdkVersions()).toEqual(await matrix())
})
it('does not contact upstream sources on startup and keeps unchecked versions unknown', async () => {
  const { service, fetcher } = await setup()
  const report = await service.report(info())
  expect(fetcher).not.toHaveBeenCalled()
  expect(report.components.find((row) => row.component === 'pi')).toMatchObject({
    installedVersion: catalog.pi.version,
    latestStableVersion: null,
    checkState: 'not-checked'
  })
})
it('filters prereleases and drafts, selects LTS, and coalesces concurrent manual checks', async () => {
  const { service, fetcher } = await setup()
  const [report] = await Promise.all([service.report(info(), true), service.report(info(), true)])
  expect(fetcher).toHaveBeenCalledTimes(PI_SDK_PACKAGES.length + 3)
  expect(report.components.find((row) => row.component === 'pi')).toMatchObject({
    latestStableVersion: catalog.pi.version,
    compatible: true,
    checkState: 'current'
  })
  expect(report.components.find((row) => row.component === 'node')).toMatchObject({
    latestStableVersion: catalog.node.version
  })
  expect(report.sdkPackages.every((row) => row.compatible === true)).toBe(true)
  expect(latestStable(['1.2.0', '1.3.0', '2.0.0-rc.1'])).toBe('1.3.0')
})
it('retains cached timestamps after an offline check without inventing a newer installed version or changing configuration', async () => {
  const { service, cacheFile, root } = await setup()
  const stateFile = path.join(root, 'configuration.json')
  await fs.writeFile(stateFile, 'original configuration and credentials fixture')
  const online = await service.report(info(), true)
  const offline = new RuntimeVersionService({
    cacheFile,
    fetcher: async () => {
      throw new Error('offline')
    },
    sdkVersions: matrix
  })
  const selected = info()
  selected.node.version = '24.21.0'
  selected.node.source = 'system'
  const report = await offline.report(selected, true)
  expect(report.components.find((row) => row.component === 'node')).toMatchObject({
    installedVersion: '24.21.0',
    latestStableVersion: catalog.node.version,
    source: 'system',
    updateAvailable: true,
    checkState: 'cached'
  })
  expect(report.checkedAt).toBe(online.checkedAt)
  expect(await fs.readFile(stateFile, 'utf8')).toBe(
    'original configuration and credentials fixture'
  )
})
it('reports first-check failures and missing runtimes as unverified rather than up to date', async () => {
  const { cacheFile } = await setup()
  const service = new RuntimeVersionService({
    cacheFile,
    fetcher: async () => {
      throw new Error('offline')
    },
    sdkVersions: matrix
  })
  const selected = info()
  selected.pi.version = null
  selected.pi.valid = false
  const report = await service.report(selected, true)
  expect(report.components.find((row) => row.component === 'pi')).toMatchObject({
    installedVersion: null,
    latestStableVersion: null,
    updateAvailable: false,
    compatible: false,
    checkState: 'unavailable'
  })
  expect(report.components.find((row) => row.component === 'pi-sdk')?.checkState).toBe(
    'unavailable'
  )
})
it('cancels oversized upstream metadata before reading an unbounded response', async () => {
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024))
    },
    cancel() {
      cancelled = true
    }
  })
  await expect(
    upstreamJson('https://registry.npmjs.org/fixture', async () => new Response(body))
  ).rejects.toThrow('exceeds the limit')
  expect(cancelled).toBe(true)
})
it('rejects an SDK mismatch and ignores malformed persisted version metadata', async () => {
  const { cacheFile } = await setup()
  await fs.writeFile(
    cacheFile,
    JSON.stringify({
      schemaVersion: 1,
      entries: { pi: { version: '99.0.0-beta.1', checkedAt: 'invalid' } }
    })
  )
  const service = new RuntimeVersionService({
    cacheFile,
    sdkVersions: async () => ({ ...(await matrix()), '@earendil-works/pi-mcp': '1.2.0' })
  })
  const report = await service.report(info())
  expect(report.components.find((row) => row.component === 'pi-sdk')?.compatible).toBe(false)
  expect(report.components.find((row) => row.component === 'pi')?.latestStableVersion).toBeNull()
})
