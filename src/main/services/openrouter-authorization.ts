import { randomUUID } from 'node:crypto'
import { AppError, ValidationError } from './errors'
import type { ProviderService } from './provider-service'
import { OAuthExchangeError, withSystemProxyFetch } from './system-fetch'

const origin = 'https://openrouter.ai'
const tokenEndpoint = origin + '/api/v1/auth/keys'

export class OpenRouterAuthorization {
  private controller: AbortController | undefined
  private closed = false

  constructor(private readonly providers: Pick<ProviderService, 'create'>) {}

  async connect(openAuthorization: (url: string) => Promise<void>): Promise<string> {
    if (this.closed || this.controller)
      throw new ValidationError('OpenRouter sign-in is unavailable')
    const host = process.env.PI_OAUTH_CALLBACK_HOST
    if (host && host !== '127.0.0.1')
      throw new ValidationError('OpenRouter authorization requires a loopback callback')

    const controller = new AbortController()
    this.controller = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60_000)])
    try {
      const { openrouterProvider } = await import('@earendil-works/pi-ai/providers/openrouter')
      const credential = await withSystemProxyFetch(
        () =>
          openrouterProvider().auth.oauth!.login({
            signal,
            notify: (event) => {
              if (event.type !== 'auth_url') return
              const url = URL.parse(event.url)
              if (
                url?.origin !== origin ||
                url.pathname !== '/auth' ||
                url.username ||
                url.password
              )
                throw new ValidationError('Invalid OpenRouter authorization URL')
              void openAuthorization(url.href).catch(() => controller.abort())
            },
            prompt: ({ signal: promptSignal }) =>
              new Promise((_, reject) => {
                const combined = AbortSignal.any([signal, ...(promptSignal ? [promptSignal] : [])])
                const abort = () => reject(new Error('Authorization ended'))
                if (combined.aborted) abort()
                else combined.addEventListener('abort', abort, { once: true })
              })
          }),
        tokenEndpoint
      )
      signal.throwIfAborted()
      const provider = await this.providers.create({
        key: 'openrouter-' + randomUUID(),
        name: 'openrouter',
        displayName: 'OpenRouter',
        protocol: 'openai-completions',
        baseUrl: origin + '/api/v1',
        apiKey: { kind: 'literal', literal: credential.access },
        authHeader: true,
        headers: {},
        enabled: true,
        timeout: null,
        defaultModelId: 'openrouter/auto-code'
      })
      return provider.key
    } catch (error) {
      if (error instanceof AppError) throw error
      const exchange = error instanceof OAuthExchangeError ? error : undefined
      throw new ValidationError('OpenRouter sign-in did not complete', {
        reason: signal.aborted
          ? signal.reason?.name === 'TimeoutError'
            ? 'timeout'
            : 'cancelled'
          : exchange?.reason,
        status: exchange?.status
      })
    } finally {
      this.controller = undefined
    }
  }

  cancel(): void {
    this.controller?.abort()
  }

  close(): void {
    this.closed = true
    this.cancel()
  }
}
