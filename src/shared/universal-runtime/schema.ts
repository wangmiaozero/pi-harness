import { z } from 'zod'

/**
 * IPC validation schemas for the Universal Runtime surface. Channel payloads
 * are always validated in main before any runtime is contacted.
 */

export const runtimeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid runtime id')

export const compositeSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((v) => !/[\\/]/.test(v) && !v.includes('..'), 'Invalid session id')

const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((p) => !/[\0\r\n]/.test(p))

const runtimeModelSchema = z
  .object({
    provider: z.string().trim().max(128).optional(),
    modelId: z.string().trim().max(256).optional()
  })
  .strict()
  .nullish()

export const runtimeHealthCheckSchema = z
  .object({ runtimeId: runtimeIdSchema })
  .strict()
  .optional()

export const runtimeEnableSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    enabled: z.boolean()
  })
  .strict()

export const universalSessionCreateSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    cwd: absolutePathSchema,
    message: z.string().max(200_000).optional(),
    model: runtimeModelSchema,
    resumeSessionId: z.string().trim().min(1).max(512).optional()
  })
  .strict()

export const universalSessionPromptSchema = z
  .object({
    sessionId: compositeSessionIdSchema,
    message: z.string().min(1).max(200_000)
  })
  .strict()

export const universalSessionCancelSchema = z
  .object({ sessionId: compositeSessionIdSchema })
  .strict()

export const universalSessionCloseSchema = z
  .object({ sessionId: compositeSessionIdSchema })
  .strict()

export const universalSessionRespondPermissionSchema = z
  .object({
    requestId: z.string().trim().min(1).max(256),
    outcome: z.string().trim().min(1).max(128)
  })
  .strict()

export const universalSessionRuntimeFilterSchema = z
  .object({ runtimeId: runtimeIdSchema })
  .strict()
  .partial()
  .optional()

export type RuntimeIdInput = z.infer<typeof runtimeIdSchema>
export type UniversalSessionCreateInput = z.infer<typeof universalSessionCreateSchema>
export type UniversalSessionPromptInput = z.infer<typeof universalSessionPromptSchema>
