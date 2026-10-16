import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { validateVersion, changelogSection } from './policy.mjs'
import { gt, valid } from 'semver'
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
const tag = process.env.RELEASE_TAG
if (process.env.GITHUB_EVENT_NAME === 'push') {
  validateVersion(version, tag)
  const revision = execFileSync('git', ['rev-parse', `${tag}^{commit}`], {
    encoding: 'utf8'
  }).trim()
  if (revision !== process.env.GITHUB_SHA)
    throw new Error('Tag does not resolve to this build commit')
  changelogSection(await fs.readFile('CHANGELOG.md', 'utf8'), version)
  const latest = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases/latest`,
    {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      signal: AbortSignal.timeout(30_000)
    }
  )
  if (latest.status !== 404) {
    if (!latest.ok) throw new Error(`Latest release check failed: HTTP ${latest.status}`)
    const current = valid((await latest.json()).tag_name)
    if (!current || !gt(version, current))
      throw new Error('The new release must be newer than the latest published version')
  }
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${tag}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(30_000)
    }
  )
  if (response.status !== 404) {
    if (!response.ok) throw new Error(`Cannot establish release absence: ${response.status}`)
    const release = await response.json()
    const marker = `<!-- community-release:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_SHA} -->`
    if (!release.draft || !release.body?.includes(marker))
      throw new Error('An existing release may not be overwritten')
  }
}
process.stdout.write(`Validated ${version}; ${tag ?? 'preview'}\n`)
