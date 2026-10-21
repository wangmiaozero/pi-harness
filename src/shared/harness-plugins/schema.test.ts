import { describe, expect, it } from 'vitest'
import { compatible, pluginManifestSchema, evaluatorResultSchema } from './schema'
import template from '../../../examples/harness-plugins/team-template/plugin.json'
import metrics from '../../../examples/harness-plugins/run-metrics/plugin.json'
import quality from '../../../examples/harness-plugins/quality-evaluator/plugin.json'

describe('Harness Plugin manifest contract', () => {
  it('accepts all official examples and defaults to no permissions or code', () => {
    for (const sample of [template, metrics, quality])
      expect(pluginManifestSchema.parse(sample).id).toBe(sample.id)
    expect(
      pluginManifestSchema.parse({
        id: 'org.test.empty',
        name: 'Empty',
        version: '1.0.0',
        apiVersion: '^1.0.0',
        author: 'Test',
        description: 'Data only'
      })
    ).toMatchObject({ entry: null, permissions: [] })
  })
  it.each([
    '../main.mjs',
    '/main.mjs',
    'file:///main.mjs',
    'folder/main.mjs',
    '..\\main.mjs',
    'main.js',
    'a\0.mjs',
    'con.mjs',
    'NUL.mjs'
  ])('rejects unsafe entry %s', (entry) => {
    expect(pluginManifestSchema.safeParse({ ...metrics, entry }).success).toBe(false)
  })
  it.each([
    '../../x',
    'Org.test',
    'org.test/child',
    'org.test\\x',
    '__proto__',
    'con.foo',
    'lpt1.test'
  ])('rejects unsafe id %s', (id) => {
    expect(pluginManifestSchema.safeParse({ ...metrics, id }).success).toBe(false)
  })
  it('strictly rejects unknown fields, undeclared permissions, code-free executors and invalid versions', () => {
    for (const patch of [
      { command: 'rm -rf x' },
      { permissions: ['shell'] },
      { permissions: [] },
      { entry: null },
      { version: 'latest' },
      { apiVersion: 'banana' }
    ])
      expect(pluginManifestSchema.safeParse({ ...metrics, ...patch }).success).toBe(false)
    expect(compatible({ ...metrics, apiVersion: '^2.0.0' })).toBe(false)
    expect(compatible(metrics)).toBe(true)
  })
  it('rejects duplicate contributions and duplicate requested permissions', () => {
    expect(
      pluginManifestSchema.safeParse({ ...metrics, permissions: ['events:read', 'events:read'] })
        .success
    ).toBe(false)
    expect(
      pluginManifestSchema.safeParse({
        ...quality,
        contributions: {
          evaluators: [...quality.contributions.evaluators, ...quality.contributions.evaluators]
        }
      }).success
    ).toBe(false)
  })
  it('validates agent references, DAG cycles, template versions, permissions and review agents', () => {
    for (const mutate of [
      (t: (typeof template.contributions.teams)[number]) => {
        t.tasks[0].dependencies = ['review']
      },
      (t: (typeof template.contributions.teams)[number]) => {
        t.tasks[0].dependencies = ['missing']
      },
      (t: (typeof template.contributions.teams)[number]) => {
        t.tasks[0].agent = 'missing'
      },
      (t: (typeof template.contributions.teams)[number]) => {
        t.version = '1'
      },
      (t: (typeof template.contributions.teams)[number]) => {
        t.agents.forEach((a) => (a.isReviewer = false))
      },
      (t: (typeof template.contributions.teams)[number]) => {
        t.agents.push(t.agents[0])
      }
    ]) {
      const m = structuredClone(template)
      mutate(m.contributions.teams[0])
      expect(pluginManifestSchema.safeParse(m).success).toBe(false)
    }
  })
  it('rejects out-of-range scores, unknown evaluator fields and non-JSON metadata', () => {
    const value = {
      evaluatorId: 'quality',
      version: '1.0.0',
      score: 100,
      status: 'passed',
      findings: [],
      metadata: {}
    }
    expect(evaluatorResultSchema.safeParse(value).success).toBe(true)
    for (const patch of [
      { score: 101 },
      { score: NaN },
      { overwriteRun: true },
      { metadata: { f: () => 0 } }
    ])
      expect(evaluatorResultSchema.safeParse({ ...value, ...patch }).success).toBe(false)
  })
})
