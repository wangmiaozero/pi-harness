import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execute = promisify(execFile)
async function mountedAt(mount) {
  const [child, parent] = await Promise.all([fs.stat(mount), fs.stat(path.dirname(mount))])
  return child.dev !== parent.dev
}

/** Copy from a readonly image; never launch an app or keep a cwd on the mounted volume. */
export async function copyDmgApplication(image, mount, installed, diagnostics, options = {}) {
  const run = options.run ?? execute
  const wait = options.wait ?? delay
  const isMounted = options.isMounted ?? mountedAt
  const commandOptions = { cwd: os.tmpdir(), timeout: 30000, maxBuffer: 2 * 1024 * 1024 }
  const attempts = []
  let attached = false
  let originalError
  let cleanupError
  try {
    await run(
      '/usr/bin/hdiutil',
      ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, image],
      commandOptions
    )
    attached = true
    await fs.mkdir(path.dirname(installed), { recursive: true })
    // execFile resolves after ditto closes its stdio and exits, before we detach.
    await run('/usr/bin/ditto', [path.join(mount, 'Pi-Harness.app'), installed], {
      ...commandOptions,
      timeout: 180000
    })
  } catch (error) {
    originalError = error
  } finally {
    try {
      // A partially failed attach may still have mounted a device.
      if (attached || (await isMounted(mount).catch(() => false))) {
        let detachError
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            await run('/usr/bin/hdiutil', ['detach', mount], commandOptions)
            detachError = undefined
            break
          } catch (error) {
            if (!(await isMounted(mount).catch(() => true))) {
              detachError = undefined
              break
            }
            detachError = error
            const busy = error.code === 16 || /resource busy/i.test(error.stderr ?? '')
            const probes = await Promise.allSettled([
              run('/usr/sbin/lsof', ['-nP', '+f', '--', mount], {
                ...commandOptions,
                timeout: 5000
              }),
              run('/usr/bin/hdiutil', ['info', '-plist'], { ...commandOptions, timeout: 5000 })
            ])
            attempts.push({
              attempt: attempt + 1,
              busy,
              code: error.code,
              stderr: error.stderr,
              diagnostics: probes.map((result) =>
                result.status === 'fulfilled'
                  ? { stdout: result.value.stdout, stderr: result.value.stderr }
                  : {
                      error: String(result.reason),
                      stdout: result.reason.stdout,
                      stderr: result.reason.stderr
                    }
              )
            })
            if (!busy || attempt === 3) break
            // Short, bounded backoff permits volume observers to close their handles.
            await wait([250, 500, 1000][attempt])
          }
        }
        if (attempts.length) {
          await fs.writeFile(
            diagnostics,
            JSON.stringify({ image, mount, detached: !detachError, attempts }, null, 2) + '\n'
          )
        }
        if (detachError) {
          const error = new Error(
            `DMG cleanup failed; mounted image retained. See ${diagnostics}`,
            {
              cause: originalError ? new AggregateError([originalError, detachError]) : detachError
            }
          )
          error.mountStillAttached = true
          cleanupError = error
        }
      }
    } catch (error) {
      cleanupError = new Error(`DMG cleanup diagnostics failed. See ${diagnostics}`, {
        cause: originalError ? new AggregateError([originalError, error]) : error
      })
      cleanupError.mountStillAttached = await isMounted(mount).catch(() => true)
    }
  }
  if (cleanupError) throw cleanupError
  if (originalError) throw originalError
}
