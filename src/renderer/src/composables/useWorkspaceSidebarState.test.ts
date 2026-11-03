import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})
it('shares collapse state between titlebar and workspace and restores the existing saved preference', async () => {
  localStorage.setItem('pi-harness.workspace-sidebar-collapsed.v1', 'true')
  const { useWorkspaceSidebarState } = await import('./useWorkspaceSidebarState')
  const titlebar = useWorkspaceSidebarState()
  const workspace = useWorkspaceSidebarState()
  expect(workspace.collapsed.value).toBe(true)
  titlebar.toggle()
  expect(workspace.collapsed.value).toBe(false)
  expect(localStorage.getItem('pi-harness.workspace-sidebar-collapsed.v1')).toBe('false')
})
it('keeps collapsing usable when storage writes fail', async () => {
  const { useWorkspaceSidebarState } = await import('./useWorkspaceSidebarState')
  const state = useWorkspaceSidebarState()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable')
  })
  expect(() => state.toggle()).not.toThrow()
  expect(state.collapsed.value).toBe(true)
})
