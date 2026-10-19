// Explicit redirect handling: credentials never follow GitHub's CDN redirect.
const repoPath = '/wangmiaozero/pi-harness/releases/'
export function assertOfficialUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('Untrusted release download URL')
  const allowed =
    (url.hostname === 'github.com' && url.pathname.startsWith(`${repoPath}download/v`)) ||
    (url.hostname === 'api.github.com' &&
      /^\/repos\/wangmiaozero\/pi-harness\/releases\/(?:latest|tags\/v[0-9.]+|assets\/\d+)$/.test(
        url.pathname
      )) ||
    (['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
      url.hostname
    ) &&
      url.pathname.startsWith('/github-production-release-asset'))
  if (!allowed) throw new Error('Untrusted release download source')
  return url
}

export async function fetchOfficial(value, fetcher = fetch, options = {}) {
  let url = assertOfficialUrl(value)
  const signal = options.signal ?? AbortSignal.timeout(120_000)
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal.throwIfAborted()
    const headers = { ...options.headers }
    if (url.origin !== 'https://api.github.com') {
      delete headers.Authorization
      delete headers.authorization
    }
    const response = await fetcher(url.href, { headers, signal, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Release redirect is missing its target')
      url = assertOfficialUrl(new URL(location, url).href)
      continue
    }
    if (response.redirected) throw new Error('Release transport followed an unchecked redirect')
    if (response.url) assertOfficialUrl(response.url)
    if (!response.ok || !response.body)
      throw new Error(`Release download failed: HTTP ${response.status}`)
    return response
  }
  throw new Error('Too many release download redirects')
}

export async function readBounded(response, limit) {
  const chunks = []
  let length = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) throw new Error('Release response exceeds size limit')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
