import type { ElectronApplication } from '@playwright/test'

export interface ReleaseNetwork {
  /** Body of the GitHub "latest release" API response. */
  latest: Record<string, unknown>
  /** Local server holding the release files; without it every release file is missing. */
  assets?: string
}

/**
 * Answers official release URLs inside Electron's own network stack, so the updater's real
 * transport runs unchanged. Like GitHub, every release file redirects to its CDN first.
 */
export function routeReleaseNetwork(
  electronApp: ElectronApplication,
  network: ReleaseNetwork
): Promise<void> {
  return electronApp.evaluate(({ net, protocol }, { latest, assets }) => {
    const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/'
    protocol.handle('https', async (request) => {
      const url = new URL(request.url)
      if (url.href === 'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest')
        return Response.json(latest)
      const download =
        url.hostname === 'github.com' &&
        url.pathname.match(/^\/wangmiaozero\/pi-harness\/releases\/download\/v[^/]+\/([^/]+)$/)
      if (download)
        return new Response(null, { status: 302, headers: { location: cdn + download[1] } })
      if (url.href.startsWith(cdn)) {
        if (!assets) return new Response(null, { status: 404 })
        const response = await net.fetch(`${assets}/${url.href.slice(cdn.length)}`, {
          headers: request.headers,
          bypassCustomProtocolHandlers: true
        })
        return new Response(response.body, { status: response.status, headers: response.headers })
      }
      return net.fetch(request, { bypassCustomProtocolHandlers: true })
    })
  }, network)
}
