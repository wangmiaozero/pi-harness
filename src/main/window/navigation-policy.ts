/** Restrict renderer navigation to the exact packaged page or dev-server origin. */
export function isAllowedRendererNavigation(navigationUrl: string, rendererUrl: string): boolean {
  try {
    const target = new URL(navigationUrl)
    const expected = new URL(rendererUrl)

    if (target.protocol !== expected.protocol) return false
    if (expected.protocol === 'file:') {
      return target.pathname === expected.pathname && target.search === expected.search
    }

    return target.origin === expected.origin
  } catch {
    return false
  }
}
