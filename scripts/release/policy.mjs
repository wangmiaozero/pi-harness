import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
export const yaml = builder('js-yaml')
export const platforms = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']
export const experimentalPlatforms = ['win32-arm64', 'linux-arm64']
export const variants = ['standard', 'nomascot']
export const channel = process.env.PI_HARNESS_RELEASE_CHANNEL ?? 'community'
if (!['community', 'verified'].includes(channel)) throw new Error('Unknown release channel')
export async function digest(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(encoding)
}
export function assetNames(version, platform, variant) {
  const [os, arch] = platform.split('-')
  const suffix = variant === 'nomascot' ? '-nomascot' : ''
  if (os === 'darwin')
    return [
      `Pi-Harness-${version}${arch === 'arm64' || variant === 'nomascot' ? `-${arch}` : ''}${suffix}.dmg`,
      `Pi-Harness-${version}${arch === 'arm64' || variant === 'nomascot' ? `-${arch}` : ''}${suffix}${variant === 'standard' ? '-mac' : ''}.zip`
    ]
  if (os === 'win32')
    return [`Pi-Harness-Setup-${version}${arch === 'arm64' ? '-arm64' : ''}${suffix}.exe`]
  return [
    `Pi-Harness-${version}${arch === 'arm64' || variant === 'nomascot' ? `-${arch === 'x64' ? 'x86_64' : arch}` : ''}${suffix}.AppImage`
  ]
}
export function metadataName(platform, variant) {
  const prefix = variant === 'nomascot' ? 'nomascot' : 'latest'
  return (
    prefix +
    (platform.startsWith('darwin')
      ? '-mac'
      : platform.startsWith('linux')
        ? `-linux${platform.endsWith('-arm64') ? '-arm64' : ''}`
        : '') +
    '.yml'
  )
}
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## ${version} — `))
  if (start < 0 || !/^## \d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}$/.test(lines[start]))
    throw new Error(`Missing dated changelog for ${version}`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const section = lines
    .slice(start, next < 0 ? undefined : next)
    .join('\n')
    .trim()
  const headings = [...section.matchAll(/^### (.+)$/gm)].map((match) => match[1])
  if (
    !headings.length ||
    headings.some((name) => !['Added', 'Fixed'].includes(name)) ||
    !/^- \S/m.test(section)
  )
    throw new Error('Release notes require real Added/Fixed entries')
  return section
}
export function validateVersion(version, tag) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || tag !== `v${version}`)
    throw new Error('A stable SemVer tag must exactly match package.json')
  if (tag === 'v2.0.0') throw new Error('The historical manual v2.0.0 release is protected')
}
export async function validateMetadata(directory, name, version, expected) {
  const data = yaml.load(await fs.readFile(path.join(directory, name), 'utf8'))
  if (data?.version !== version || !Array.isArray(data.files) || !data.files.length)
    throw new Error(`Invalid update metadata: ${name}`)
  const seen = new Set()
  for (const file of data.files) {
    if (!expected.includes(file.url) || seen.has(file.url))
      throw new Error(`Unexpected update payload: ${file.url}`)
    seen.add(file.url)
    const target = path.join(directory, file.url)
    if (
      (await fs.stat(target)).size !== file.size ||
      (await digest(target, 'sha512', 'base64')) !== file.sha512
    )
      throw new Error(`Update integrity mismatch: ${file.url}`)
  }
  const automatic = expected.filter((file) => !file.endsWith('.dmg'))
  if (automatic.some((file) => !seen.has(file)))
    throw new Error(`Missing architecture/variant payload in ${name}`)
  if (
    data.path &&
    (!seen.has(data.path) ||
      data.sha512 !== data.files.find((file) => file.url === data.path)?.sha512)
  )
    throw new Error(`Legacy update fields do not match: ${name}`)
  return data
}
