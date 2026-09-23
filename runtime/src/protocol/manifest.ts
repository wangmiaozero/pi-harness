/**
 * Runtime protocol manifest. Desktop and the sidecar share `PROTOCOL_VERSION`.
 * Method names are registered at boot; this list is the lifecycle contract
 * the host may call before any domain service is warm.
 */

import { PROTOCOL_VERSION, RUNTIME_VERSION } from '../version.js'

export const PROTOCOL_MANIFEST = {
  protocolVersion: PROTOCOL_VERSION,
  runtimeVersion: RUNTIME_VERSION,
  lifecycleMethods: [
    'runtime.handshake',
    'runtime.ping',
    'runtime.version',
    'runtime.status',
    'runtime.activity',
    'runtime.shutdown'
  ],
  domainEvents: [
    'agent.event',
    'agent.running',
    'harness.event',
    'runtime.ready',
    'runtime.stopping',
    'runtime.protocol-violation'
  ],
  desktopEvents: [
    'config.changed',
    'pi.environment-changed',
    'environment.install-task',
    'capability.progress'
  ]
} as const

export type ProtocolManifest = typeof PROTOCOL_MANIFEST
