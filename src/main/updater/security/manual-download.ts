/** Compatibility entry point; the manager and manual path share one verifier/downloader. */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { TrustStore } from './manifest.mjs'
import type { ReleaseFetcher } from './transport.mjs'
import { ReleaseProvider } from '../update-provider'
import { UpdateDownload } from '../update-download'
import { SecurityError } from '../../services/errors'
interface DownloadOptions {
  version: string
  currentVersion: string
  platform: string
  arch: string
  variant: string
  destination: string
  fetcher: ReleaseFetcher
  trust?: TrustStore
  signal?: AbortSignal
  progress?: (percent: number) => void
}
export async function downloadVerifiedInstaller(options: DownloadOptions): Promise<string> {
  let temporary: string | undefined
  try {
    const signal = options.signal ?? AbortSignal.timeout(15 * 60_000)
    const provider = new ReleaseProvider(options)
    const candidate = await provider.authenticate(options.version, options.currentVersion, signal)
    await fs.mkdir(options.destination, { recursive: true, mode: 0o700 })
    temporary = await fs.mkdtemp(
      path.join(await fs.realpath(options.destination), 'Pi-Harness-update-')
    )
    const downloader = new UpdateDownload({ directory: temporary, fetcher: options.fetcher })
    const file = await downloader.run(
      candidate,
      signal,
      ({ received, total }) => options.progress?.((received / total) * 100),
      () => {}
    )
    options.progress?.(100)
    temporary = undefined
    return file
  } catch {
    throw new SecurityError(
      'The update could not be verified or downloaded. Retry from the official release.'
    )
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true })
  }
}
