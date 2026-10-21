// @vitest-environment node
import { expect, it } from 'vitest'
import {
  HARNESS_PLUGIN_API_VERSION,
  PLUGIN_EVENT_TYPES
} from '../../../packages/harness-plugin-sdk'
import * as runtime from '../../../packages/harness-plugin-sdk/index.mjs'
import { pluginManifestSchema as publicSchema } from '../../../packages/harness-plugin-sdk/manifest.mjs'
import { pluginManifestSchema as hostSchema } from './schema'

it('keeps the standalone ESM SDK and application contract on the same version, events and manifest schema', () => {
  expect(runtime.HARNESS_PLUGIN_API_VERSION).toBe(HARNESS_PLUGIN_API_VERSION)
  expect(runtime.PLUGIN_EVENT_TYPES).toEqual(PLUGIN_EVENT_TYPES)
  expect(hostSchema).toBe(publicSchema)
  const plugin = { activate() {} }
  expect(runtime.definePlugin(plugin)).toBe(plugin)
})
