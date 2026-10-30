import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
const dependencies = createRequire(builder.resolve('app-builder-lib'))
const asar = dependencies('@electron/asar')

/** Compare every built-in resource with the installed archive, including licenses. */
export async function verifyPetArchive(archive, source) {
  let count = 0
  const visit = async (directory, relative = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name)
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(file, name)
      else if (entry.isFile()) {
        const actual = asar.extractFile(archive, path.join('resources', 'petpacks', name))
        if (!actual.equals(await fs.readFile(file)))
          throw new Error(`Archived pet resource differs from source: ${name}`)
        count++
      } else throw new Error(`Unexpected built-in pet resource type: ${name}`)
    }
  }
  await visit(source)
  if (!count) throw new Error('Built-in pet resources are missing')
  return count
}
