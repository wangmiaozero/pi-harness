import { AgentError, ValidationError } from '../services/errors'
import type { PiConfigService } from '../pi/config-service'
import { loadPiCodingAgent } from '../agent/pi-sdk'

export interface CommitMessageContext {
  repositoryRoot: string
  summary: string
  recentMessages: string[]
  draft: string
}

export class GitCommitMessageService {
  constructor(private readonly config: PiConfigService) {}

  async generate(context: CommitMessageContext): Promise<{
    message: string
    provider: string
    modelId: string
  }> {
    const { providerKey, modelId } = await this.config.getActiveModel()
    if (!providerKey || !modelId) {
      throw new ValidationError('Select an active model before generating a commit message.')
    }

    const sdk = await loadPiCodingAgent()
    if (!sdk.createAgentSessionServices) {
      throw new AgentError('Pi SDK model services are unavailable.')
    }
    const agentDir = sdk.getAgentDir?.() ?? ''
    const settingsManager = sdk.SettingsManager?.create(context.repositoryRoot, agentDir)
    const services = await sdk.createAgentSessionServices({
      cwd: context.repositoryRoot,
      agentDir,
      ...(settingsManager ? { settingsManager } : {})
    })
    let model = services.modelRuntime.getModel(providerKey, modelId)
    if (!model) {
      await services.modelRuntime.refresh({ allowNetwork: false })
      model = services.modelRuntime.getModel(providerKey, modelId)
    }
    if (!model) throw new AgentError(`Model not found: ${providerKey}/${modelId}`)

    const response = await services.modelRuntime.completeSimple(
      model,
      {
        systemPrompt: commitSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: commitUserPrompt(context),
            timestamp: Date.now()
          }
        ]
      },
      {
        maxTokens: 1_200,
        temperature: 0.2,
        timeoutMs: 60_000,
        maxRetries: 1
      }
    )
    if (response.errorMessage) throw new AgentError(response.errorMessage)
    const text = response.content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
    const message = cleanCommitMessage(text)
    if (!message) throw new AgentError('The model returned an empty commit message.')
    return { message, provider: providerKey, modelId }
  }
}

export function commitSystemPrompt(): string {
  return [
    'Write a precise git commit message from the staged diff.',
    'Use Conventional Commits: type(scope): summary. Allowed types: feat, fix, refactor, perf, docs, style, test, build, ci, chore, revert.',
    'Use imperative mood, no trailing period, and keep the subject within 72 characters.',
    'Add a body only when it explains reviewer-relevant behavior or constraints that are supported by the diff.',
    'Match the natural language and level of detail used by recent repository commits. If unclear, use Simplified Chinese.',
    'Never invent tests, issue numbers, co-authors, motivation, or behavior that the diff does not support.',
    'Return only the ready-to-use commit message as plain text. Do not use Markdown fences, quotes, labels, XML tags, analysis, or reasoning.'
  ].join('\n\n')
}

export function commitUserPrompt(context: CommitMessageContext): string {
  const parts: string[] = []
  if (context.draft) {
    parts.push(`Author draft (preserve supported intent, rewrite as needed):\n${context.draft}`)
  }
  if (context.recentMessages.length) {
    parts.push(
      `Recent commit messages (match their language and tone):\n${context.recentMessages
        .map((message) => `---\n${message}`)
        .join('\n')}`
    )
  }
  parts.push(`Staged change:\n${context.summary}`)
  parts.push('Return only the final commit message.')
  return parts.join('\n\n')
}

export function cleanCommitMessage(value: string): string {
  let text = value.trim()
  text = text
    .replace(/^```(?:text|gitcommit)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  text = text
    .replace(/<\/?(?:commit_message|commit-message|commit|提交信息|提交消息)>/gi, '')
    .trim()
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith('“') && text.endsWith('”')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim()
  }
  return text
}
