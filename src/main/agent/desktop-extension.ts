import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { applyWorkspacePrompt } from '@shared/workspace/workspace-context'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import { extractToolPath } from '../workspace/workspace-tool-guard'

export interface DesktopSessionContext {
  forceEmpty: boolean
  workspacePromptProvider: (() => string | null) | null
}

/** Host context and guards use the same public pipeline as nested/MCP tool calls. */
export function createDesktopExtension(
  context: DesktopSessionContext,
  guards: {
    assertWritable?: (target: string) => Promise<string>
    assertToolAllowed?: (toolName: string, input: unknown, signal?: AbortSignal) => Promise<void>
  }
): ExtensionFactory {
  return async (pi) => {
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
          if (target) await guards.assertWritable?.(target)
        }
        ctx.signal?.throwIfAborted()
        await guards.assertToolAllowed?.(event.toolName, event.input, ctx.signal)
      } catch (error) {
        // Pi isolates thrown extension errors; return a block to fail closed.
        return { block: true, reason: inspectRuntimeError(error).userMessage }
      }
      return undefined
    })
    if (process.env.PI_HARNESS_OPENCODE_STATE) {
      const { registerOpenCode } =
        await import('../../../resources/desktop-extension/opencode-provider.mjs')
      await registerOpenCode(pi, {
        resolveKey: async () => {
          const { secretStore } = await import('../security/secret-store')
          const { readState, credentialSlot } =
            await import('../../../resources/desktop-extension/opencode-state.mjs')
          const state = await readState()
          return state.authMode === 'inference' && state.enabled && state.hasCredential
            ? ((await secretStore.getSecret(credentialSlot(state), { strict: true })) ?? undefined)
            : undefined
        }
      })
    }
  }
}
