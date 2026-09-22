/**
 * AI commit-message generation (Phase 4).
 *
 * Rust collects a sanitised staged-diff summary; this module asks the Pi
 * model runtime for a Conventional Commit subject. Git itself never runs here.
 */

import type { PiSdkLoader } from '../pi/types.js'
import { RuntimeError } from '../pi/errors.js'

export interface CommitMessageContext {
  repositoryRoot: string
  summary: string
  recentMessages: string[]
  draft: string
  model?: { providerKey: string; modelId: string } | null
}

export async function generateCommitMessage(
  loadSdk: PiSdkLoader,
  context: CommitMessageContext
): Promise<{ message: string; provider: string; modelId: string }> {
  const providerKey = context.model?.providerKey
  const modelId = context.model?.modelId
  if (!providerKey || !modelId) {
    throw new RuntimeError(
      'INVALID_INPUT',
      'Select an active model before generating a commit message.'
    )
  }
  const sdk = await loadSdk()
  const agentDir = sdk.getAgentDir?.() ?? ''
  const services = await sdk.createAgentSessionServices({
    cwd: context.repositoryRoot,
    agentDir
  })
  const runtime = services.modelRuntime as {
    getModel: (provider: string, modelId: string) => { reasoning?: boolean } | undefined
    refresh?: (options?: { allowNetwork?: boolean }) => Promise<unknown>
    completeSimple?: (
      model: unknown,
      input: unknown,
      options: unknown
    ) => Promise<{ errorMessage?: string; content?: Array<{ type: string; text?: string }> }>
  }
  let model = runtime.getModel(providerKey, modelId)
  if (!model && runtime.refresh) {
    await runtime.refresh({ allowNetwork: false })
    model = runtime.getModel(providerKey, modelId)
  }
  if (!model) {
    throw new RuntimeError('MODEL_NOT_FOUND', `Model not found: ${providerKey}/${modelId}`)
  }
  if (typeof runtime.completeSimple !== 'function') {
    throw new RuntimeError('CAPABILITY_NOT_SUPPORTED', 'Pi SDK model services are unavailable.')
  }
  const reasoning = model.reasoning ? 'low' : undefined
  const response = await runtime.completeSimple(
    model,
    {
      systemPrompt: COMMIT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: commitUserPrompt(context),
          timestamp: Date.now()
        }
      ]
    },
    {
      maxTokens: reasoning ? 4_000 : 2_000,
      temperature: 0.2,
      timeoutMs: 60_000,
      maxRetries: 1,
      reasoning
    }
  )
  if (response.errorMessage) {
    throw new RuntimeError('AGENT_ERROR', response.errorMessage)
  }
  const message = extractCommitMessage(response.content ?? [])
  if (!message) {
    throw new RuntimeError(
      'AGENT_ERROR',
      'The model returned an empty commit message. Switch to another model and retry.'
    )
  }
  return { message, provider: providerKey, modelId }
}

const COMMIT_SYSTEM_PROMPT = [
  'Write a precise git commit message from the staged diff.',
  'Use Conventional Commits: type(scope): summary.',
  'Use imperative mood, no trailing period, and keep the subject within 72 characters.',
  'Return only the ready-to-use commit message as plain text.'
].join('\n\n')

function commitUserPrompt(context: CommitMessageContext): string {
  const parts: string[] = []
  if (context.draft) {
    parts.push(`Author draft:\n${context.draft}`)
  }
  if (context.recentMessages.length) {
    parts.push(`Recent commit messages:\n${context.recentMessages.join('\n---\n')}`)
  }
  parts.push(`Staged change:\n${context.summary}`)
  parts.push('Return only the final commit message.')
  return parts.join('\n\n')
}

export function extractCommitMessage(
  content: Array<{ type: string; text?: string }>
): string {
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('')
    .trim()
}
