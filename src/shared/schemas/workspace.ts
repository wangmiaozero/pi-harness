/**
 * Zod schemas for Agent Workspace IPC. Renderer is untrusted.
 */

import { z } from 'zod'
import { TOOL_PRESET_VALUES } from '../workspace/tool-presets'
import { PI_THINKING_LEVELS } from '../constants/index'
import {
  isBase64ImageWithinLimits,
  MAX_ATTACHED_IMAGE_BASE64_LENGTH,
  MAX_ATTACHED_IMAGES
} from '../workspace/image-attachments'
import { TEXT_EDIT_MAX_BYTES } from '../workspace/file-types'

export const sessionIdSchema = z.string().min(1).max(128)

export const workspacePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes('\0'), 'no null bytes')

export const cwdSchema = workspacePathSchema

export const thinkingLevelSchema = z.enum(PI_THINKING_LEVELS)

export const toolPresetSchema = z.enum(TOOL_PRESET_VALUES)

export const toolNamesSchema = z.array(z.string().min(1).max(128)).max(256)

export const agentImageSchema = z.object({
  type: z.literal('image'),
  data: z
    .string()
    .min(1)
    .max(MAX_ATTACHED_IMAGE_BASE64_LENGTH)
    .refine((data) => isBase64ImageWithinLimits({ data, mimeType: 'image/unknown' }), {
      message: 'invalid or oversized base64 image'
    }),
  mimeType: z.string().min(1).max(128).startsWith('image/')
})

export const startAgentSessionSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  cwd: cwdSchema.optional(),
  message: z.string().max(200_000).optional(),
  toolNames: toolNamesSchema.optional(),
  provider: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(256).optional(),
  thinkingLevel: thinkingLevelSchema.optional()
})

export const promptAgentSchema = z
  .object({
    sessionId: sessionIdSchema,
    message: z.string().max(200_000),
    images: z.array(agentImageSchema).max(MAX_ATTACHED_IMAGES).optional(),
    streamingBehavior: z.enum(['steer', 'followUp']).optional()
  })
  .refine((input) => input.message.trim().length > 0 || Boolean(input.images?.length), {
    message: 'message or image is required'
  })

export const agentCommandSchema = z.looseObject({
  sessionId: sessionIdSchema,
  type: z.string().min(1).max(64)
})

export const sessionRenameSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1).max(256)
})

export const sessionExportSchema = z.object({
  sessionId: sessionIdSchema,
  format: z.enum(['html', 'markdown'])
})

export const projectExportSchema = z.object({
  name: z.string().trim().min(1).max(256),
  sessionIds: z.array(sessionIdSchema).min(1).max(10000),
  format: z.enum(['html', 'markdown'])
})

export const sessionContextSchema = z.object({
  sessionId: sessionIdSchema,
  leafId: z.string().min(1).max(128).nullable().optional()
})

export const fileListSchema = z.object({
  directory: workspacePathSchema
})

export const fileReadSchema = z.object({
  path: workspacePathSchema
})

export const fileWriteSchema = z.object({
  path: workspacePathSchema,
  text: z.string().max(TEXT_EDIT_MAX_BYTES),
  expectedRevision: z.string().length(64),
  overwrite: z.boolean().optional()
})

export const fileUploadSchema = z.object({
  directory: workspacePathSchema,
  fileName: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (name) =>
        name !== '.' &&
        name !== '..' &&
        !name.includes('/') &&
        !name.includes('\\') &&
        !name.includes('\0'),
      'invalid name'
    ),
  dataBase64: z.string().max(35_000_000),
  overwrite: z.boolean().optional()
})

export const gitStatusSchema = z.object({
  cwd: cwdSchema
})

export const gitStatusManySchema = z.object({
  cwds: z.array(cwdSchema).max(64)
})

export const gitDiffSchema = z.object({
  cwd: cwdSchema,
  filePath: workspacePathSchema
})

export const worktreeListSchema = z.object({
  cwd: cwdSchema
})

export const worktreeCreateSchema = z.object({
  cwd: cwdSchema,
  branch: z
    .string()
    .min(1)
    .max(256)
    .refine((s) => !s.includes('\0'), 'no null bytes')
})

export const worktreeRemoveSchema = z.object({
  cwd: cwdSchema,
  worktreePath: workspacePathSchema,
  force: z.boolean().optional()
})

export const allowRootSchema = z.object({
  root: workspacePathSchema
})

export const sessionContextMenuSchema = z.object({
  sessionId: sessionIdSchema,
  isWorktree: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  locale: z.enum(['zh-CN', 'en-US']).optional()
})

export const projectContextMenuSchema = z.object({
  projectKey: z.string().min(1).max(4096),
  projectRoot: workspacePathSchema,
  isPinned: z.boolean().optional(),
  locale: z.enum(['zh-CN', 'en-US']).optional()
})

export const sessionFolderContextMenuSchema = z.object({
  locale: z.enum(['zh-CN', 'en-US']).optional()
})

export const workspaceFolderRoleSchema = z.enum(['main', 'reference', 'dependency', 'docs'])

export const workspaceFolderInputSchema = z.object({
  path: workspacePathSchema,
  resolvedPath: workspacePathSchema.optional(),
  name: z.string().min(1).max(256).optional(),
  role: workspaceFolderRoleSchema.optional(),
  readonly: z.boolean().optional()
})

export const workspaceSyncSchema = z.object({
  workspaceFile: workspacePathSchema.nullable().optional(),
  folders: z.array(workspaceFolderInputSchema).max(64),
  settings: z.record(z.string(), z.unknown()).optional()
})

export const workspaceOpenFileSchema = z.object({
  path: workspacePathSchema
})

export const workspaceSaveSchema = z.object({
  path: workspacePathSchema.optional(),
  folders: z.array(workspaceFolderInputSchema).max(64),
  settings: z.record(z.string(), z.unknown()).optional(),
  workspaceFile: workspacePathSchema.nullable().optional()
})

export const workspaceSearchSchema = z.object({
  query: z.string().min(1).max(512),
  scope: z.enum(['workspace', 'main', 'folder']).default('workspace'),
  folderId: z.string().min(1).max(4096).optional()
})

export const workspaceOpenTerminalSchema = z.object({
  directory: workspacePathSchema
})

export const workspaceRelocateFolderSchema = z.object({
  folderId: z.string().min(1).max(4096),
  path: workspacePathSchema
})

export const workspaceBindSessionSchema = z.object({
  sessionId: sessionIdSchema,
  workspaceId: z.string().min(1).max(4096),
  mainFolderId: z.string().min(1).max(4096).optional(),
  folders: z
    .array(
      z.object({
        id: z.string().min(1).max(4096),
        path: workspacePathSchema,
        role: workspaceFolderRoleSchema,
        readonly: z.boolean().optional()
      })
    )
    .min(1)
    .max(64)
})

export const workspaceSessionIdSchema = z.object({
  sessionId: sessionIdSchema
})
