import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { PI_SDK_PACKAGES } from './version-sources.mjs'

export async function installedSdkVersions() {
  const roots = []
  const found = {}
  for (const name of PI_SDK_PACKAGES) {
    try {
      const file = fileURLToPath(import.meta.resolve(name))
      const own = path.resolve(path.dirname(file), '../package.json')
      const data = JSON.parse(await fs.readFile(own, 'utf8'))
      if (data.name === name && semver.valid(data.version)) found[name] = data.version
      roots.push(path.resolve(path.dirname(file), '../../..'))
    } catch {
      /* Transitive packages are resolved beside their declaring SDK below. */
    }
  }
  for (const name of PI_SDK_PACKAGES) {
    if (found[name]) continue
    for (const root of roots) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(root, name, 'package.json'), 'utf8'))
        if (data.name === name && semver.valid(data.version)) {
          found[name] = data.version
          break
        }
      } catch {
        /* Missing SDK components are reported as unknown, never assumed installed. */
      }
    }
    found[name] ??= null
  }
  return found
}
