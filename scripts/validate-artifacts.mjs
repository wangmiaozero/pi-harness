import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
const dependencies = createRequire(builder.resolve('app-builder-lib'))
const asar = dependencies('@electron/asar')
const yaml = dependencies('js-yaml')
const executable = process.env.PI_HARNESS_E2E_EXECUTABLE
if (!executable) throw new Error('Select the freshly built packaged executable first')
const resources =
  process.platform === 'darwin'
    ? path.resolve(path.dirname(executable), '../Resources')
    : path.join(path.dirname(executable), 'resources')
const archive = path.join(resources, 'app.asar')
const files = new Set(
  asar.listPackage(archive).map((file) => file.replaceAll('\\', '/').replace(/^\//, ''))
)
for (const file of [
  'out/main/index.js',
  'out/preload/index.mjs',
  'out/renderer/index.html',
  'node_modules/smol-toml/LICENSE'
]) {
  if (!files.has(file)) throw new Error(`Required packaged resource is missing: ${file}`)
}
const release = path.resolve('release')
const metadataName =
  process.platform === 'darwin'
    ? 'latest-mac.yml'
    : process.platform === 'win32'
      ? 'latest.yml'
      : 'latest-linux.yml'
const metadata = yaml.load(await fs.readFile(path.join(release, metadataName), 'utf8'))
if (!metadata || !Array.isArray(metadata.files) || !metadata.files.length)
  throw new Error('Updater payload metadata is missing')
const artifacts = []
for (const file of metadata.files) {
  if (
    typeof file.url !== 'string' ||
    path.basename(file.url) !== file.url ||
    /[\\:]/.test(file.url)
  )
    throw new Error('Updater payload is outside the release directory')
  const payload = path.join(release, file.url)
  const stat = await fs.stat(payload)
  if (stat.size !== file.size) throw new Error('Updater payload size does not match its metadata')
  const sha512 = createHash('sha512')
  const sha256 = createHash('sha256')
  for await (const chunk of createReadStream(payload)) {
    sha512.update(chunk)
    sha256.update(chunk)
  }
  if (sha512.digest('base64') !== file.sha512)
    throw new Error('Updater payload checksum does not match its metadata')
  if (/\.(?:zip|exe|AppImage)$/.test(file.url) && !(await fs.stat(`${payload}.blockmap`)).isFile())
    throw new Error('Updater blockmap is missing')
  artifacts.push({ file: file.url, size: stat.size, sha256: sha256.digest('hex') })
}
const report = {
  schemaVersion: 1,
  platform: process.platform,
  arch: process.arch,
  version: metadata.version,
  resources: 'PASS',
  updaterPayloads: 'PASS',
  artifacts,
  installerExecution: 'NOT_RUN'
}
await fs.writeFile(
  path.resolve(`out/quality/artifacts-${process.platform}-${process.arch}.json`),
  JSON.stringify(report, null, 2) + '\n'
)
process.stdout.write('Packaged resources and updater checksums: PASS\n')
