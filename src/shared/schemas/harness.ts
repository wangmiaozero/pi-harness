import { z } from 'zod'
import {
  agentImageSchema,
  sessionIdSchema,
  thinkingLevelSchema,
  toolNamesSchema
} from './workspace'

export const harnessSessionInputSchema = z.strictObject({
  sessionId: sessionIdSchema
})

export const harnessSetToolsSchema = z.strictObject({
  sessionId: sessionIdSchema,
  toolNames: toolNamesSchema
})

export const harnessSetModelSchema = z.strictObject({
  sessionId: sessionIdSchema,
  provider: z.string().min(1).max(128),
  modelId: z.string().min(1).max(256)
})

export const harnessSetThinkingSchema = z.strictObject({
  sessionId: sessionIdSchema,
  level: thinkingLevelSchema
})

export const harnessCompactSchema = z.strictObject({
  sessionId: sessionIdSchema,
  instructions: z.string().max(20_000).optional()
})

export const harnessSetAutoCompactionSchema = z.strictObject({
  sessionId: sessionIdSchema,
  enabled: z.boolean()
})

export const harnessQueueMessageSchema = z
  .strictObject({
    sessionId: sessionIdSchema,
    message: z.string().max(200_000),
    images: z.array(agentImageSchema).max(8).optional()
  })
  .refine((input) => input.message.trim().length > 0 || Boolean(input.images?.length), {
    message: 'message or image is required'
  })

export const harnessTreeActionSchema = z.strictObject({
  sessionId: sessionIdSchema,
  entryId: z.string().min(1).max(128)
})
