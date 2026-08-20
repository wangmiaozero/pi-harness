/**
 * Normalize provider baseUrl for Pi / OpenAI-compatible endpoints.
 *
 * Users often paste the full chat path:
 *   https://api.example.com/v1/chat/completions
 * Pi expects only the API root:
 *   https://api.example.com/v1
 * (Pi / the client appends /chat/completions or /models themselves.)
 */

export interface BaseUrlNormalizeResult {
  url: string
  changed: boolean
  stripped: string | null
}

const STRIP_SUFFIXES = [
  /\/chat\/completions\/?$/i,
  /\/completions\/?$/i,
  /\/responses\/?$/i,
  /\/messages\/?$/i,
  /\/models\/?$/i
]

export function normalizeProviderBaseUrl(raw: string): BaseUrlNormalizeResult {
  let url = raw.trim()
  if (!url) return { url: '', changed: false, stripped: null }

  // Drop trailing slash for consistent storage (except bare origin — keep simple).
  let stripped: string | null = null
  for (const re of STRIP_SUFFIXES) {
    if (re.test(url)) {
      const next = url.replace(re, '')
      stripped = url.slice(next.length)
      url = next
      break
    }
  }
  url = url.replace(/\/+$/, '')
  const changed = url !== raw.trim().replace(/\/+$/, '') || stripped != null
  return { url, changed: changed || stripped != null, stripped }
}

/** Human hint shown under the Base URL field. */
export function baseUrlHintForProtocol(protocol: string): string {
  if (protocol === 'openai-completions' || protocol === 'openai-responses') {
    return 'Use the API root only (e.g. https://api.example.com/v1). Do not append /chat/completions.'
  }
  if (protocol === 'anthropic-messages') {
    return 'Use the API root only (e.g. https://api.anthropic.com or https://ark.cn-beijing.volces.com/api/plan). Client appends /v1/messages — do not include it.'
  }
  return 'Use the provider API root, not a specific chat/completions path.'
}
