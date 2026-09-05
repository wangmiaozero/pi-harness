/** Runtime schemas for non-domain IPC inputs. */

import { z } from 'zod'
import { MASCOT_STYLES } from '../constants/mascot'
import { normalizeNavOrder } from '../constants/navigation'
import { APP_THEMES } from '../constants/theme'
import { TOOL_PRESET_VALUES } from '../workspace/tool-presets'
import { providerKeySchema } from './domain'

export const noArgsSchema = z.tuple([])

export const systemPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'path must not contain null bytes')

export const configFileSchema = z.enum(['models', 'settings'])
export const configContentSchema = z.string().max(5 * 1024 * 1024)

export const overwriteOptionsSchema = z
  .object({ overwrite: z.boolean().optional() })
  .strict()
  .optional()

export const backupReasonSchema = z.string().trim().min(1).max(256).optional()
export const backupRetentionSchema = z.number().int().min(1).max(1000)
export const optionalBooleanSchema = z.boolean().optional()
export const screenMotionActiveSchema = z
  .object({
    active: z.boolean(),
    theme: z.enum(['dark', 'light'])
  })
  .strict()
export const modelCompositeIdSchema = z
  .string()
  .max(386)
  .refine((value) => {
    const separator = value.indexOf('::')
    const provider = value.slice(0, separator)
    const model = value.slice(separator + 2)
    return (
      separator > 0 &&
      providerKeySchema.safeParse(provider).success &&
      model.length > 0 &&
      model.length <= 256 &&
      !model.includes('\0')
    )
  }, 'invalid model id')

const optionalFilesystemPathSchema = systemPathSchema.nullable()

const appSettingsFields = {
  language: z.enum(['auto', 'zh-CN', 'en-US']),
  theme: z.enum(APP_THEMES),
  mascotUnlocked: z.boolean(),
  mascotStyle: z.enum(MASCOT_STYLES),
  petAnimations: z.boolean(),
  petStatusText: z.boolean(),
  petAutoSleep: z.boolean(),
  petSleepMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  petSound: z.boolean(),
  mockMode: z.boolean(),
  manualCliPath: optionalFilesystemPathSchema,
  manualConfigDir: optionalFilesystemPathSchema,
  autoBackup: z.boolean(),
  backupRetention: backupRetentionSchema,
  developerMode: z.boolean(),
  defaultToolPreset: z.enum(TOOL_PRESET_VALUES),
  restoreTabs: z.boolean(),
  autoOpenLastProject: z.boolean(),
  windowMotionEnabled: z.boolean(),
  screenMotionEnabled: z.boolean(),
  navOrder: z.array(z.unknown()).max(32).transform(normalizeNavOrder)
}

export const appSettingsPatchSchema = z.object(appSettingsFields).partial().strict()

export function pickKnownAppSettings<T extends object>(value: T): T {
  const source = value as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const key of Object.keys(appSettingsFields)) {
    if (key in source) picked[key] = source[key]
  }
  return picked as T
}

export const uiStateSchema = z
  .record(z.string().min(1).max(128), z.unknown())
  .superRefine((value, context) => {
    try {
      if (JSON.stringify(value).length > 2 * 1024 * 1024) {
        context.addIssue({ code: 'custom', message: 'UI state is too large' })
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'UI state must be JSON serializable' })
    }
  })
