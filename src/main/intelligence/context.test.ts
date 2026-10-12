// @vitest-environment node
import { expect, it } from 'vitest'
import {
  architectureContextResultSchema,
  ARCHITECTURE_CONTEXT_CHAR_LIMIT,
  ARCHITECTURE_CONTEXT_BYTE_LIMIT
} from '@shared/intelligence/context-schema'
import { extractGraph } from './graph'
import { hash, type Scan } from './scanner'
import { retrieveArchitecture } from './context'

function fixture(count = 3) {
  const text = 'export const value=1'
  const scan: Scan = {
    files: Array.from({ length: count }, (_, i) => ({
      path: `module-${i}.ts`,
      text,
      hash: hash(text),
      lines: 1
    })),
    fingerprint: hash(text),
    languages: ['TypeScript'],
    frameworks: [],
    packageManagers: [],
    coverage: { files: count, skipped: 0, bytes: 20 * count, partial: false }
  }
  const graph = extractGraph('/project', scan)
  graph.edges = graph.nodes.slice(1).map((n, i) => ({
    id: `edge-${i}`,
    source: graph.nodes[0].id,
    target: n.id,
    relation: 'imports',
    evidence: 'static-verified' as const,
    sourceReferences: [graph.nodes[0].sourceReferences[0]]
  }))
  return graph
}
it('returns dependency direction, import evidence and complete relationship pagination', () => {
  const graph = fixture(5)
  const first = retrieveArchitecture(graph, 'stale', 'get_module_details', {
    moduleId: graph.nodes[0].id,
    direction: 'downstream',
    limit: 2
  })
  expect(first).toMatchObject({
    available: true,
    tool: 'get_module_details',
    pagination: 'relationships',
    staleness: 'stale',
    total: 4,
    nextOffset: 2,
    relationships: graph.edges.slice(0, 2)
  })
  const second = retrieveArchitecture(graph, 'fresh', 'get_module_details', {
    moduleId: graph.nodes[0].id,
    direction: 'downstream',
    offset: 2,
    limit: 2
  })
  expect(second).toMatchObject({ total: 4, nextOffset: null, relationships: graph.edges.slice(2) })
  const related = retrieveArchitecture(graph, 'fresh', 'get_related_modules', {
    moduleId: graph.nodes[1].id,
    direction: 'upstream'
  })
  expect(related).toMatchObject({
    pagination: 'modules',
    relationships: [graph.edges[0]],
    relationshipCount: 1,
    relationshipsTruncated: false
  })
  if (!related.available || related.tool !== 'get_related_modules')
    throw new Error('Unexpected result')
  expect(related.modules.map((n) => n.id)).toEqual([graph.nodes[0].id])
  expect(
    retrieveArchitecture(graph, 'fresh', 'get_related_modules', {
      moduleId: graph.nodes[1].id,
      direction: 'downstream'
    })
  ).toMatchObject({ total: 0, relationships: [] })
})
it('paginates source references and validates every response shape before returning data', () => {
  const graph = fixture()
  graph.nodes[0].sourceReferences = Array.from({ length: 5 }, (_, i) => ({
    ...graph.nodes[0].sourceReferences[0],
    path: `source-${i}.ts`
  }))
  const page = retrieveArchitecture(graph, 'unknown', 'get_module_sources', {
    moduleId: graph.nodes[0].id,
    offset: 2,
    limit: 2
  })
  expect(page).toMatchObject({
    pagination: 'sourceReferences',
    total: 5,
    nextOffset: 4,
    references: graph.nodes[0].sourceReferences.slice(2, 4)
  })
  const details = retrieveArchitecture(graph, 'unknown', 'get_module_details', {
    moduleId: graph.nodes[0].id
  })
  expect(details).toMatchObject({
    sourceReferenceCount: 5,
    module: { sourceReferences: graph.nodes[0].sourceReferences.slice(0, 3) }
  })
  expect(
    architectureContextResultSchema.safeParse({
      ...details,
      module: {
        ...graph.nodes[0],
        sourceReferences: [{ ...graph.nodes[0].sourceReferences[0], path: '../outside' }]
      }
    }).success
  ).toBe(false)
  graph.edges[0].sourceReferences[0] = { ...graph.edges[0].sourceReferences[0], hash: 'invalid' }
  expect(() =>
    retrieveArchitecture(graph, 'fresh', 'get_module_details', { moduleId: graph.nodes[0].id })
  ).toThrow()
  expect(() =>
    retrieveArchitecture(fixture(), 'fresh', 'search_project_modules', {
      workspaceId: '0'.repeat(32)
    })
  ).toThrow('current project')
})
it('keeps Unicode-rich relationship evidence within the whole-response budget and advances pages', () => {
  const graph = fixture(35)
  for (const node of graph.nodes) node.name = '模块'.repeat(240)
  for (const edge of graph.edges)
    edge.sourceReferences = Array.from({ length: 10 }, (_, i) => ({
      ...edge.sourceReferences[0],
      path: `${i}/${'引用'.repeat(240)}.ts`
    }))
  const first = retrieveArchitecture(graph, 'fresh', 'get_module_details', {
    moduleId: graph.nodes[0].id,
    limit: 30
  })
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(ARCHITECTURE_CONTEXT_CHAR_LIMIT)
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
    ARCHITECTURE_CONTEXT_BYTE_LIMIT
  )
  if (!first.available || first.tool !== 'get_module_details') throw new Error('Unexpected result')
  expect(first.relationships.length).toBeGreaterThan(0)
  expect(first.nextOffset).toBe(first.relationships.length)
  const ids = new Set<string>()
  let offset = 0
  do {
    const page = retrieveArchitecture(graph, 'fresh', 'get_module_details', {
      moduleId: graph.nodes[0].id,
      offset,
      limit: 30
    })
    if (!page.available || page.tool !== 'get_module_details') throw new Error('Unexpected result')
    page.relationships.forEach((e) => ids.add(e.id))
    offset = page.nextOffset ?? -1
  } while (offset >= 0)
  expect(ids.size).toBe(34)
  const related = retrieveArchitecture(graph, 'fresh', 'get_related_modules', {
    moduleId: graph.nodes[0].id,
    limit: 30
  })
  expect(related).toMatchObject({ relationshipsTruncated: true })
  expect(Buffer.byteLength(JSON.stringify(related))).toBeLessThanOrEqual(
    ARCHITECTURE_CONTEXT_BYTE_LIMIT
  )
})
