import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { validateVersion, digest } from './policy.mjs'
import { verifyCandidate } from './verify-candidate.mjs'

export async function publishRelease(client, plan) {
  validateVersion(plan.version, plan.tag)
  if (!plan.files.length || new Set(plan.files.map((file) => file.name)).size !== plan.files.length)
    throw new Error('A complete, unique asset list is required')
  let release = await client.find(plan.tag)
  if (release && (!release.draft || !release.body?.includes(plan.marker)))
    throw new Error('Existing release is protected')
  if (!release)
    release = await client.create({
      tag_name: plan.tag,
      target_commitish: plan.revision,
      name: plan.tag,
      body: `${plan.notes}\n\n${plan.marker}`,
      draft: true,
      prerelease: false
    })
  if (!release.draft) throw new Error('Only a draft may receive uploads')
  const expected = new Set(plan.files.map((file) => file.name))
  for (const asset of release.assets)
    if (!expected.has(asset.name)) throw new Error('Draft contains unexpected assets')
  for (const file of plan.files) {
    const asset = release.assets.find((asset) => asset.name === file.name)
    if (!asset) await client.upload(release, file)
  }
  release = await client.get(release.id)
  if (release.assets.length !== plan.files.length)
    throw new Error('Remote release asset set is incomplete')
  for (const file of plan.files) {
    const asset = release.assets.find((asset) => asset.name === file.name)
    if (!asset || asset.size !== file.size || (await client.hash(asset)) !== file.sha256)
      throw new Error(`Remote asset verification failed: ${file.name}`)
  }
  await client.publish(release.id)
  return release.html_url
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag')
    throw new Error('Only a tag push may publish a release')
  const tag = process.env.RELEASE_TAG
  const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
  validateVersion(version, tag)
  const readiness = JSON.parse(await fs.readFile('release-readiness.json', 'utf8'))
  if (readiness.readiness !== 'READY' || readiness.version !== version)
    throw new Error('Release is not ready')
  if (
    readiness.reports?.length !== 4 ||
    readiness.reports.some(
      (report) => report.revision !== process.env.GITHUB_SHA || report.readiness !== 'READY'
    )
  )
    throw new Error('Release source evidence does not match this tag')
  await verifyCandidate(path.resolve('release-artifacts'), version, process.env.GITHUB_SHA)
  const api = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(300_000)
    })
    if (!response.ok) throw new Error(`GitHub release request failed: HTTP ${response.status}`)
    return response
  }
  async function get(id) {
    const release = await (await request(`${api}/releases/${id}`)).json()
    release.assets = []
    for (let page = 1; ; page++) {
      const assets = await (
        await request(`${api}/releases/${id}/assets?per_page=100&page=${page}`)
      ).json()
      release.assets.push(...assets)
      if (assets.length < 100) break
    }
    return release
  }
  const client = {
    async find(tag) {
      const response = await fetch(`${api}/releases/tags/${tag}`, {
        headers,
        signal: AbortSignal.timeout(30_000)
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Release existence check failed: HTTP ${response.status}`)
      return get((await response.json()).id)
    },
    async create(body) {
      return (
        await request(`${api}/releases`, { method: 'POST', body: JSON.stringify(body) })
      ).json()
    },
    get,
    async upload(release, file) {
      const url = new URL(release.upload_url.split('{')[0])
      if (url.origin !== 'https://uploads.github.com')
        throw new Error('Unexpected asset upload host')
      url.searchParams.set('name', file.name)
      const { createReadStream } = await import('node:fs')
      await request(url, {
        method: 'POST',
        body: createReadStream(file.path),
        duplex: 'half',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) }
      })
    },
    async hash(asset) {
      const response = await request(`${api}/releases/assets/${asset.id}`, {
        headers: { Accept: 'application/octet-stream' }
      })
      const hash = createHash('sha256')
      for await (const chunk of Readable.fromWeb(response.body)) hash.update(chunk)
      return hash.digest('hex')
    },
    async publish(id) {
      await request(`${api}/releases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: false, make_latest: 'true' })
      })
    }
  }
  const files = []
  for (const name of (await fs.readdir('release-artifacts')).sort()) {
    const file = path.resolve('release-artifacts', name)
    if (!(await fs.stat(file)).isFile())
      throw new Error('Only regular release assets may be uploaded')
    files.push({ name, path: file, size: (await fs.stat(file)).size, sha256: await digest(file) })
  }
  const url = await publishRelease(client, {
    version,
    tag,
    revision: process.env.GITHUB_SHA,
    marker: `<!-- community-release:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_SHA} -->`,
    notes: await fs.readFile('release-notes.md', 'utf8'),
    files
  })
  process.stdout.write(`Published ${url}\n`)
}
