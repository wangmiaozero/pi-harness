import { describe, expect, it } from 'vitest'
import {
  findActiveSkillMention,
  parseSkillInvocation,
  replaceSkillMention,
  resolveSkillMention
} from './skill-invocation'

describe('skill invocation helpers', () => {
  it('finds and replaces the mention at the caret', () => {
    const mention = findActiveSkillMention('review with @apple-de', 21)
    expect(mention).toEqual({ start: 12, end: 21, query: 'apple-de' })
    expect(replaceSkillMention('review with @apple-de', mention!, 'apple-design')).toEqual({
      text: 'review with @apple-design ',
      cursor: 26
    })
  })

  it('does not treat email addresses as skill mentions', () => {
    expect(findActiveSkillMention('dev@example', 11)).toBeNull()
  })

  it('moves a selected mention into Pi native skill command form', () => {
    expect(resolveSkillMention('review this @apple-design carefully', ['apple-design'])).toEqual({
      name: 'apple-design',
      prompt: 'review this carefully',
      runtimeText: '/skill:apple-design review this carefully'
    })
    expect(resolveSkillMention('@short then @much-longer', ['much-longer', 'short'])?.name).toBe(
      'short'
    )
  })

  it('parses native and expanded skill messages for compact rendering', () => {
    expect(parseSkillInvocation('/skill:apple-design review this')).toEqual({
      name: 'apple-design',
      prompt: 'review this'
    })
    expect(
      parseSkillInvocation(
        '<skill name="apple-design" location="/skills/apple-design/SKILL.md">\n' +
          'References are relative to /skills/apple-design.\n\n# Instructions\n</skill>\n\nreview this'
      )
    ).toEqual({ name: 'apple-design', prompt: 'review this' })
  })
})
