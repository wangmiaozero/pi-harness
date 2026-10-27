import type { CapabilityDefinition } from './types'
import { capabilityDefinitionSchema } from './schema'

const catalogSource: readonly CapabilityDefinition[] = [
  {
    id: 'native-pi',
    type: 'preset',
    name: 'Native Pi',
    description: 'Pi Coding Agent built-in runtime and default workflow',
    source: 'builtin',
    builtin: true,
    featured: true,
    recommended: false,
    optional: false,
    category: 'native',
    integration: 'native-pi',
    order: 0,
    tags: ['builtin', 'pi', 'runtime'],
    useCases: ['native-runtime', 'default-workflow']
  },
  {
    id: 'superpowers',
    type: 'package',
    name: 'Superpowers',
    description: 'Complete software development methodology for coding agents',
    version: '6.3.0',
    source: 'github',
    sourceUrl: 'https://github.com/obra/superpowers',
    featured: true,
    recommended: true,
    optional: true,
    category: 'development-methodology',
    integration: 'pi-package',
    order: 10,
    tags: ['methodology', 'tdd', 'debugging', 'worktrees', 'code-review'],
    useCases: [
      'brainstorming',
      'planning',
      'test-driven-development',
      'systematic-debugging',
      'git-worktrees',
      'subagent-workflow',
      'parallel-agent-workflow',
      'code-review',
      'verification'
    ],
    capabilities: {
      brainstorming: true,
      planning: true,
      tdd: true,
      codeReview: true,
      debugging: true,
      systematicDebugging: true,
      worktrees: true,
      subagentWorkflow: true,
      parallelAgentWorkflow: true,
      verification: true,
      filesystem: true,
      git: true,
      terminal: true,
      search: true
    },
    install: {
      strategy: 'pi-package',
      source: 'git:github.com/obra/superpowers',
      target: 'pi-global'
    }
  },
  {
    id: 'ecc',
    type: 'package',
    name: 'Everything Claude Code',
    description:
      'Curated engineering capability pack: skills, prompt commands, session hooks, and portable engineering rules, delivered through the official ECC Pi adapter',
    version: '2.2.3',
    source: 'github',
    sourceUrl: 'https://github.com/affaan-m/ECC',
    featured: true,
    recommended: false,
    optional: true,
    category: 'development-methodology',
    integration: 'pi-package',
    order: 15,
    tags: ['engineering', 'hooks', 'rules', 'skills', 'testing'],
    useCases: [
      'test-driven-development',
      'code-review',
      'verification',
      'planning',
      'systematic-debugging'
    ],
    capabilities: {
      planning: true,
      tdd: true,
      codeReview: true,
      debugging: true,
      verification: true,
      filesystem: true,
      git: true,
      terminal: true
    },
    modules: [
      { id: 'skills', status: 'supported' },
      { id: 'commands', status: 'supported' },
      { id: 'rules', status: 'partial' },
      { id: 'hooks', status: 'partial' },
      { id: 'continuous-learning', status: 'unsupported' },
      { id: 'memory-vault', status: 'unsupported' },
      { id: 'agent-shield', status: 'unsupported' }
    ],
    install: {
      strategy: 'pi-package',
      source: 'git:github.com/affaan-m/ECC',
      target: 'pi-global'
    }
  },
  {
    id: 'odai',
    type: 'skill',
    name: 'Odai',
    description: 'Governance & Adaptive Execution',
    source: 'github',
    sourceUrl: 'https://github.com/orziz/odai',
    featured: true,
    recommended: false,
    optional: true,
    category: 'governance-methodology',
    integration: 'pi-skill',
    order: 20,
    tags: ['governance', 'risk-awareness', 'adaptive-execution'],
    useCases: [
      'goal-alignment',
      'authorization-boundaries',
      'risk-awareness',
      'capability-routing',
      'evidence',
      'verification',
      'adaptive-execution'
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
    members: parsed.members ? [...new Set(parsed.members)] : undefined,
    modules: parsed.modules
      ? [...new Map(parsed.modules.map((module) => [module.id, module])).values()]
      : undefined
  }
}

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = Object.freeze(
  catalogSource.map(normalizeCapabilityDefinition)
)

export function findTrustedCapability(id: string): CapabilityDefinition | null {
  return CAPABILITY_CATALOG.find((definition) => definition.id === id) ?? null
}
