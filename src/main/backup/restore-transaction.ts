import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { atomicWriteJson, atomicWriteText, readTextFile } from '../services/storage'
import { BackupError, ConfigConflictError } from '../services/errors'
import { piModelsConfigSchema, piSettingsConfigSchema } from '@shared/schemas/pi'

const fileSchema = z.object({
  name: z.enum(['models.json', 'settings.json']),
  before: z.string().nullable(),
  after: z.string(),
  beforeHash: z.string(),
  afterHash: z.string()
})
export const journalSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  directory: z.string(),
  status: z.enum(['prepared', 'committing', 'completed', 'rolled-back', 'failed']),
  files: z.array(fileSchema).min(1).max(2)
})
export const contentHash = (text: string | null): string =>
  createHash('sha256')
    .update(text === null ? 'missing' : `text:${text}`)
    .digest('hex')

/** Recoverable sequence, not a cross-file atomic transaction. Caller holds the config writer lease. */
export async function restoreTransaction(
  directory: string,
  journalPath: string,
  id: string,
  prepare: () => Promise<Map<string, string>>
): Promise<void> {
  const saved = await readTextFile(journalPath)
  let previous: z.infer<typeof journalSchema> | null = null
  if (saved !== null) {
    try {
      previous = journalSchema.parse(JSON.parse(saved))
    } catch {
      throw new BackupError(
        'Restore record is damaged; preserve it and inspect the backup folder before retrying'
      )
    }
  }
  let journal = previous
  const unfinished = journal && !['completed', 'rolled-back'].includes(journal.status)
  if (unfinished && (journal!.id !== id || journal!.directory !== directory)) {
    throw new BackupError(
      `A restore is unfinished. Restore backup ${journal!.id} again to recover it`
    )
  }
  if (!unfinished) {
    const contents = await prepare()
    const files = []
    for (const [name, after] of contents) {
      const parsedName = fileSchema.shape.name.parse(name)
      const before = await readTextFile(path.join(directory, name))
      files.push({
        name: parsedName,
        before,
        after,
        beforeHash: contentHash(before),
        afterHash: contentHash(after)
      })
    }
    journal = journalSchema.parse({ version: 1, id, directory, status: 'prepared', files })
    await atomicWriteJson(journalPath, journal)
  }
  const transaction = journal!
  if (new Set(transaction.files.map((file) => file.name)).size !== transaction.files.length)
    throw new BackupError('Duplicate restore targets')
  for (const file of transaction.files) {
    if (contentHash(file.before) !== file.beforeHash || contentHash(file.after) !== file.afterHash)
      throw new BackupError('Restore checksum mismatch')
    const schema = file.name === 'models.json' ? piModelsConfigSchema : piSettingsConfigSchema
    try {
      schema.parse(JSON.parse(file.after))
    } catch {
      throw new BackupError('Restore data is invalid')
    }
    const current = contentHash(await readTextFile(path.join(directory, file.name)))
    if (current !== file.beforeHash && current !== file.afterHash)
      throw new ConfigConflictError(
        'Configuration changed since restore began; preserve the recovery record and compare before retrying'
      )
  }
  transaction.status = 'committing'
  await atomicWriteJson(journalPath, transaction)
  try {
    for (const file of transaction.files) {
      const target = path.join(directory, file.name)
      const current = contentHash(await readTextFile(target))
      if (current === file.afterHash) continue
      if (current !== file.beforeHash)
        throw new ConfigConflictError('Configuration changed during restore')
      await atomicWriteText(target, file.after)
    }
    for (const file of transaction.files) {
      if (contentHash(await readTextFile(path.join(directory, file.name))) !== file.afterHash)
        throw new ConfigConflictError('Configuration changed before restore completed')
    }
    transaction.status = 'completed'
    await atomicWriteJson(journalPath, transaction)
    // No retained hidden configuration copy after a successful explicit restore.
    await fs.unlink(journalPath)
  } catch (error) {
    // Roll back only targets still matching our writes. Never overwrite a third-party edit.
    let rolledBack = true
    for (const file of [...transaction.files].reverse()) {
      try {
        const target = path.join(directory, file.name)
        const current = contentHash(await readTextFile(target))
        if (current === file.beforeHash) continue
        if (current !== file.afterHash) {
          rolledBack = false
          continue
        }
        if (file.before === null) await fs.unlink(target)
        else await atomicWriteText(target, file.before)
      } catch {
        rolledBack = false
      }
    }
    transaction.status = rolledBack ? 'rolled-back' : 'failed'
    await atomicWriteJson(journalPath, transaction).catch(() => undefined)
    throw new BackupError(
      rolledBack
        ? 'Restore failed; previous configuration was restored. You can retry.'
        : `Restore was interrupted. Restore backup ${id} again to recover; changed files will be protected.`,
      { cause: error instanceof Error ? error.name : 'Error' }
    )
  }
}
