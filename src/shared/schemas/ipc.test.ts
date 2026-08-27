import { describe, expect, it } from 'vitest'
import {
  appSettingsPatchSchema,
  backupRetentionSchema,
  modelCompositeIdSchema,
  omitLegacyAppSettingsKeys,
  pickKnownAppSettings,
  screenMotionActiveSchema,
  uiStateSchema
} from './ipc'
import { backupIdSchema } from './domain'

describe('IPC schemas', () => {
  it('rejects path traversal backup ids', () => {
    expect(backupIdSchema.safeParse('../settings.json').success).toBe(false)
    expect(backupIdSchema.safeParse('1720000000000-deadbeef').success).toBe(true)
  })

  it('validates bounded model ids and backup retention', () => {
    expect(modelCompositeIdSchema.safeParse('openai::gpt-5').success).toBe(true)
    expect(modelCompositeIdSchema.safeParse('missing-separator').success).toBe(false)
    expect(backupRetentionSchema.safeParse(20).success).toBe(true)
    expect(backupRetentionSchema.safeParse(0).success).toBe(false)
  })

  it('accepts known settings only', () => {
    expect(appSettingsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ theme: 'neon' }).success).toBe(false)
    expect(appSettingsPatchSchema.safeParse({ unexpected: true }).success).toBe(false)
    expect(appSettingsPatchSchema.safeParse({ windowMotionEnabled: false }).success).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ screenMotionEnabled: true }).success).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ navOrder: ['settings'] }).success).toBe(true)
    expect(appSettingsPatchSchema.parse({ navOrder: ['settings'] }).navOrder?.[0]).toBe('settings')
    expect(appSettingsPatchSchema.parse({ navOrder: ['settings'] }).navOrder).toHaveLength(8)
    expect(appSettingsPatchSchema.safeParse({ density: 'compact' }).success).toBe(false)
    expect(
      appSettingsPatchSchema.safeParse(
        omitLegacyAppSettingsKeys({ theme: 'dark', density: 'compact' })
      ).success
    ).toBe(true)
    expect(pickKnownAppSettings({ theme: 'dark', density: 'compact' })).toEqual({ theme: 'dark' })
  })

  it('rejects oversized UI state', () => {
    expect(uiStateSchema.safeParse({ selected: 'overview' }).success).toBe(true)
    expect(uiStateSchema.safeParse({ payload: 'x'.repeat(2 * 1024 * 1024 + 1) }).success).toBe(
      false
    )
  })

  it('accepts only the screen-motion active payload', () => {
    expect(screenMotionActiveSchema.safeParse({ active: true, theme: 'dark' }).success).toBe(true)
    expect(screenMotionActiveSchema.safeParse({ active: false, theme: 'light' }).success).toBe(true)
    expect(screenMotionActiveSchema.safeParse({ active: true }).success).toBe(false)
    expect(screenMotionActiveSchema.safeParse({ active: true, theme: 'system' }).success).toBe(
      false
    )
    expect(
      screenMotionActiveSchema.safeParse({ active: true, theme: 'dark', extra: true }).success
    ).toBe(false)
  })
})
