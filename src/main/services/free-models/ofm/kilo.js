// Anonymous Kilo gateway adapter adapted from Our Free Model (MIT).

import {
  CODE,
  UpstreamError,
  classifyFailure,
  readHead,
  readSse,
  replayStream,
  retryAfter,
  sniffBody,
  transportCause
} from './http.js'
const LISTING_TIMEOUT_MS = 15000
const TURN_TIMEOUT_MS = 300000
const testUpstream = process.env.PI_HARNESS_FREE_MODELS_TEST
const KILO_BASE = /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(testUpstream ?? '')
  ? testUpstream
  : 'https://ai-gateway.kilo.ai/api/v1'
const KILO_ATTRIBUTION = { 'user-agent': 'Pi-Harness', 'x-title': 'Pi-Harness' }

/** The cached listing document and its validator, for conditional rounds. */
let listingCache = null
let listingETag = null

/** One listing round: `GET {base}/models`, conditionally when the gateway
 *  named a validator last time. Returns the parsed JSON document; a `304`
 *  answers with the cached one. */
export async function fetchKiloListing({ signal, timeoutMs = LISTING_TIMEOUT_MS } = {}) {
  if (testUpstream === 'off')
    throw new UpstreamError('Catalog disabled in this test', CODE.transport)
  signal?.throwIfAborted()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let callerAborted = false
  const onCallerAbort = () => {
    callerAborted = true
    controller.abort()
  }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const headers = {
      accept: 'application/json',
      ...KILO_ATTRIBUTION,
      ...(listingETag !== null ? { 'if-none-match': listingETag } : {})
    }
    const response = await fetch(`${KILO_BASE}/models`, {
      headers,
      redirect: 'error',
      signal: controller.signal
    })
    if (response.status === 304 && listingCache !== null) return listingCache
    const text = await response.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: { message: text.slice(0, 300) || `HTTP ${response.status}` } }
    }
    if (!response.ok)
      throw classifyFailure(
        response.status,
        payload,
        retryAfter(response.headers.get('retry-after'))
      )
    if (!Array.isArray(payload?.data))
      throw new UpstreamError('Invalid Kilo model listing', CODE.server)
    listingETag = response.headers.get('etag')
    listingCache = payload
    return payload
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (callerAborted || signal?.aborted === true)
      throw new UpstreamError('request aborted', CODE.aborted)
    if (error?.name === 'AbortError')
      throw new UpstreamError('model listing timed out', CODE.timeout)
    throw new UpstreamError(
      `model listing failed: ${error?.message ?? error}${transportCause(error)}`,
      CODE.transport
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onCallerAbort)
  }
}

/**
 * POST one turn and stream back decoded SSE `data:` payloads.
 *
 * Mirrors the other lanes' posters byte-for-byte in discipline — the body shape
 * is sniffed before the Content-Type is believed, the head bytes are replayed so
 * no token is buffered, and an idle stream dies at `timeoutMs` (every chunk
 * resets it; the gateway also sends `: KILO PROCESSING` comment lines while the
 * model is being scheduled, which the SSE reader skips and which keep the idle
 * cutoff honest without tripping it).
 */
export async function postKiloStreamed({
  body,
  signal: caller,
  onData,
  timeoutMs = TURN_TIMEOUT_MS
}) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = caller ? AbortSignal.any([caller, deadline]) : deadline
  try {
    await postKilo({ body, signal, onData, timeoutMs })
  } catch (error) {
    if (deadline.aborted && !caller?.aborted)
      throw new UpstreamError('Kilo request timed out', CODE.timeout)
    throw error
  }
}

async function postKilo({ body, signal, onData, timeoutMs }) {
  signal?.throwIfAborted()
  const bodyText = JSON.stringify(body)
  let response
  try {
    response = await fetch(`${KILO_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...KILO_ATTRIBUTION
      },
      body: bodyText,
      redirect: 'error',
      signal
    })
  } catch (error) {
    if (signal?.aborted === true || error?.name === 'AbortError')
      throw new UpstreamError('request aborted', CODE.aborted)
    throw new UpstreamError(
      `model request failed: ${error?.message ?? error}${transportCause(error)}`,
      CODE.transport
    )
  }

  const setRetry = retryAfter(response.headers.get('retry-after'))
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw classifyKilo(response.status, text, setRetry)
  }
  if (response.body === null) throw new UpstreamError('model stream returned no body', CODE.empty)

  const head = await readHead(response.body, 4096, { signal, timeoutMs })
  const shape = sniffBody(head.text)
  if (shape !== 'sse') {
    const text = head.text + head.decoder.decode()
    await head.reader.cancel().catch(() => {})
    head.reader.releaseLock()
    if (shape === 'json') {
      try {
        const payload = JSON.parse(text)
        if (payload?.error) throw classifyKilo(response.status, text, setRetry)
      } catch (error) {
        if (error instanceof UpstreamError) throw error
      }
    }
    if (shape === 'empty') throw new UpstreamError('Kilo returned no stream content', CODE.empty)
    throw new UpstreamError('Kilo did not return an event stream', CODE.server)
  }

  let finished = false
  let content = false
  await readSse(
    replayStream(head),
    (data) => {
      let payload
      try {
        payload = JSON.parse(data)
      } catch {
        throw new UpstreamError('Kilo sent an invalid event', CODE.server)
      }
      if (payload?.error || payload?.type === 'error')
        throw classifyKilo(Number(payload?.error?.code) || undefined, data, setRetry)
      const choice = payload?.choices?.[0]
      if (choice?.finish_reason === 'error' || choice?.finish_reason === 'content_filter')
        throw new UpstreamError('Kilo stopped generation', CODE.client)
      if (choice?.finish_reason) finished = true
      const delta = choice?.delta
      if (delta?.content || delta?.tool_calls?.length) content = true
      onData(data)
    },
    signal,
    timeoutMs
  )
  if (!finished || !content)
    throw new UpstreamError('Kilo stream ended before a complete reply', CODE.empty)
}

/**
 * Classify one of this gateway's refusals.
 *
 * The envelope names its class twice — `error.code` inside the error object and
 * `error_type` beside it — while the shared classifier reads `error.type`, so the
 * envelope is reshaped onto that vocabulary first. Two of this lane's own codes
 * deserve better than a bare status: a paid id requested keyless is the caller
 * picking a model this lane does not serve (a request defect, not a broken
 * credential store), and an explicit moderation block is the upstream's answer,
 * not a transport fault.
 */
function classifyKilo(status, text, retryAfterMs) {
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { error: { message: text.slice(0, 300) || `HTTP ${status}` } }
  }
  const type = payload?.error_type ?? payload?.error?.type ?? payload?.error?.code
  const rawMeta = payload?.error?.metadata?.raw ?? payload?.metadata?.raw
  let message =
    payload?.error?.message ?? (typeof payload?.message === 'string' ? payload.message : undefined)
  if (typeof rawMeta === 'string' && rawMeta.trim() !== '') {
    let rawDetail
    try {
      const parsed = JSON.parse(rawMeta)
      rawDetail =
        typeof parsed?.error === 'string'
          ? parsed.error
          : typeof parsed?.message === 'string'
            ? parsed.message
            : typeof parsed?.error?.message === 'string'
              ? parsed.error.message
              : ''
    } catch {
      rawDetail = rawMeta.slice(0, 200).trim()
    }
    const providerName = payload?.error?.metadata?.provider_name ?? payload?.metadata?.provider_name
    const providerSuffix =
      typeof providerName === 'string' && providerName !== '' ? ` (${providerName})` : ''
    if (rawDetail !== '') {
      message = message
        ? `${message}: ${rawDetail}${providerSuffix}`
        : `${rawDetail}${providerSuffix}`
    }
  }
  const shaped = {
    error: {
      ...payload?.error,
      ...(message !== undefined ? { message } : {}),
      ...(type === undefined ? {} : { type: String(type) })
    }
  }
  if (typeof type === 'string' && /PAID_MODEL_AUTH_REQUIRED/i.test(type)) {
    return new UpstreamError(
      'this model is not on the free pool: it needs a Kilo account, so it is not served by this channel',
      CODE.client,
      { status }
    )
  }
  if (
    status === 413 ||
    /context[_ ]length[_ ]exceeded|prompt (?:is )?too long|exceeds the context window|maximum context length is|too many tokens/i.test(
      String(type ?? '') + ' ' + String(message ?? '')
    )
  ) {
    return new UpstreamError('The request exceeds the context window', CODE.client, { status })
  }
  const failure = classifyFailure(status, shaped, retryAfterMs)
  if (typeof failure.message === 'string' && /moderation|flagged|filtered/i.test(failure.message)) {
    return new UpstreamError(failure.message, CODE.client, { status })
  }
  return failure
}
