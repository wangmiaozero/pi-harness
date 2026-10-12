import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ARCHITECTURE_TOOL_NAMES } from './context'
import type { ProjectIntelligenceService } from './service'

export function architectureTools(
  service: ProjectIntelligenceService,
  currentRoot: string | (() => string | null)
): ToolDefinition[] {
  return ARCHITECTURE_TOOL_NAMES.map((name) => ({
    name,
    label: name,
    description: `Read ${name.replaceAll('_', ' ')} from the current project's source-backed architecture snapshot. Bounded results; stale/inferred data is labeled. offset/limit page modules for search/related, relationships (with full source evidence) for module details, and references for module sources. Follow nextOffset; related relationships may be truncated, so use get_module_details for all evidence. Read actual current code before changes.`,
    promptSnippet: 'Retrieve project modules, relationships and source references on demand.',
    parameters: Type.Object(
      {
        workspaceId: Type.Optional(Type.String({ maxLength: 32 })),
        query: Type.Optional(Type.String({ maxLength: 200 })),
        moduleId: Type.Optional(Type.String({ maxLength: 100 })),
        direction: Type.Optional(
          Type.Union([Type.Literal('upstream'), Type.Literal('downstream'), Type.Literal('both')])
        ),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1200 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 }))
      },
      { additionalProperties: false }
    ),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const root = typeof currentRoot === 'function' ? currentRoot() : currentRoot
      if (!root) throw new Error('No project is attached to this session.')
      const result = await service.query(root, name, params)
      signal?.throwIfAborted()
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} }
    }
  }))
}
