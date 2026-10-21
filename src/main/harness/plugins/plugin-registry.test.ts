// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { PluginRegistry, inspectPlugin } from './plugin-registry'
let dir: string, registry: PluginRegistry, source: string
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-plugin-registry-')))
  registry = new PluginRegistry(path.join(dir, 'installed'))
  await registry.initialize()
  source = path.join(dir, 'source')
  await fs.cp(path.resolve('examples/harness-plugins/run-metrics'), source, { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
describe('local plugin registry', () => {
  it('installs without executing code and restores independent permission grants', async () => {
    await fs.writeFile(
      path.join(source, 'main.mjs'),
      `throw new Error('MUST NOT EXECUTE AT INSTALL')`
    )
    const record = await registry.install(source)
    expect(record.enabled).toBe(false)
    expect(record.grants).toEqual([])
    await registry.update(record.manifest.id, {
      grants: ['events:read'],
      trustedDigest: record.digest
    })
    const restored = new PluginRegistry(registry.directory)
    await restored.initialize()
    expect(restored.get(record.manifest.id).trustedDigest).toBe(record.digest)
    expect(await restored.verify(record.manifest.id)).toMatch(/main\.mjs$/)
  })
  it('rejects duplicate ids and incompatible content changes rather than replacing an installed plugin', async () => {
    const installed = await registry.install(source)
    await expect(registry.install(source)).rejects.toThrow(/duplicate/)
    await fs.appendFile(
      path.join(registry.directory, installed.manifest.id, 'main.mjs'),
      '\n// modified'
    )
    await expect(registry.verify(installed.manifest.id)).rejects.toThrow(/changed/)
  })
  it('uninstalls files and grants and makes a fresh reinstall disabled', async () => {
    const installed = await registry.install(source)
    await registry.update(installed.manifest.id, { enabled: true, grants: ['events:read'] })
    await registry.uninstall(installed.manifest.id)
    expect(registry.list()).toEqual([])
    await expect(fs.access(path.join(registry.directory, installed.manifest.id))).rejects.toThrow()
    expect((await registry.install(source)).grants).toEqual([])
  })
  it('refuses symlinked manifest, entry and source directories', async () => {
    for (const name of ['plugin.json', 'main.mjs']) {
      const original = await fs.readFile(path.join(source, name))
      const outside = path.join(dir, `outside-${name}`)
      await fs.writeFile(outside, original)
      await fs.unlink(path.join(source, name))
      await fs.symlink(outside, path.join(source, name))
      await expect(inspectPlugin(source)).rejects.toThrow()
      await fs.unlink(path.join(source, name))
      await fs.writeFile(path.join(source, name), original)
    }
    const link = path.join(dir, 'source-link')
    await fs.symlink(source, link, 'dir')
    await expect(registry.install(link)).rejects.toThrow()
  })
  it('does not traverse installed-directory or metadata symlinks on verify, uninstall or initialization', async () => {
    const record = await registry.install(source),
      pluginDir = path.join(registry.directory, record.manifest.id),
      backup = path.join(dir, 'backup')
    await fs.rename(pluginDir, backup)
    await fs.symlink(backup, pluginDir, 'dir')
    await expect(registry.verify(record.manifest.id)).rejects.toThrow()
    await expect(registry.uninstall(record.manifest.id)).rejects.toThrow()
    expect(await fs.readFile(path.join(backup, 'plugin.json'), 'utf8')).toContain(
      record.manifest.id
    )
    await fs.unlink(path.join(registry.directory, 'registry.json'))
    await fs.symlink(
      path.join(backup, 'plugin.json'),
      path.join(registry.directory, 'registry.json')
    )
    await expect(new PluginRegistry(registry.directory).initialize()).rejects.toThrow()
  })
  it('rejects symlinked results metadata and managed roots', async () => {
    const outside = path.join(dir, 'outside.json')
    await fs.writeFile(outside, '{}')
    await fs.symlink(outside, path.join(registry.directory, 'results.json'))
    await expect(registry.assertMetadataFile('results.json')).rejects.toThrow()
    const linked = path.join(dir, 'linked-root')
    await fs.symlink(registry.directory, linked, 'dir')
    await expect(new PluginRegistry(linked).initialize()).rejects.toThrow()
  })
  it('rejects invalid stored JSON, oversized source and extra manifest keys', async () => {
    await fs.writeFile(path.join(registry.directory, 'registry.json'), '{broken')
    await expect(new PluginRegistry(registry.directory).initialize()).rejects.toThrow()
    await fs.writeFile(path.join(source, 'main.mjs'), ' '.repeat(512 * 1024 + 1))
    await expect(registry.install(source)).rejects.toThrow()
    expect(registry.list()).toEqual([])
  })
  it('rejects a full registry before writing unreadable state and rolls back the staged install', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(source, 'plugin.json'), 'utf8'))
    manifest.contributions.teams = [
      {
        id: 'large-team',
        version: '1.0.0',
        name: 'Large team',
        permissions: [],
        agents: [{ key: 'dev', name: 'Developer', role: 'developer' }],
        tasks: Array.from({ length: 12 }, (_, i) => ({
          key: `task-${i}`,
          title: `Task ${i}`,
          agent: 'dev',
          description: '文'.repeat(1000)
        }))
      }
    ]
    manifest.permissions.push('teams:contribute')
    let rejectedId = ''
    for (let i = 0; i < 32; i++) {
      manifest.id = `org.test.capacity-${i}`
      await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify(manifest))
      try {
        await registry.install(source)
      } catch (error) {
        expect(String(error)).toContain('storage limit')
        rejectedId = manifest.id
        break
      }
    }
    expect(rejectedId).not.toBe('')
    await expect(fs.access(path.join(registry.directory, rejectedId))).rejects.toThrow()
    const restored = new PluginRegistry(registry.directory)
    await restored.initialize()
    expect(restored.list()).toEqual(registry.list())
  })
})
