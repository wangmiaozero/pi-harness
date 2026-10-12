import type { WebContents } from 'electron'

const owners = new WeakMap<WebContents, string>()
function documentUrl(url: string): string {
  return url.split('#')[0]
}
// Only the trusted host of a currently visible architecture view can request
// gesture-initiated fullscreen. Diagram documents and other permissions stay denied.
export function setArchitectureFullscreenAllowed(owner: WebContents, active: boolean): void {
  if (active && !owner.isDestroyed()) owners.set(owner, documentUrl(owner.getURL()))
  else owners.delete(owner)
}
export function canUseArchitectureFullscreen(
  requester: WebContents | null,
  permission: string,
  details: { isMainFrame: boolean; requestingUrl?: string }
): boolean {
  if (
    !requester ||
    requester.isDestroyed() ||
    permission !== 'fullscreen' ||
    !details.isMainFrame ||
    !details.requestingUrl
  )
    return false
  const allowed = owners.get(requester)
  return Boolean(
    allowed &&
    allowed === documentUrl(requester.getURL()) &&
    allowed === documentUrl(details.requestingUrl)
  )
}
