import type { PermissionMode } from '@shared/workspace/permission-mode'
import { PathDeniedError } from '../services/errors'

/** Per-call agent authorization never grants Renderer filesystem access. */
export async function assertAgentFilePermission(
  target: string,
  mode: PermissionMode | undefined,
  assertWorkspace: (target: string) => Promise<string>,
  approveExternal: (target: string) => Promise<boolean>,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  if (mode === 'auto') return target
  try {
    return await assertWorkspace(target)
  } catch (error) {
    if (!(error instanceof PathDeniedError) || !mode) throw error
    if (!(await approveExternal(target))) throw error
    signal?.throwIfAborted()
    return target
  }
}
