import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  acquireDistribution,
  verifyDistribution,
  catalog
} from '../../src/main/runtime/distribution.mjs'

export async function prepareDistribution(options, dependencies = {}) {
  const { destination, kind, platform, arch, verifyOnly = false, refresh = false } = options
  const acquire = dependencies.acquire ?? acquireDistribution
  const verify = dependencies.verify ?? verifyDistribution
  const rename = dependencies.rename ?? ((from, to) => fs.rename(from, to))
  const exists = await fs.lstat(destination).catch(() => null)
  const receipt = exists
    ? await fs
        .readFile(path.join(destination, 'runtime-receipt.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null)
    : null
  const stale =
    receipt?.kind === kind &&
    receipt.platform === platform &&
    receipt.arch === arch &&
    receipt.version !== catalog[kind].version
  if (!verifyOnly && exists && (refresh || stale)) {
    const candidate = `${destination}.${randomUUID()}.replacement`
    const backup = `${destination}.${randomUUID()}.previous`
    try {
      await acquire({ ...options, destination: candidate })
      await verify(candidate, kind, platform, arch)
      await rename(destination, backup)
      try {
        await rename(candidate, destination)
      } catch (error) {
        await rename(backup, destination)
        throw error
      }
      await fs.rm(backup, { recursive: true, force: true })
    } finally {
      await fs.rm(candidate, { recursive: true, force: true })
    }
  } else if (!verifyOnly && !exists) {
    await acquire(options)
  }
  return verify(destination, kind, platform, arch)
}
