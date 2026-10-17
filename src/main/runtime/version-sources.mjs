import semver from 'semver'

export const PI_SDK_PACKAGES = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-tui',
  '@earendil-works/pi-mcp',
  '@earendil-works/pi-codemode',
  '@earendil-works/pi-telemetry'
]
export function latestStable(versions) {
  return (
    versions
      .filter((version) => semver.valid(version) && !semver.prerelease(version))
      .sort(semver.rcompare)[0] ?? null
  )
}
export async function upstreamJson(url, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Version source unavailable (${response.status})`)
  const limit = 40 * 1024 * 1024
  if (!response.body) throw new Error('Version metadata is empty')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('Version metadata exceeds the limit')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
}
export async function npmStable(name, fetcher = fetch) {
  const metadata = await upstreamJson(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    fetcher
  )
  const versions = metadata.versions
  if (!versions || typeof versions !== 'object') throw new Error('Invalid registry metadata')
  const version = latestStable(Object.keys(versions).filter((key) => !versions[key].deprecated))
  if (!version) throw new Error('No stable npm release is available')
  return {
    version,
    distTags: metadata['dist-tags'] ?? {},
    engines: versions[version].engines ?? {},
    peers: versions[version].peerDependencies ?? {}
  }
}
export async function githubStable(repository, fetcher = fetch) {
  const releases = await upstreamJson(
    `https://api.github.com/repos/${repository}/releases?per_page=100`,
    fetcher
  )
  if (!Array.isArray(releases)) throw new Error('Invalid release metadata')
  const version = latestStable(
    releases
      .filter((release) => !release.draft && !release.prerelease)
      .map((release) => String(release.tag_name).replace(/^v/, ''))
  )
  if (!version) throw new Error('No stable GitHub release is available')
  return version
}
export async function nodeLts(fetcher = fetch) {
  const releases = await upstreamJson('https://nodejs.org/dist/index.json', fetcher)
  if (!Array.isArray(releases)) throw new Error('Invalid Node release metadata')
  const version = latestStable(
    releases
      .filter((release) => release.lts)
      .map((release) => String(release.version).replace(/^v/, ''))
  )
  if (!version) throw new Error('No Node LTS release is available')
  return version
}
