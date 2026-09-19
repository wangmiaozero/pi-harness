/**
 * Application-wide constants shared across Main / Preload / Renderer.
 * Keep this module free of platform-specific (Node/DOM) globals.
 */

import { version as packageVersion } from '../../../package.json'

export const APP_NAME = 'Pi-Harness'
export const APP_PRODUCT_NAME = 'Pi-Harness'
export const APP_DESCRIPTION = 'Desktop Harness & Control Center for Pi Coding Agent'
export const APP_ID = 'dev.pi-harness.app'
export const APP_VERSION = packageVersion
export const AUTHOR_WATERMARK = 'wangmiao'

/** IPC bridge namespace exposed on window. */
export const API_NAMESPACE = 'piSwitch'

/** Listen-only bridge for the screen-motion overlay window. */
export const OVERLAY_API_NAMESPACE = 'piSwitchOverlay'

/** Default window geometry. */
export const DEFAULT_WINDOW = {
  width: 1200,
  height: 780,
  minWidth: 960,
  minHeight: 640
} as const

/** Pi native config file names (relative to the Pi config directory). */
export const PI_FILES = {
  settings: 'settings.json',
  models: 'models.json',
  modelsStore: 'models-store.json',
  auth: 'auth.json'
} as const

/** Pi-Harness's own storage file names (in Electron userData). */
export const APP_FILES = {
  settings: 'settings.json',
  metadata: 'metadata.json',
  uiState: 'ui-state.json',
  secretVault: 'secrets.bin'
} as const

/** Thinking levels recognised by Pi. */
export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number]

/** Composer `none` is Pi `off`. Ultra is a UI-only alias for the model's highest Pi level. */
export function toPiThinkingLevel(level: string): string {
  if (level === 'none') return 'off'
  if (level === 'ultra') return 'max'
  return (PI_THINKING_LEVELS as readonly string[]).includes(level) ? level : 'medium'
}

/** Convert Pi's native naming into the Codex-aligned composer vocabulary. */
export function toComposerThinkingLevel(level: string): string {
  return level === 'off' ? 'none' : level
}

/** Model input modalities Pi understands. */
export const PI_INPUT_TYPES = ['text', 'image'] as const
export type PiInputType = (typeof PI_INPUT_TYPES)[number]
