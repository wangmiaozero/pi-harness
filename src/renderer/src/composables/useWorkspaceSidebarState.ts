import { ref } from 'vue'

const STORAGE_KEY = 'pi-harness.workspace-sidebar-collapsed.v1'
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}
const collapsed = ref(readCollapsed())
function toggle(): void {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed.value))
  } catch {
    /* Keep the current view usable without storage. */
  }
}

/** Shared by the titlebar control and the workspace view. */
export function useWorkspaceSidebarState() {
  return { collapsed, toggle }
}
