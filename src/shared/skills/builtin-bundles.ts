import type { BuiltinSkillMarketCollection, BuiltinSkillRole } from '../ipc/api-types'

interface BuiltinSkillBundle {
  id: string
  role: BuiltinSkillRole
  name: string
  members: { collectionId: string; skillId: string }[]
}

const matt = (...ids: string[]) =>
  ids.map((skillId) => ({ collectionId: 'builtin:mattpocock-skills', skillId }))
const emil = (...ids: string[]) =>
  ids.map((skillId) => ({ collectionId: 'builtin:emilkowalski-skills', skillId }))

/** Curated views of canonical skills; bundles never create another installed copy. */
export const BUILTIN_SKILL_BUNDLES: readonly BuiltinSkillBundle[] = [
  {
    id: 'builtin:ui-designer',
    role: 'uiDesigner',
    name: 'UI Designer Skill Suite',
    members: emil(
      'emil-design-eng',
      'apple-design',
      'prototype',
      'animation-vocabulary',
      'review-animations',
      'pick-ui-library'
    )
  },
  {
    id: 'builtin:frontend-engineer',
    role: 'frontendEngineer',
    name: 'Frontend Engineer Skill Suite',
    members: [
      ...emil('emil-design-eng', 'animate', 'pick-ui-library', 'ask-sonner'),
      ...matt('tdd', 'diagnosing-bugs', 'code-review')
    ]
  },
  {
    id: 'builtin:backend-engineer',
    role: 'backendEngineer',
    name: 'Backend Engineer Skill Suite',
    members: matt(
      'domain-modeling',
      'to-spec',
      'codebase-design',
      'tdd',
      'diagnosing-bugs',
      'code-review',
      'improve-codebase-architecture'
    )
  },
  {
    id: 'builtin:product-engineer',
    role: 'productEngineer',
    name: 'Product Engineer Skill Suite',
    members: [
      ...matt('research', 'grill-me', 'to-spec', 'to-tickets', 'triage'),
      ...emil('prototype')
    ]
  }
]

export function findBuiltinSkillBundle(id: string): BuiltinSkillBundle | undefined {
  return BUILTIN_SKILL_BUNDLES.find((bundle) => bundle.id === id)
}

export function buildBuiltinSkillBundles(
  collections: BuiltinSkillMarketCollection[]
): BuiltinSkillMarketCollection[] {
  if (!collections.length) return []
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  return BUILTIN_SKILL_BUNDLES.map((bundle) => {
    const sources = [...new Set(bundle.members.map((member) => member.collectionId))].map((id) =>
      byId.get(id)
    )
    const skills = bundle.members.map((member) => {
      const skill = byId
        .get(member.collectionId)
        ?.skills.find((skill) => skill.id === member.skillId)
      if (!skill) throw new Error(`Missing bundled Skill: ${member.collectionId}/${member.skillId}`)
      return skill
    })
    return {
      id: bundle.id,
      kind: 'builtin-skills',
      role: bundle.role,
      name: bundle.name,
      displayName: bundle.name,
      author: sources.map((source) => source!.author).join(' · '),
      repository: sources.map((source) => source!.repository).join(' · '),
      license: [...new Set(sources.map((source) => source!.license))].join(' · '),
      commit: '',
      source: 'builtin',
      skills
    }
  })
}
