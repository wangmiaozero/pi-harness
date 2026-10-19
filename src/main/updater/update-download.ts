import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { TrustedCandidate } from './update-provider'
import { fetchOfficial } from './security/transport.mjs'
import type { ReleaseFetcher } from './security/transport.mjs'
import { verifyInstaller } from './security/manifest.mjs'
import { markDownloadOrigin } from './security/download-origin'
import { UpdateError } from './update-error'

export interface DownloadProgress {
  received: number
  total: number
  speed: number
}
export class UpdateDownload {
  constructor(private readonly options: { directory: string; fetcher: ReleaseFetcher }) {}
  private async paths(candidate: TrustedCandidate) {
    const id = createHash('sha256')
      .update(candidate.bytes)
      .update(candidate.installer.file)
      .digest('hex')
    await fs.mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    const root = await fs.realpath(this.options.directory)
    const directory = path.join(root, id)
    await fs.mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await fs.lstat(directory)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await fs.realpath(directory)) !== directory
    )
      throw new UpdateError('CACHE_REJECTED', 'The update cache is not a safe directory.')
    return {
      directory,
      partial: path.join(directory, 'payload.part'),
      verified: path.join(directory, candidate.installer.file)
    }
  }
  async revalidate(candidate: TrustedCandidate, file: string): Promise<void> {
    const paths = await this.paths(candidate)
    if (file !== paths.verified)
      throw new UpdateError('CACHE_REJECTED', 'The update is outside its verified cache.')
    try {
      await verifyInstaller(file, candidate.installer)
    } catch {
      throw new UpdateError(
        'INTEGRITY_FAILED',
        'The installer has changed or is damaged. Download it again.'
      )
    }
  }
  async run(
    candidate: TrustedCandidate,
    signal: AbortSignal,
    progress: (value: DownloadProgress) => void,
    verifying: () => void
  ): Promise<string> {
    const paths = await this.paths(candidate)
    const item = candidate.installer
    const existing = await fs.lstat(paths.verified).catch(() => null)
    if (existing) {
      verifying()
      if (!existing.isFile() || existing.isSymbolicLink())
        throw new UpdateError('CACHE_REJECTED', 'The verified cache entry is not a regular file.')
      try {
        await this.revalidate(candidate, paths.verified)
        return paths.verified
      } catch {
        await fs.unlink(paths.verified)
        await fs.rm(paths.partial, { force: true })
      }
    }
    const partial = await fs.lstat(paths.partial).catch(() => null)
    if (partial && (!partial.isFile() || partial.isSymbolicLink() || partial.size > item.size))
      throw new UpdateError('CACHE_REJECTED', 'The partial download is not safe to resume.')
    let received = partial?.size ?? 0
    const base = `https://github.com/wangmiaozero/pi-harness/releases/download/v${candidate.version}/`
    let fatal = false
    try {
      if (received < item.size) {
        const response = await fetchOfficial(base + item.file, this.options.fetcher, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
          headers: {
            'Accept-Encoding': 'identity',
            ...(received ? { Range: `bytes=${received}-` } : {})
          }
        })
        const reader = response.body!.getReader()
        let handle: Awaited<ReturnType<typeof fs.open>> | undefined
        try {
          const encoding = response.headers.get('content-encoding')
          if (encoding && encoding !== 'identity')
            throw new UpdateError(
              'RANGE_REJECTED',
              'The download server returned an unexpected encoding.'
            )
          if (response.status === 206) {
            const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
            if (
              !match ||
              Number(match[1]) !== received ||
              Number(match[2]) < received ||
              Number(match[2]) >= item.size ||
              Number(match[3]) !== item.size
            )
              throw new UpdateError(
                'RANGE_REJECTED',
                'The download server returned an invalid resume range.'
              )
          } else if (response.status === 200) {
            // A server ignoring Range must restart from zero, never append.
            received = 0
          } else
            throw new UpdateError(
              'NETWORK_DOWNLOAD_FAILED',
              'The installer could not be downloaded.',
              true
            )
          const length = response.headers.get('content-length')
          if (length !== null && Number(length) !== item.size - received)
            throw new UpdateError(
              'SIZE_MISMATCH',
              'The installer size does not match the signed manifest.'
            )
          const flags =
            constants.O_WRONLY |
            constants.O_CREAT |
            (received ? constants.O_APPEND : constants.O_TRUNC) |
            (constants.O_NOFOLLOW ?? 0)
          handle = await fs.open(paths.partial, flags, 0o600)
          const initial = received,
            started = Date.now()
          progress({ received, total: item.size, speed: 0 })
          while (true) {
            signal.throwIfAborted()
            const { done, value } = await reader.read()
            if (done) break
            received += value.byteLength
            if (received > item.size)
              throw new UpdateError('SIZE_MISMATCH', 'The installer exceeds its signed size.')
            await handle.writeFile(value)
            progress({
              received,
              total: item.size,
              speed: (received - initial) / Math.max(0.001, (Date.now() - started) / 1000)
            })
          }
          await handle.sync()
          if (received !== item.size)
            throw new UpdateError(
              'NETWORK_INTERRUPTED',
              'The download was interrupted. Retry to resume it.',
              true
            )
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
          await handle?.close()
        }
      }
      signal.throwIfAborted()
      verifying()
      try {
        await verifyInstaller(paths.partial, item)
      } catch {
        throw new UpdateError(
          'INTEGRITY_FAILED',
          'The installer SHA-256 or size does not match the signed release.'
        )
      }
      await markDownloadOrigin(paths.partial, base + item.file)
      signal.throwIfAborted()
      await fs.link(paths.partial, paths.verified)
      await fs.unlink(paths.partial)
      return paths.verified
    } catch (error) {
      fatal = error instanceof UpdateError && !error.recoverable
      if (signal.aborted)
        throw new UpdateError(
          'DOWNLOAD_CANCELLED',
          'The download was cancelled. You can resume it later.',
          true
        )
      if (error instanceof UpdateError) throw error
      throw new UpdateError(
        'NETWORK_DOWNLOAD_FAILED',
        'The download failed. Retry to resume the verified release.',
        true
      )
    } finally {
      if (fatal) await fs.rm(paths.partial, { force: true })
    }
  }
}
