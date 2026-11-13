import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { applyWorkspacePrompt } from '@shared/workspace/workspace-context'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import { extractToolPath } from '../workspace/workspace-tool-guard'
import type { PermissionMode } from '@shared/workspace/permission-mode'
import { installCompactionPolicy } from '../../../resources/desktop-extension/compaction.mjs'
import { compactionDefaults } from './compaction-defaults'
import { loadPiCodingAgent } from './pi-sdk'
import type { ProviderAdvancedSettings } from '@shared/providers/advanced-settings'
import { installProviderSettings } from '../../../resources/desktop-extension/provider-settings.mjs'

export interface DesktopSessionContext {
  forceEmpty: boolean
  workspacePromptProvider: (() => string | null) | null
  providerSettings?: (
    provider: string,
    baseUrl: string
  ) => Promise<ProviderAdvancedSettings | undefined>
  providerNetwork?: Parameters<typeof installProviderSettings>[2]
  permissionMode?: PermissionMode
}

/** Host context and guards use the same public pipeline as nested/MCP tool calls. */
export function createDesktopExtension(
  context: DesktopSessionContext,
  guards: {
    assertWritable?: (target: string, signal?: AbortSignal) => Promise<string>
    assertToolAllowed?: (toolName: string, input: unknown, signal?: AbortSignal) => Promise<void>
  }
): ExtensionFactory {
  return async (pi) => {
    const { compact } = await loadPiCodingAgent()
    installCompactionPolicy(pi, compactionDefaults, compact)
    if (context.providerSettings && context.providerNetwork)
      await installProviderSettings(pi, context.providerSettings, context.providerNetwork)()
    pi.on('before_agent_start', (event) => ({
      // Both user and extension-triggered custom runs carry systemPrompt.
      systemPrompt: context.forceEmpty
        ? ''
        : applyWorkspacePrompt(event.systemPrompt, context.workspacePromptProvider?.() ?? null)
    }))
    pi.on('tool_call', async (event, ctx) => {
      try {
        if (event.toolName === 'write' || event.toolName === 'edit') {
          const target = extractToolPath(event.input)
          if (target) await guards.assertWritable?.(target, ctx.signal)
        }
        ctx.signal?.throwIfAborted()
        await guards.assertToolAllowed?.(event.toolName, event.input, ctx.signal)
      } catch (error) {
        // Pi isolates thrown extension errors; return a block to fail closed.
        return { block: true, reason: inspectRuntimeError(error).userMessage }
      }
      return undefined
    })
  }
}
