export const HARNESS_PLUGIN_API_VERSION = '1.0.0'
export const PLUGIN_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'tool.completed',
  'evaluation.completed'
]
/** Identity helper; validation and registration are owned by the host. */
export function definePlugin(plugin) {
  return plugin
}
