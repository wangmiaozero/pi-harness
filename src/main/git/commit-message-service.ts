import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import { AgentError, ValidationError } from '../services/errors'
import type { PiConfigService } from '../pi/config-service'
import { loadPiCodingAgent } from '../agent/pi-sdk'

export interface CommitMessageContext {
  repositoryRoot: string
  summary: string
  recentMessages: string[]
  draft: string
  /** Use a specific model instead of the active one (the commit panel's picker). */
  model?: { providerKey: string; modelId: string } | null
}

export class GitCommitMessageService {
  constructor(private readonly config: PiConfigService) {}

  async generate(context: CommitMessageContext): Promise<{
    message: string
    provider: string
    modelId: string
  }> {
    const override = context.model ?? null
    const { providerKey, modelId } = override
      ? { providerKey: override.providerKey, modelId: override.modelId }
      : await this.config.getActiveModel()
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

    // Models that advertise reasoning but whose endpoint rejects
    // `thinking: {type:"disabled"}` (some OpenAI-compatible serving stacks)
    // fail without an explicit level, so always request one for reasoning
    // models — cheap for the task, and the text parts are filtered below.
    const reasoning = (model as { reasoning?: boolean }).reasoning ? 'low' : undefined
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
        // Reasoning and the answer share maxTokens on many OpenAI-compatible
        // endpoints; keep thinking cheap so the subject still fits.
        maxTokens: reasoning ? 4_000 : 2_000,
        temperature: 0.2,
        timeoutMs: 60_000,
        maxRetries: 1,
        reasoning,
        ...(reasoning ? { thinkingBudgets: { low: 256 } } : {})
      }
    )
    if (response.errorMessage) throw new AgentError(formatCommitGenerationError(response.errorMessage))
    const message = extractCommitMessage(response.content)
    if (!message) {
      throw new AgentError(
        'The model returned an empty commit message. Switch to another model and retry.'
      )
    }
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

/** Turn raw provider payloads (429 JSON, thinking rejection) into a short message. */
export function formatCommitGenerationError(raw: string): string {
  return inspectRuntimeError(raw).userMessage
}

const COMMIT_SUBJECT =
  /^(feat|fix|refactor|perf|docs|style|test|build|ci|chore|revert)(\([^)]+\))?!?:\s+\S+/i

export function extractCommitMessage(
  content: Array<{ type: string; text?: string; thinking?: string; redacted?: boolean }>
): string {
  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  const fromText = cleanCommitMessage(text)
  if (fromText) return fromText

  const thinking = content
    .filter(
      (part) =>
        part.type === 'thinking' && typeof part.thinking === 'string' && !part.redacted
    )
    .map((part) => part.thinking)
    .join('\n')
  return extractCommitMessageFromThinking(thinking)
}

export function extractCommitMessageFromThinking(value: string): string {
  const cleaned = cleanCommitMessage(value)
  if (!cleaned) return ''
  const lines = cleaned.split('\n')
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (COMMIT_SUBJECT.test(lines[index]?.trim() ?? '')) start = index
  }
  if (start >= 0) return lines.slice(start).join('\n').trim()
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const last = paragraphs[paragraphs.length - 1] ?? ''
  return last.length > 0 && last.length <= 400 ? last : ''
}

export function cleanCommitMessage(value: string): string {
  let text = value.trim()
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim()
  const boxed = text.match(/<(?:answer|output)>([\s\S]*?)<\/(?:answer|output)>/i)
  if (boxed?.[1]) text = boxed[1].trim()
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
