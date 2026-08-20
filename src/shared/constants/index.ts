/**
 * Application-wide constants shared across Main / Preload / Renderer.
 * Keep this module free of platform-specific (Node/DOM) globals.
 */

export const APP_NAME = 'Pi-Switch'
export const APP_PRODUCT_NAME = 'Pi-Switch'
export const APP_DESCRIPTION = 'All-in-One Desktop Manager for Pi Coding Agent'
export const APP_ID = 'dev.pi-switch.app'
export const APP_VERSION = '0.3.3'

/** IPC bridge namespace exposed on window. */
export const API_NAMESPACE = 'piSwitch'

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

/** Pi-Switch's own storage file names (in Electron userData). */
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

/** Model input modalities Pi understands. */
export const PI_INPUT_TYPES = ['text', 'image'] as const
export type PiInputType = (typeof PI_INPUT_TYPES)[number]
