import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown } from './skill-parser'

describe('skill parser', () => {
  it('parses normalized frontmatter metadata without requiring a YAML runtime', () => {
    expect(
      parseSkillMarkdown(`---
name: odai
description: "Agent Governance & Task Execution"
version: 1.2.3
tags: [Planning, governance, planning]
---

# Odai
`)
    ).toEqual({
      name: 'odai',
      description: 'Agent Governance & Task Execution',
      version: '1.2.3',
      tags: ['governance', 'planning']
    })
  })

  it('falls back to directory name and first body paragraph', () => {
    expect(parseSkillMarkdown('# Title\n\nUseful body.', 'fallback')).toMatchObject({
      name: 'fallback',
      description: 'Useful body.'
    })
  })
})
