// HTTP error classification and SSE framing adapted from Our Free Model (MIT).

export const CODE = {
  region: 'REGION_BLOCKED',
  quota: 'RATE_LIMIT',
  credential: 'INVALID_CREDENTIAL',
  permission: 'PERMISSION_DENIED',
  exhausted: 'QUOTA_EXHAUSTED',
  transport: 'TRANSPORT',
  timeout: 'TIMEOUT',
  server: 'SERVER',
  client: 'CLIENT_ERROR',
  empty: 'EMPTY_RESPONSE',
  aborted: 'ABORTED'
}

export class UpstreamError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.code = code
    Object.assign(this, details)
  }
}

/**
 * The socket-level facts behind a transport failure, walked off the error's
 * `cause` chain.
 *
 * Node's fetch collapses every DNS, TCP and TLS refusal into `TypeError: fetch
 * failed`; the reason a user could act on — the ENOTFOUND, the ECONNRESET, the
 * certificate alert — lives one or two `cause` links deeper and used to be
 * dropped, leaving the settings page's probe reporting an unexplainable "fetch
 * failed" (issue #79). The chain is walked at most three links deep, the codes
 * and first lines are deduplicated, and anything found is appended by the
 * transport wrap sites so "fetch failed" reads "fetch failed — getaddrinfo
 * ENOTFOUND opencode.ai (ENOTFOUND)" instead.
 */
export function transportCause(error) {
  const parts = []
  let node = error
  for (let depth = 0; depth < 3 && node?.cause !== undefined; depth += 1) {
    node = node.cause
    if (node === null || typeof node !== 'object') break
    const code = typeof node.code === 'string' && node.code !== '' ? node.code : ''
    const line = typeof node.message === 'string' ? node.message.split('\n')[0].trim() : ''
    if (line === '' && code === '') continue
    const fact =
      line === '' || line.includes(code) ? (line === '' ? code : line) : `${line} (${code})`
    if (!parts.includes(fact)) parts.push(fact)
  }
  return parts.length > 0 ? ` — ${parts.join('; ')}` : ''
}

/** Turn a gateway JSON error envelope into a classified failure. */
export function classifyFailure(status, payload, retryAfterMs) {
  const error = payload?.error ?? payload ?? {}
  const type = typeof error.type === 'string' ? error.type : ''
  const raw = typeof error.message === 'string' ? error.message : `upstream HTTP ${status}`
  // A front proxy (the free lane's CDN, the co-paid lane's WAF) answers hard
  // failures with a whole HTML error page. The status alone misfiles it — a
  // WAF's 403 is not a bad credential, its 413 is not a request the user can
  // fix by re-sending — and the markup buries the one useful fact. Callers may
  // hand over the raw page (the free lane's fold) or the one-line reduction
  // (errorPageMessage); both name the hop instead of the credential (issue #63).
  const rawHtml = /^\s*<(!doctype|html[\s>])/i.test(raw)
  const isHtmlPage = rawHtml || raw.includes('with an HTML error page')
  const message = rawHtml
    ? `the gateway's front proxy answered HTTP ${status} with an HTML error page — usually a WAF or body-size limit in front of the gateway, not your credentials; if this hit a long conversation, its request size is the likely trigger`
    : raw
  const flat = message.toLowerCase()
  if (
    type === 'RegionError' ||
    /not available in (your|this) (country|region)|unsupported (country|region)|region[_ ]blocked/i.test(
      flat
    )
  ) {
    return new UpstreamError(message, CODE.region, { status, type })
  }
  if (
    type !== 'permission_error' &&
    (status === 402 ||
      /insufficient_quota|quota_exhausted|FreeUsageLimitError/i.test(type) ||
      error.code === 'insufficient_quota')
  ) {
    return new UpstreamError(message, CODE.exhausted, {
      status,
      type,
      providerRetryAfterMs: retryAfterMs
    })
  }
  if (type !== 'permission_error' && (status === 429 || /usage limit|rate limit/i.test(flat))) {
    return new UpstreamError(message, CODE.quota, {
      status,
      type,
      providerRetryAfterMs: retryAfterMs
    })
  }
  if (type === 'permission_error')
    return new UpstreamError(message, CODE.permission, { status, type })
  // An HTML page at 401/403 is the front proxy speaking, not the credential
  // store: fall through to the 4xx branch so users are not sent re-logging for
  // a WAF refusal.
  if (status === 401 || status === 403)
    return new UpstreamError(message, isHtmlPage ? CODE.client : CODE.credential, { status, type })
  if (type === 'ModelError' || /model is unavailable|not supported/.test(flat)) {
    return new UpstreamError(message, CODE.server, { status, type, unavailable: true })
  }
  // 4xx is the request's own fault: replaying the identical body reproduces the
  // identical refusal, so it stays outside the harness's retryable set — which
  // is why SERVER (retryable) must not be the fallback for it. 408 and 425 are
  // the carve-out: they name the gateway's own timing trouble, and a re-send
  // can answer differently. Out-of-band callers pass no status at all, so they
  // keep falling through to SERVER below.
  if (status >= 400 && status < 500 && status !== 408 && status !== 425) {
    return new UpstreamError(message, CODE.client, { status, type })
  }
  return new UpstreamError(message, CODE.server, { status, type })
}

/** Parse either HTTP Retry-After form. */
export function retryAfter(header) {
  if (!header) return undefined
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : undefined
}

/**
 * Classify the beginning of a response body by shape.
 *
 * @param {string} text - the decoded head, possibly a partial stream
 * @returns {'sse'|'json'|'empty'|'unknown'}
 */
export function sniffBody(text) {
  const head = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trimStart()
  if (head === '') return 'empty'
  if (head.startsWith(':') || /^(?:data|event|id|retry)[ \t]*:/m.test(head.slice(0, 64)))
    return 'sse'
  if (head.startsWith('{') || head.startsWith('[')) return 'json'
  return 'unknown'
}

/**
 * Take the first `limit` bytes of a body without losing the rest of it.
 *
 * Stops as soon as the head has said it is a stream: a short answer whose server
 * keeps the connection open would otherwise sit here until the deadline, and the
 * cancel on the way out discards everything already read — a complete turn,
 * reported as a retryable timeout. Frames arrive as they are read, so the first
 * token is not held back for the rest of the sniff window either.
 *
 * Exported for the co-paid lane's poster (`src/eac.js`), which shares the sniff
 * discipline but not the headers.
 *
 * @param {ReadableStream} stream
 * @param {number} limit
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @param {number} options.timeoutMs - how long to wait for anything at all
 * @returns {Promise<{reader:object, chunks:Uint8Array[], done:boolean, text:string, decoder:TextDecoder}>}
 */
export async function readHead(stream, limit, { signal, timeoutMs }) {
  const reader = stream.getReader()
  const chunks = []
  // One decoder for the whole body: flushing here would corrupt a multi-byte
  // character whose tail arrives in the next chunk.
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  let done = false
  try {
    const deadline = Date.now() + timeoutMs
    while (size < limit) {
      const row = await headRead(reader, signal, deadline)
      if (row.done) {
        done = true
        break
      }
      if (row.value === undefined) continue
      chunks.push(row.value)
      size += row.value.byteLength ?? 0
      text += decoder.decode(row.value, { stream: true })
      if (sniffBody(text) === 'sse') break
    }
  } catch (error) {
    // Abandoning the body: cancel it so the connection is not held, and do not
    // let a lock-release complaint replace the failure the caller has to
    // classify (a raw TypeError here would reach the harness unclassified).
    await reader.cancel().catch(() => {})
    try {
      reader.releaseLock?.()
    } catch {
      /* mid-teardown */
    }
    throw classifyStreamFailure(error, signal)
  }
  return { reader, chunks, done, text, decoder }
}

/**
 * Normalize anything the body reads can throw into an `UpstreamError`.
 *
 * This matters beyond tidiness: aborting a request rejects the pending
 * `reader.read()` with the signal's own `DOMException`, whose `code` is the
 * *numeric* legacy `20`. The adapter's `toFailure` only carries a string code, so
 * anything it does not recognize is reported as `TRANSPORT` — and `TRANSPORT` is
 * in the retryable set, which would have the harness retry a turn the user
 * deliberately cancelled.
 */
export function classifyStreamFailure(error, signal) {
  if (error instanceof UpstreamError) return error
  if (signal?.aborted === true || error?.name === 'AbortError')
    return new UpstreamError('request aborted', CODE.aborted)
  return new UpstreamError(
    `upstream stream read failed: ${error?.message ?? error}${transportCause(error)}`,
    CODE.transport
  )
}

/**
 * One read off the body while deciding what it is, bounded by the same deadline
 * and abort signal `readSse` would have honoured. Without this a connection that
 * accepts the request and then never sends a byte would hang the turn here, in
 * the few lines of code that run before any watchdog exists.
 */
async function headRead(reader, signal, deadline) {
  if (signal?.aborted) throw new UpstreamError('request aborted', CODE.aborted)
  let timer
  let onAbort
  const pending = reader.read()
  const halted = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new UpstreamError('upstream sent no bytes before its deadline', CODE.timeout)),
      Math.max(0, deadline - Date.now())
    )
    timer.unref?.()
    onAbort = () => {
      void reader.cancel().catch(() => {})
      reject(new UpstreamError('request aborted', CODE.aborted))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([pending, halted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    // The losing read settles on its own once the reader is cancelled or closed;
    // nothing is waiting on it, so its outcome must not surface as a rejection.
    pending.catch(() => {})
  }
}

/**
 * Turn a head that was already read, plus the reader that follows it, back into
 * one byte stream. Shared with the co-paid lane's poster (`src/eac.js`).
 */
export function replayStream(head) {
  const stream = (async function* () {
    try {
      for (const chunk of head.chunks) yield chunk
      if (head.done) return
      while (true) {
        const row = await head.reader.read()
        if (row.done) return
        if (row.value !== undefined) yield row.value
      }
    } finally {
      if (!head.done) await head.reader.cancel().catch(() => {})
      head.reader.releaseLock?.()
    }
  })()
  // Async-generator return() waits behind an already pending next(). Expose a
  // direct cancel so readSse can close the underlying response immediately.
  stream.cancel = () => (head.done ? undefined : head.reader.cancel())
  return stream
}

export async function readSse(source, onData, signal, timeoutMs = 300000) {
  const reader = typeof source?.getReader === 'function' ? source.getReader() : null
  const iterator =
    reader === null
      ? typeof source?.[Symbol.asyncIterator] === 'function'
        ? source[Symbol.asyncIterator]()
        : source
      : null
  const decoder = new TextDecoder()
  let buffer = ''
  let data = []
  let rawJson = ''
  let deadline = Date.now() + timeoutMs
  // Did this read carry anything a caller would call progress? A keepalive is a
  // comment line (`: ping`), and SSE defines it as something to ignore — so it
  // must not wind the idle clock. Before this witness existed, every read reset
  // `deadline` unconditionally, so a gateway that pings every 10–15s kept a
  // wedged, token-less turn alive indefinitely: the request never timed out, it
  // just held a connection until the gateway itself gave up (#460). The witness
  // is deliberately wider than "onData fired" — a large raw-JSON body or a
  // multi-line event can spend several reads accumulating before anything is
  // dispatched, and those reads are real progress.
  let content = false
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      const pending = reader !== null ? reader.cancel() : iterator?.cancel?.()
      void Promise.resolve(pending).catch(() => {})
      if (reader === null) void Promise.resolve(iterator?.return?.()).catch(() => {})
    } catch {
      /* already closed */
    }
  }
  // Cancelling a reader is best effort: undici can leave an already pending
  // `next()` unresolved until the peer closes. Race that read with the caller's
  // abort so a held response cannot keep the adapter waiting.
  const next = async () => {
    if (signal?.aborted) throw new UpstreamError('request aborted', CODE.aborted)
    let onAbort, timer
    const halted = new Promise((_, reject) => {
      onAbort = () => {
        stop()
        reject(new UpstreamError('request aborted', CODE.aborted))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(
        () => {
          stop()
          reject(new UpstreamError('upstream stream idle past its deadline', CODE.timeout))
        },
        Math.max(0, deadline - Date.now())
      )
    })
    const pending = Promise.resolve().then(() =>
      reader !== null ? reader.read() : iterator.next()
    )
    try {
      return await Promise.race([pending, halted])
    } finally {
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      // The losing read settles after the source is cancelled; do not let its
      // rejection become an unhandled promise after the caller has returned.
      pending.catch(() => {})
    }
  }
  const dispatch = () => {
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') return true
    if (payload !== '') {
      onData(payload)
      content = true
    }
    return false
  }
  const completeData = () => {
    if (!data.length) return false
    if (data.join('\n').trim() === '[DONE]') return true
    try {
      JSON.parse(data.join('\n'))
      return true
    } catch {
      return false
    }
  }
  const line = (value) => {
    const text = value.replace(/\r$/, '').replace(/^\uFEFF/, '')
    if (rawJson || text.trimStart().startsWith('{')) {
      if (!rawJson && dispatch()) return true
      rawJson += (rawJson ? '\n' : '') + text
      let payload
      try {
        payload = JSON.parse(rawJson)
      } catch {
        return false
      }
      rawJson = ''
      if (payload?.error || payload?.type === 'error') throw classifyFailure(undefined, payload)
      onData(JSON.stringify(payload))
      content = true
      return false
    }
    if (text === '') return dispatch()
    if (text.startsWith(':')) return false
    const colon = text.indexOf(':')
    const field = colon < 0 ? text : text.slice(0, colon)
    const valueText = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '')
    if (field === 'data') {
      // Compatible endpoints may omit blank separators between complete JSON events.
      if (completeData() && dispatch()) return true
      if (valueText.trim() === '[DONE]') {
        dispatch()
        return true
      }
      if (valueText !== '') content = true
      data.push(valueText)
    }
    return false
  }
  try {
    while (true) {
      const { value, done } = await next()
      if (done) break
      if (Date.now() > deadline)
        throw new UpstreamError('upstream stream idle past its deadline', CODE.timeout)
      if (value !== undefined) buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 4_000_000)
        throw new UpstreamError('Upstream event exceeds the size limit', CODE.server)
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const row = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line(row)) return
        newline = buffer.indexOf('\n')
      }
      // A row still waiting for its newline counts as progress unless what has
      // arrived so far is itself a comment: `: ping` split across two reads must
      // not wind the clock, while a raw-JSON body or a half-arrived `data:` line
      // must.
      const pending = buffer.replace(/^\uFEFF/, '').replace(/\r$/, '')
      if (pending.trim() !== '' && !pending.trimStart().startsWith(':')) content = true
      if (content) {
        content = false
        deadline = Date.now() + timeoutMs
      }
    }
    // Flush the decoder so a multi-byte character split over the last two chunks
    // is not silently dropped from the final payload.
    buffer += decoder.decode()
    if (buffer && line(buffer)) return
    if (rawJson)
      throw new UpstreamError(
        'upstream returned an incomplete JSON document inside its event stream',
        CODE.transport
      )
    dispatch()
  } catch (error) {
    throw classifyStreamFailure(error, signal)
  } finally {
    stop()
    if (reader !== null) {
      try {
        reader.releaseLock?.()
      } catch {
        /* pending read is still unwinding */
      }
    }
  }
}
