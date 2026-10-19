/** Main-owned update lifecycle. Network data cannot enable an installer. */
import { app, net, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { APP_VERSION } from '@shared/constants/index'
import type { AppUpdateState, UpdatePreferences } from '@shared/update'
import { ReleaseProvider, RELEASE_PAGE as LATEST_RELEASE_URL } from './update-provider'
import { UpdateDownload } from './update-download'
import { UpdateManager } from './update-manager'
import { installVerifiedUpdate } from './update-installer'
import { readUpdateMode } from './policy'
import { verifyDistribution, runtimeLayout, catalog } from '../runtime/distribution.mjs'

declare const __MASCOT_ENABLED__: boolean
let manager: UpdateManager | null = null
function service() {
  if (manager) return manager
  const variant = __MASCOT_ENABLED__ ? 'standard' : 'nomascot'
  const directory = path.join(app.getPath('userData'), 'updates')
  const currentVersion = app.isPackaged ? app.getVersion() : APP_VERSION
  const fetcher = (url: string, options?: RequestInit) => net.fetch(url, options)
  manager = new UpdateManager({
    currentVersion,
    platform: process.platform,
    arch: process.arch,
    variant,
    packaged: app.isPackaged,
    mode: readUpdateMode(),
    directory,
    provider: new ReleaseProvider({
      fetcher,
      platform: process.platform,
      arch: process.arch,
      variant
    }),
    downloader: new UpdateDownload({ directory: path.join(directory, 'downloads'), fetcher }),
    reveal: (file) => shell.showItemInFolder(file),
    install: (candidate, file) =>
      installVerifiedUpdate({
        platform: process.platform,
        arch: process.arch,
        variant,
        currentVersion,
        candidate,
        file,
        journal: path.join(directory, 'upgrade.json'),
        appImage: process.env.APPIMAGE,
        relaunch: (executable) => app.relaunch(executable ? { execPath: executable } : {}),
        quit: () => app.quit()
      }),
    healthCheck: async () => {
      await fs.access(app.getPath('userData'))
      for (const kind of ['node', 'pi'] as const) {
        const root = path.join(process.resourcesPath, 'runtimes', kind)
        await verifyDistribution(root, kind, process.platform, process.arch)
        const result = await promisify(execFile)(
          path.join(root, runtimeLayout(kind, process.platform).executable),
          ['--version'],
          { timeout: 30_000, maxBuffer: 64 * 1024 }
        )
        if (!result.stdout.includes(catalog[kind].version))
          throw new Error('Bundled runtime health check failed')
      }
    }
  })
  return manager
}
export const getUpdateState = (): AppUpdateState => service().snapshot()
export const onUpdateState = (listener: (state: AppUpdateState) => void) =>
  service().onState(listener)
export const checkForUpdates = () => service().check()
export const downloadUpdate = () => service().download()
export const cancelUpdate = () => service().cancel()
export const retryUpdate = () => service().retry()
export const deferUpdate = () => service().defer()
export const revealUpdate = () => service().reveal()
export const updatePreferences = (value: UpdatePreferences) => service().preferences(value)
export const installUpdate = () => service().install()
export const openReleasePage = () => shell.openExternal(LATEST_RELEASE_URL)
export const startAutomaticUpdates = (delay = 10_000) => service().start(delay)
export const stopAutomaticUpdates = () => manager?.stop()
