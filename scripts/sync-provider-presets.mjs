#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback
}

const agentDeskRoot = readArg('--agentdesk', path.resolve(projectRoot, '../AgentDesk'))
const wangmiaoGitRoot = readArg('--wangmiaogit', path.resolve(projectRoot, '../WangmiaoGit-p'))
const check = process.argv.includes('--check')
const outputPath = path.join(projectRoot, 'src/shared/constants/provider-presets.generated.json')

const protocolByAdapter = {
  openai: 'openai-completions',
  anthropic: 'anthropic-messages',
  gemini: 'google-generative-ai'
}

const protocolByAgentDeskType = {
  openai: 'openai-completions',
  'openai-compatible': 'openai-completions',
  ollama: 'openai-completions',
  anthropic: 'anthropic-messages',
  gemini: 'google-generative-ai',
  custom: 'openai-completions'
}

function apiKeyPlaceholder(id, protocol, baseUrl) {
  if (/ollama|lm-studio/i.test(id) || /localhost|127\.0\.0\.1/i.test(baseUrl)) return 'local'
  if (/nvidia/i.test(id)) return 'nvapi-...'
  if (/github/i.test(id)) return 'github_pat_...'
  if (protocol === 'anthropic-messages') return 'sk-ant-...'
  if (protocol === 'google-generative-ai') return 'AIza...'
  return 'sk-...'
}

function canonicalBaseUrl(value, protocol) {
  let normalized = value.trim().replace(/\/+$/, '').toLowerCase()
  if (protocol === 'google-generative-ai') normalized = normalized.replace(/\/openai$/, '')
  normalized = normalized.replace(/\/v1$/, '')
  return normalized.replace('127.0.0.1', 'localhost')
}

function normalizeModel(model) {
  const normalized = {
    id: String(model.id).trim(),
    name: String(model.name || model.id).trim()
  }
  if (Number.isSafeInteger(model.contextWindow) && model.contextWindow > 0) {
    normalized.contextWindow = model.contextWindow
  }
  if (Number.isSafeInteger(model.maxOutputTokens) && model.maxOutputTokens > 0) {
    normalized.maxOutputTokens = model.maxOutputTokens
  }
  return normalized
}

/** Pi's model picker is for conversational text/code models, not media or utility APIs. */
function isPiChatModel(model) {
  const value = `${model.id} ${model.name || ''}`.toLowerCase()
  return !/(^|[-_.:/\s])(embedding|embeddings|embed|rerank|moderation|tts|speech|transcri(?:be|ption)|asr|audio|realtime|image|imagen|dall-e|whisper|video|music|ocr)([-_.:/\s]|$)/i.test(
    value
  )
}

function readWangmiaoGitCatalog() {
  const catalogPath = path.join(wangmiaoGitRoot, 'Sources/WangmiaoGit/Resources/providers.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  return {
    updatedAt: catalog.updatedAt || '',
    providers: catalog.providers.map((provider) => {
      const protocol = protocolByAdapter[provider.adapter] || 'openai-completions'
      const models = provider.models.filter(isPiChatModel).map((model) =>
        normalizeModel({
          id: model.id,
          name: model.name,
          contextWindow: model.ctx,
          maxOutputTokens: model.out
        })
      )
      const defaultModelId = models.some((model) => model.id === provider.defaultModelId)
        ? provider.defaultModelId
        : models[0]?.id || ''
      return {
        id: provider.id,
        name: provider.name,
        protocol,
        defaultBaseUrl: provider.baseUrl,
        placeholderApiKey: apiKeyPlaceholder(provider.id, protocol, provider.baseUrl),
        authHeader: provider.auth?.header === 'Authorization',
        defaultModelId,
        documentation: 'Provider and model catalog imported from WangmiaoGit-p.',
        sources: ['WangmiaoGit-p'],
        rank: Number.POSITIVE_INFINITY,
        models
      }
    })
  }
}

function readAgentDeskCatalog() {
  const sourcePath = path.join(agentDeskRoot, 'src/shared/types/role.ts')
  const source = fs.readFileSync(sourcePath, 'utf8')
  const start = source.indexOf('export const MODEL_PROVIDER_PRESETS')
  const end = source.indexOf('\n];', start)
  if (start < 0 || end < 0) throw new Error('AgentDesk MODEL_PROVIDER_PRESETS not found')
  const block = source.slice(start, end)
  const entryPattern =
    /\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*region:\s*'([^']+)'\s*,\s*providerType:\s*'([^']+)'\s*,\s*baseUrl:\s*'([^']*)'\s*,\s*models:\s*\[([\s\S]*?)\]\s*,?\s*\}/g
  const providers = []
  let match
  while ((match = entryPattern.exec(block))) {
    const [, id, name, , providerType, baseUrl, modelSource] = match
    const protocol = protocolByAgentDeskType[providerType]
    if (!protocol) continue
    const models = [...modelSource.matchAll(/'([^']+)'/g)]
      .map((item) => normalizeModel({ id: item[1], name: item[1] }))
      .filter(isPiChatModel)
    providers.push({
      id,
      name,
      protocol,
      defaultBaseUrl: baseUrl,
      placeholderApiKey: apiKeyPlaceholder(id, protocol, baseUrl),
      authHeader: protocol === 'openai-completions',
      defaultModelId: models[0]?.id || '',
      documentation: 'Provider and model presets imported from AgentDesk.',
      sources: ['AgentDesk'],
      rank: providers.length,
      models
    })
  }
  if (providers.length === 0) throw new Error('AgentDesk provider presets could not be parsed')
  return providers
}

function mergeModels(current, incoming) {
  const byId = new Map(current.map((model) => [model.id, model]))
  for (const model of incoming) {
    const existing = byId.get(model.id)
    byId.set(model.id, existing ? { ...model, ...existing } : model)
  }
  return [...byId.values()]
}

function mergeCatalogs(primary, secondary) {
  const merged = [...primary]
  for (const incoming of secondary) {
    const baseKey = canonicalBaseUrl(incoming.defaultBaseUrl, incoming.protocol)
    const existing = merged.find(
      (provider) =>
        provider.protocol === incoming.protocol &&
        (provider.id === incoming.id ||
          canonicalBaseUrl(provider.defaultBaseUrl, provider.protocol) === baseKey)
    )
    if (!existing) {
      merged.push(incoming)
      continue
    }
    existing.models = mergeModels(existing.models, incoming.models)
    existing.rank = Math.min(existing.rank, incoming.rank)
    existing.sources = [...new Set([...existing.sources, ...incoming.sources])]
    if (!existing.defaultModelId) existing.defaultModelId = incoming.defaultModelId
  }

  merged.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'en'))
  const usedIds = new Set()
  for (const provider of merged) {
    if (!usedIds.has(provider.id)) {
      usedIds.add(provider.id)
      continue
    }
    const suffix = provider.protocol === 'anthropic-messages' ? 'anthropic' : 'compatible'
    let nextId = `${provider.id}-${suffix}`
    let counter = 2
    while (usedIds.has(nextId)) nextId = `${provider.id}-${suffix}-${counter++}`
    provider.id = nextId
    usedIds.add(nextId)
  }
  return merged
}

const wangmiaoGit = readWangmiaoGitCatalog()
const providers = mergeCatalogs(wangmiaoGit.providers, readAgentDeskCatalog()).map(
  ({ rank: _rank, ...provider }) => ({
    ...provider,
    documentation: `${provider.documentation} Sources: ${provider.sources.join(', ')}.`
  })
)
const output = {
  updatedAt: wangmiaoGit.updatedAt,
  providers
}
const text = await format(JSON.stringify(output), { parser: 'json' })

if (check) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
  if (current !== text) {
    console.error('Provider preset catalog is stale. Run: pnpm sync:provider-presets')
    process.exit(1)
  }
  process.stdout.write(`Provider preset catalog is current: ${providers.length} providers\n`)
} else {
  fs.writeFileSync(outputPath, text)
  const modelCount = providers.reduce((total, provider) => total + provider.models.length, 0)
  process.stdout.write(`Wrote ${outputPath}: ${providers.length} providers, ${modelCount} models\n`)
}
