import type { CapabilityDefinition } from './types'
import { capabilityDefinitionSchema } from './schema'

const catalogSource: readonly CapabilityDefinition[] = [
  {
    id: 'odai',
    type: 'skill',
    name: 'Odai',
    description: 'Agent Governance & Task Execution',
    source: 'github',
    sourceUrl: 'https://github.com/orziz/odai',
    featured: true,
    tags: ['planning', 'governance', 'task-execution'],
    useCases: [
      'large-project-refactoring',
      'multi-step-coding',
      'risk-sensitive-operations',
      'architecture-refactoring',
      'verified-delivery'
    ],
    capabilities: {
      planning: true,
      codeReview: true,
      debugging: true,
      filesystem: true,
      git: true,
      terminal: true,
      search: true
    },
    install: {
      strategy: 'skills-cli',
      selector: 'odai',
      target: 'pi-global'
    }
  }
]

export function normalizeCapabilityDefinition(input: CapabilityDefinition): CapabilityDefinition {
  const parsed = capabilityDefinitionSchema.parse(input)
  return {
    ...parsed,
    tags: parsed.tags
      ? [...new Set(parsed.tags.map((tag) => tag.trim().toLowerCase()))].sort()
      : undefined,
    useCases: parsed.useCases ? [...new Set(parsed.useCases)] : undefined,
    members: parsed.members ? [...new Set(parsed.members)] : undefined
  }
}

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = Object.freeze(
  catalogSource.map(normalizeCapabilityDefinition)
)

export function findTrustedCapability(id: string): CapabilityDefinition | null {
  return CAPABILITY_CATALOG.find((definition) => definition.id === id) ?? null
}
