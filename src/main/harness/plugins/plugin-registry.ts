import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  pluginManifestSchema,
  pluginIdSchema,
  permissionSchema
} from '@shared/harness-plugins/schema'
import type { PluginManifest, PluginPermission, PluginRecord } from '@shared/harness-plugins/types'
import { JsonStore } from '../../services/storage'
import { SecurityError, ValidationError } from '../../services/errors'
import { z } from 'zod'

const recordSchema = z.strictObject({
  manifest: pluginManifestSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
  grants: z.array(permissionSchema).max(4),
  trustedDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  installedAt: z.number().finite()
})
const storeSchema = z.strictObject({
  version: z.literal(1),
  plugins: z.array(recordSchema).max(64)
})
const fail = () => new SecurityError('Unsafe plugin path or file')

/** Reads regular, bounded files through a no-follow handle; never follows a plugin symlink. */
export async function readPluginFile(
  root: string,
  name: string,
  limit = 512 * 1024
): Promise<string> {
  if (path.basename(name) !== name || !name || name === '.' || name === '..') throw fail()
  const dir = await fs.lstat(root)
  if (!dir.isDirectory() || dir.isSymbolicLink() || (await fs.realpath(root)) !== root) throw fail()
  const file = path.join(root, name),
    before = await fs.lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit)
    throw fail()
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const current = await handle.stat()
    if (current.ino !== before.ino || current.dev !== before.dev || current.size > limit)
      throw fail()
    const buffer = await handle.readFile()
    if (buffer.length > limit) throw fail()
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}
export async function inspectPlugin(
  directory: string
): Promise<{ manifest: PluginManifest; code: string | null; digest: string }> {
  if ((await fs.lstat(directory)).isSymbolicLink()) throw fail()
  const root = await fs.realpath(directory)
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readPluginFile(root, 'plugin.json', 64 * 1024))
  )
  const code = manifest.entry ? await readPluginFile(root, manifest.entry) : null
  const digest = createHash('sha256')
    .update(JSON.stringify(manifest))
    .update('\0')
    .update(code ?? '')
    .digest('hex')
  return { manifest, code, digest }
}

export class PluginRegistry {
  private store: JsonStore<{ version: 1; plugins: PluginRecord[] }>
  private plugins: PluginRecord[] = []
  constructor(readonly directory: string) {
    this.store = new JsonStore(path.join(directory, 'registry.json'), { version: 1, plugins: [] })
  }
  async initialize(): Promise<void> {
    await this.checkRoot(true)
    let data: unknown = { version: 1, plugins: [] }
    try {
      data = JSON.parse(await readPluginFile(this.directory, 'registry.json', 512 * 1024))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    this.plugins = storeSchema.parse(data).plugins
    if (new Set(this.plugins.map((p) => p.manifest.id)).size !== this.plugins.length)
      throw new ValidationError('Duplicate installed plugin ids')
  }
  has(id: string): boolean {
    return this.plugins.some((record) => record.manifest.id === id)
  }
  list(): PluginRecord[] {
    return structuredClone(this.plugins)
  }
  get(id: string): PluginRecord {
    pluginIdSchema.parse(id)
    const record = this.plugins.find((p) => p.manifest.id === id)
    if (!record) throw new ValidationError('Plugin not installed')
    return structuredClone(record)
  }
  async install(source: string): Promise<PluginRecord> {
    await this.checkRoot()
    const inspected = await inspectPlugin(source)
    if (
      this.plugins.length >= 64 ||
      this.plugins.some((p) => p.manifest.id === inspected.manifest.id)
    )
      throw new ValidationError('Plugin limit reached or duplicate plugin id')
    const stage = path.join(this.directory, `.install-${randomUUID()}`),
      dest = path.join(this.directory, inspected.manifest.id)
    await fs.mkdir(stage, { mode: 0o700 })
    let moved = false
    try {
      try {
        await fs.lstat(dest)
        throw new ValidationError('Plugin directory already exists')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      await fs.writeFile(path.join(stage, 'plugin.json'), JSON.stringify(inspected.manifest), {
        flag: 'wx',
        mode: 0o600
      })
      if (inspected.manifest.entry)
        await fs.writeFile(path.join(stage, inspected.manifest.entry), inspected.code!, {
          flag: 'wx',
          mode: 0o600
        })
      await fs.rename(stage, dest)
      moved = true
      const record: PluginRecord = {
        manifest: inspected.manifest,
        digest: inspected.digest,
        enabled: false,
        grants: [],
        trustedDigest: null,
        installedAt: Date.now()
      }
      await this.save([...this.plugins, record])
      return structuredClone(record)
    } catch (e) {
      if (moved) await this.removeDirectory(dest)
      throw e
    } finally {
      if (!moved) await this.removeDirectory(stage)
    }
  }
  async update(
    id: string,
    patch: Partial<Pick<PluginRecord, 'enabled' | 'grants' | 'trustedDigest'>>
  ): Promise<void> {
    this.get(id)
    await this.save(this.plugins.map((p) => (p.manifest.id === id ? { ...p, ...patch } : p)))
  }
  async verify(id: string): Promise<string | null> {
    await this.checkRoot()
    const record = this.get(id),
      dir = path.join(this.directory, id)
    const inspected = await inspectPlugin(dir)
    if (inspected.manifest.id !== id || inspected.digest !== record.digest)
      throw new SecurityError(
        'Plugin content changed; uninstall and reinstall before granting trust again'
      )
    return inspected.manifest.entry ? path.join(dir, inspected.manifest.entry) : null
  }
  async uninstall(id: string): Promise<void> {
    this.get(id)
    await this.checkRoot()
    // Rename ownership first. On a store failure, put the directory back.
    const dir = path.join(this.directory, id),
      trash = path.join(this.directory, `.remove-${randomUUID()}`)
    const stat = await fs.lstat(dir)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail()
    await fs.rename(dir, trash)
    try {
      await this.save(this.plugins.filter((p) => p.manifest.id !== id))
    } catch (e) {
      await fs.rename(trash, dir)
      throw e
    }
    await this.removeDirectory(trash)
  }
  async assertMetadataFile(name: string): Promise<void> {
    await this.checkRoot()
    try {
      await readPluginFile(this.directory, name, 2 * 1024 * 1024)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  private async save(plugins: PluginRecord[]): Promise<void> {
    await this.checkRoot()
    try {
      const stat = await fs.lstat(path.join(this.directory, 'registry.json'))
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    const next = storeSchema.parse({ version: 1, plugins })
    if (Buffer.byteLength(JSON.stringify(next, null, 2) + '\n', 'utf8') > 512 * 1024)
      throw new ValidationError('Plugin registry storage limit reached')
    await this.store.write(next)
    this.plugins = next.plugins
  }
  private async checkRoot(create = false): Promise<void> {
    if (create) await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(this.directory)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await fs.realpath(this.directory)) !== this.directory
    )
      throw fail()
  }
  private async removeDirectory(dir: string): Promise<void> {
    const stat = await fs.lstat(dir).catch(() => null)
    if (!stat) return
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail()
    // unlink does not traverse links, including an unexpected file in our owned directory.
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) throw fail()
      await fs.unlink(path.join(dir, entry.name))
    }
    await fs.rmdir(dir)
  }
}
export function hasPermissions(record: PluginRecord, requested: PluginPermission[]): boolean {
  return requested.every((p) => record.grants.includes(p))
}
