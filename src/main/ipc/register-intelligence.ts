import { dialog } from 'electron'
import fs from 'node:fs/promises'
import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  analysisRequestSchema,
  architectureMapRequestSchema,
  intelligenceRequestSchema,
  moduleQuerySchema,
  relativeSourceSchema
} from '@shared/intelligence/schema'
import type { IpcHandleRegistrar } from './trusted-ipc'
import type { ProjectIntelligenceService } from '../intelligence/service'
import { atomicWriteText } from '../services/storage'
import { ValidationError } from '../services/errors'
import { ArchitectureViewer, viewerInputSchema } from '../intelligence/viewer'

export function registerIntelligenceIpc(
  ipc: IpcHandleRegistrar,
  wrapRequest: <T>(fn: () => Promise<T>) => Promise<unknown>,
  service: ProjectIntelligenceService,
  viewer: ArchitectureViewer
): void {
  const wrap = <T>(fn: () => Promise<T>): Promise<unknown> => wrapRequest(async () => fn())
  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input)
    if (!result.success) throw new ValidationError('Invalid architecture request.')
    return result.data
  }
  const rootSchema = z.object({ root: z.string().min(1).max(4096) }).strict()
  ipc.handle(IPC_INVOKE.intelligenceViewer, (_e, input) =>
    wrap(() => viewer.show(parse(viewerInputSchema, input)))
  )
  ipc.handle(IPC_INVOKE.intelligenceAnalyze, (_e, input) =>
    wrap(() => service.analyze(parse(analysisRequestSchema, input)))
  )
  ipc.handle(IPC_INVOKE.intelligenceMap, (_e, input) =>
    wrap(() => service.map(parse(architectureMapRequestSchema, input)))
  )
  for (const [channel, action] of [
    [IPC_INVOKE.intelligenceStatus, 'status'],
    [IPC_INVOKE.intelligenceCancel, 'cancel'],
    [IPC_INVOKE.intelligenceHistory, 'history'],
    [IPC_INVOKE.intelligenceClear, 'clear']
  ] as const)
    ipc.handle(channel, (_e, input) =>
      wrap<unknown>(async () => service[action](parse(rootSchema, input).root))
    )
  ipc.handle(IPC_INVOKE.intelligenceSnapshot, (_e, input) =>
    wrap(() => {
      const r = parse(intelligenceRequestSchema, input)
      return service.snapshot(r.root, r.snapshotId)
    })
  )
  ipc.handle(IPC_INVOKE.intelligenceQuery, (_e, input) =>
    wrap(() => {
      const r = parse(rootSchema.extend({ query: moduleQuerySchema }), input)
      return service.query(
        r.root,
        r.query.moduleId ? 'get_module_details' : 'search_project_modules',
        r.query
      )
    })
  )
  ipc.handle(IPC_INVOKE.intelligenceSource, (_e, input) =>
    wrap(() => {
      const r = parse(
        rootSchema.extend({
          snapshotId: z.string().uuid(),
          moduleId: z.string().max(100),
          path: relativeSourceSchema
        }),
        input
      )
      return service.source(r.root, r.snapshotId, r.moduleId, r.path)
    })
  )
  ipc.handle(IPC_INVOKE.intelligenceExport, (_e, input) =>
    wrap(async () => {
      const r = parse(
        rootSchema.extend({
          snapshotId: z.string().uuid(),
          format: z.enum(['html', 'json', 'png']),
          viewerUrl: viewerInputSchema.shape.url.unwrap().optional()
        }),
        input
      )
      if (r.viewerUrl) await service.viewArtifact(r.root, r.snapshotId, r.viewerUrl)
      const artifact =
        r.format === 'png'
          ? await viewer.capture(
              r.viewerUrl ?? (await service.snapshot(r.root, r.snapshotId))?.viewerUrl ?? ''
            )
          : r.format === 'html' && r.viewerUrl
            ? await service.viewArtifact(r.root, r.snapshotId, r.viewerUrl)
            : await service.artifact(r.root, r.snapshotId, r.format)
      const result = await dialog.showSaveDialog({
        defaultPath: `architecture.${r.format}`,
        filters: [{ name: r.format.toUpperCase(), extensions: [r.format] }]
      })
      if (result.canceled || !result.filePath) return false
      if (typeof artifact === 'string') await atomicWriteText(result.filePath, artifact)
      else await fs.writeFile(result.filePath, artifact)
      return true
    })
  )
}
