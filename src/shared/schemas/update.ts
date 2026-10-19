import { z } from 'zod'
export const updatePreferencesSchema = z
  .object({ autoCheck: z.boolean(), autoDownload: z.boolean() })
  .strict()
