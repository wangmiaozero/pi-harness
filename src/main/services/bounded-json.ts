export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.length
      if (bytes > maxBytes) throw new Error('Response exceeds size limit')
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Parse a JSON response with a byte limit enforced while reading the stream. */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, maxBytes))
}
