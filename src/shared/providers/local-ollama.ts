/** Only the standard loopback Ollama endpoint gets automatic keyless setup. */
export function isLocalOllamaEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.port === '11434' &&
      ['', '/v1'].includes(url.pathname.replace(/\/+$/, '')) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function isOllamaPlaceholder(value: string | undefined): boolean {
  return !value?.trim() || ['ollama', 'local'].includes(value.trim())
}
