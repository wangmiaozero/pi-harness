import { utilityProcess } from 'electron'
import path from 'node:path'
import type { PluginProcessFactory } from './process-host'

/** No ambient credentials are copied. This is fault isolation, not an OS sandbox. */
export const createElectronPluginProcess: PluginProcessFactory = (entry) => {
  const env: Record<string, string> = {}
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG'])
    if (process.env[key]) env[key] = process.env[key]!
  const child = utilityProcess.fork(path.join(import.meta.dirname, 'plugin-worker.js'), [entry], {
    cwd: path.dirname(entry),
    env,
    stdio: 'ignore',
    serviceName: 'Harness Plugin'
  })
  return {
    send: (message) => child.postMessage(message),
    onMessage(listener) {
      child.on('message', listener)
      return () => {
        child.removeListener('message', listener)
      }
    },
    onExit(listener) {
      child.on('exit', listener)
      return () => {
        child.removeListener('exit', listener)
      }
    },
    kill() {
      const pid = child.pid
      child.kill()
      if (pid) {
        const force = setTimeout(() => {
          if (child.pid === pid) {
            try {
              process.kill(pid, 'SIGKILL')
            } catch {
              /* already exited */
            }
          }
        }, 250)
        force.unref()
        child.once('exit', () => clearTimeout(force))
      }
    }
  }
}
