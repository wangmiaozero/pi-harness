import { describe, expect, it } from 'vitest'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'
import { buildEnvironmentChecks } from './environment'

const healthyRuntime: NodeRuntimeInfo = {
  nodeInstalled: true,
  nodePath: '/opt/tools/bin/node',
  nodeVersion: 'v24.15.0',
  npmInstalled: true,
  npmPath: '/opt/tools/bin/npm',
  npmVersion: '11.0.0',
  pnpmInstalled: true,
  pnpmPath: '/opt/tools/bin/pnpm',
  pnpmVersion: '9.12.1',
  nodeSupported: true,
  minimumNodeVersion: '22.0.0',
  nodeStatus: 'ready',
  npmStatus: 'ready',
  nodeSource: 'process-path',
  npmSource: 'process-path',
  pnpmSource: 'process-path',
  npmPrefix: '/opt/tools',
  npmPrefixWritable: true,
  npmBinDir: '/opt/tools/bin',
  resolvedPath: ['/opt/tools/bin', '/usr/bin'].join(process.platform === 'win32' ? ';' : ':'),
  ready: true
}

describe('unified environment checks', () => {
  it('reports healthy executables with versions and paths', () => {
    const checks = buildEnvironmentChecks({
      nodeRuntime: healthyRuntime,
      piInstalled: true,
      piVersion: '0.84.2',
      piPath: '/opt/tools/bin/pi',
      configDir: '/fixture/.pi/agent',
      configReadable: true,
      configWritable: true,
      skillsDirs: ['/fixture/.pi/agent/skills']
    })

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'node', status: 'healthy', version: 'v24.15.0' }),
        expect.objectContaining({ id: 'pnpm', status: 'healthy', path: '/opt/tools/bin/pnpm' }),
        expect.objectContaining({ id: 'pi', status: 'healthy', version: '0.84.2' }),
        expect.objectContaining({ id: 'path', status: 'healthy' })
      ])
    )
  })

  it('centralizes unsupported Node and missing tool remediation', () => {
    const checks = buildEnvironmentChecks({
      nodeRuntime: {
        ...healthyRuntime,
        nodeVersion: 'v20.19.0',
        nodeSupported: false,
        nodeStatus: 'outdated',
        pnpmInstalled: false,
        pnpmPath: null,
        pnpmVersion: null,
        pnpmSource: null
      },
      piInstalled: false,
      piVersion: null,
      piPath: null,
      configDir: '/fixture/.pi/agent',
      configReadable: false,
      configWritable: false,
      skillsDirs: []
    })

    expect(checks.find((check) => check.id === 'node')).toMatchObject({
      status: 'warning',
      remediation: expect.stringContaining('22')
    })
    expect(checks.find((check) => check.id === 'pi')).toMatchObject({
      status: 'warning',
      installed: false
    })
    expect(checks.find((check) => check.id === 'skills-directory')).toMatchObject({
      status: 'warning'
    })
  })
})
