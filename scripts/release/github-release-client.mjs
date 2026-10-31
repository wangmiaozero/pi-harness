import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fetchOfficial, readBounded } from '../../src/main/updater/security/transport.mjs'

const networkCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
])
class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`)
    this.status = status
  }
}
class AssetIntegrityError extends Error {}
function networkCode(error) {
  for (let depth = 0; error && depth < 5; depth++, error = error.cause)
    if (networkCodes.has(error.code)) return error.code
  return null
}
function transient(error) {
  return (
    networkCode(error) !== null ||
    (error instanceof HttpError && [408, 500, 502, 503, 504].includes(error.status))
  )
}
function failure(operation, error, signal) {
  const reason = signal?.aborted
    ? 'deadline exceeded'
    : error instanceof HttpError || error instanceof AssetIntegrityError
      ? error.message
      : (networkCode(error) ?? 'request or response failed')
  // Do not include request headers, signed CDN URLs, or arbitrary remote error text.
  return new Error(`${operation}: ${reason}`)
}
function id(value) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Invalid GitHub release identifier')
  return value
}

/** Release-only transport. Mutations are never blindly repeated. */
export function createReleaseClient({
  repository,
  token,
  marker,
  revision,
  tag,
  files,
  fetcher = fetch,
  log = () => {},
  pause = (ms, signal) => delay(ms, undefined, { signal }),
  timeoutMs = 300_000
}) {
  if (repository !== 'wangmiaozero/pi-harness') throw new Error('Unexpected release repository')
  const api = `https://api.github.com/repos/${repository}`
  const expected = new Set(files.map((file) => file.name))
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const deadline = () => AbortSignal.timeout(timeoutMs)
  async function recoverRead(operation, signal, read) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        signal.throwIfAborted()
        return await read()
      } catch (error) {
        if (signal.aborted || !transient(error) || attempt === 3)
          throw failure(operation, error, signal)
        log(`${operation}: recovering ${networkCode(error) ?? error.message} (${attempt}/3)`)
        try {
          await pause(250 * attempt, signal)
        } catch (error) {
          throw failure(operation, error, signal)
        }
      }
    }
  }
  async function response(url, options, signal) {
    const result = await fetcher(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal,
      redirect: 'error'
    })
    if (!result.ok) {
      await result.body?.cancel().catch(() => {})
      throw new HttpError(result.status)
    }
    return result
  }
  async function json(url, operation, signal, allowMissing = false) {
    return recoverRead(operation, signal, async () => {
      let result
      try {
        result = await response(url, {}, signal)
      } catch (error) {
        if (allowMissing && error instanceof HttpError && error.status === 404) return null
        throw error
      }
      return JSON.parse((await readBounded(result, 4 * 1024 * 1024)).toString('utf8'))
    })
  }
  async function write(url, options, signal) {
    return JSON.parse(
      (await readBounded(await response(url, options, signal), 4 * 1024 * 1024)).toString('utf8')
    )
  }
  async function assetFetch(url, options) {
    const result = await fetcher(url, options)
    if (!result.ok && ![301, 302, 303, 307, 308].includes(result.status)) {
      await result.body?.cancel().catch(() => {})
      throw new HttpError(result.status)
    }
    return result
  }
  async function get(releaseId, { signal = deadline() } = {}) {
    const release = await json(`${api}/releases/${id(releaseId)}`, 'Read draft metadata', signal)
    release.assets = []
    for (let page = 1; ; page++) {
      const assets = await json(
        `${api}/releases/${releaseId}/assets?per_page=100&page=${page}`,
        'List draft assets',
        signal
      )
      release.assets.push(...assets)
      if (assets.length < 100) break
    }
    return release
  }
  function ownedDraft(release) {
    if (
      !release.draft ||
      release.tag_name !== tag ||
      release.target_commitish !== revision ||
      !release.body?.includes(marker)
    )
      throw new Error('Existing release is protected')
    const names = release.assets.map((asset) => asset.name)
    if (new Set(names).size !== names.length || names.some((name) => !expected.has(name)))
      throw new Error('Draft contains unexpected or duplicate assets')
  }
  return {
    async find(value) {
      if (value !== tag) throw new Error('Unexpected release tag')
      const signal = AbortSignal.timeout(Math.min(timeoutMs, 30_000))
      let release = await json(`${api}/releases/tags/${tag}`, 'Find release by tag', signal, true)
      if (!release) {
        // The tag endpoint only returns published releases. List drafts as well
        // before treating a 404 as permission to create another release.
        const matches = []
        for (let page = 1; ; page++) {
          const releases = await json(
            `${api}/releases?per_page=100&page=${page}`,
            'Find existing release draft',
            signal
          )
          matches.push(...releases.filter((item) => item.tag_name === tag))
          if (matches.length > 1)
            throw new Error('Multiple releases use this tag; refusing to select a draft')
          if (releases.length < 100) break
        }
        release = matches[0]
      }
      if (!release) return null
      const current = await get(release.id, { signal })
      if (current.draft) ownedDraft(current)
      return current
    },
    async create(body) {
      const signal = deadline()
      try {
        log('Create private release draft')
        return await write(
          `${api}/releases`,
          { method: 'POST', body: JSON.stringify(body) },
          signal
        )
      } catch (error) {
        throw failure('Create draft (reconcile before another creation)', error, signal)
      }
    },
    get,
    async upload(release, file) {
      const signal = deadline()
      const url = new URL(release.upload_url.split('{')[0])
      if (
        url.origin !== 'https://uploads.github.com' ||
        url.pathname !== `/repos/${repository}/releases/${id(release.id)}/assets` ||
        url.username ||
        url.password
      )
        throw new Error('Unexpected asset upload host or path')
      url.searchParams.set('name', file.name)
      for (let attempt = 1; attempt <= 3; attempt++) {
        const stream = createReadStream(file.path)
        let interrupted
        try {
          signal.throwIfAborted()
          log(`Upload ${file.name} (${attempt}/3)`)
          await write(
            url,
            {
              method: 'POST',
              body: stream,
              duplex: 'half',
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(file.size)
              }
            },
            signal
          )
          return
        } catch (error) {
          interrupted = error
        } finally {
          stream.destroy()
          await finished(stream).catch(() => {})
        }
        if (
          signal.aborted ||
          (!transient(interrupted) &&
            !(interrupted instanceof HttpError && interrupted.status === 422))
        )
          throw failure(`Upload ${file.name}`, interrupted, signal)
        // A reset may lose the response after GitHub has committed the upload.
        // Establish current ownership and asset state before sending any bytes again.
        log(
          `Upload ${file.name}: ${networkCode(interrupted) ?? interrupted.message}; reconciling draft`
        )
        const current = await get(release.id, { signal })
        ownedDraft(current)
        const asset = current.assets.find((asset) => asset.name === file.name)
        if (asset) {
          if (asset.state !== 'uploaded' || asset.size !== file.size)
            throw new Error(
              `Interrupted upload left an incomplete asset; refusing to replace ${file.name}`
            )
          log(`Recovered completed upload ${file.name}; remote bytes will be verified`)
          return
        }
        if (attempt === 3 || !transient(interrupted))
          throw failure(`Upload ${file.name}`, interrupted, signal)
        log(`Upload ${file.name}: remote absence confirmed, reopening local stream`)
        try {
          await pause(250 * attempt, signal)
        } catch (error) {
          throw failure(`Upload ${file.name}`, error, signal)
        }
      }
    },
    async hash(asset) {
      const signal = deadline()
      const operation = `Verify remote asset ${asset.name}`
      log(operation)
      return recoverRead(operation, signal, async () => {
        const result = await fetchOfficial(`${api}/releases/assets/${id(asset.id)}`, assetFetch, {
          headers: { ...headers, Accept: 'application/octet-stream' },
          signal
        })
        const hash = createHash('sha256')
        let size = 0
        for await (const chunk of Readable.fromWeb(result.body)) {
          size += chunk.length
          if (size > asset.size)
            throw new AssetIntegrityError('Remote asset exceeds its declared size')
          hash.update(chunk)
        }
        if (size !== asset.size)
          throw new AssetIntegrityError('Remote asset download was truncated')
        return hash.digest('hex')
      })
    },
    async read(asset, limit) {
      const signal = AbortSignal.timeout(Math.min(timeoutMs, 120_000))
      return recoverRead(`Read signed release asset ${asset.name}`, signal, async () =>
        readBounded(
          await fetchOfficial(`${api}/releases/assets/${id(asset.id)}`, assetFetch, {
            headers: { ...headers, Accept: 'application/octet-stream' },
            signal
          }),
          limit
        )
      )
    },
    async publish(releaseId) {
      const signal = deadline()
      try {
        log('Publish verified release draft')
        await write(
          `${api}/releases/${id(releaseId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ draft: false, make_latest: 'true' })
          },
          signal
        )
      } catch (error) {
        throw failure(
          'Publish draft (check remote state before another publication)',
          error,
          signal
        )
      }
    }
  }
}
