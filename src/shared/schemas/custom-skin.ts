import { z } from 'zod'
import { CUSTOM_SKIN_TOKEN_KEYS } from '../types/custom-skin'

export const customSkinIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must use lowercase letters, numbers, and hyphens')

const relativeAssetPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !value.includes('\0'), 'must not contain null bytes')
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\'), 'must be relative')
  .refine(
    (value) => !value.split(/[\\/]+/).some((segment) => segment === '..'),
    'must stay inside the skin project'
  )
  .refine((value) => /\.(?:png|jpe?g|webp)$/i.test(value), 'must be PNG, JPEG, or WebP')

const cssColorSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .refine(
    (value) => /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch)\([^;{}]+\))$/i.test(value),
    'must be a CSS color without URLs or declarations'
  )

const tokenShape = Object.fromEntries(
  CUSTOM_SKIN_TOKEN_KEYS.map((key) => [key, cssColorSchema.optional()])
) as Record<(typeof CUSTOM_SKIN_TOKEN_KEYS)[number], z.ZodOptional<typeof cssColorSchema>>

export const customSkinManifestSchema = z
  .object({
    $schema: z.string().trim().min(1).max(256).optional(),
    schemaVersion: z.literal(1),
    id: customSkinIdSchema,
    name: z.string().trim().min(1).max(80),
    version: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().trim().max(240).optional(),
    author: z.string().trim().max(80).optional(),
    appearance: z.enum(['dark', 'light']),
    assets: z
      .object({
        preview: relativeAssetPathSchema.optional(),
        wallpaper: relativeAssetPathSchema.optional(),
        portrait: relativeAssetPathSchema.optional()
      })
      .strict()
      .optional(),
    tokens: z.object(tokenShape).strict()
  })
  .strict()

export const customSkinSelectionSchema = customSkinIdSchema.nullable()
