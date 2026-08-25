import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import {
  isNodeVersionSupported,
  nodeToolDirectories,
  normalizeNodeVersion
} from './node-environment'

describe('Node.js version policy', () => {
  it.each([
    ['v24.15.0', true],
    ['v22.0.0', true],
    ['26.1.0', true],
    ['v20.19.0', false],
    ['v18.20.8', false],
    ['not-a-version', false]
  ])('evaluates %s using SemVer', (version, expected) => {
    expect(isNodeVersionSupported(version)).toBe(expected)
  })

  it('normalizes version output without reducing it to a major integer', () => {
    expect(normalizeNodeVersion('node v24.15.0')).toBe('24.15.0')
    expect(normalizeNodeVersion('v22.0.0-rc.1')).toBe('22.0.0-rc.1')
  })

  it('prioritizes the interactive shell PATH over GUI fallback directories', async () => {
    const shellBin = path.join(os.tmpdir(), 'pi-harness-shell-node-bin')
    const shellFallback = path.join(os.tmpdir(), 'pi-harness-shell-fallback-bin')

    const directories = await nodeToolDirectories([shellBin, shellFallback].join(path.delimiter))

    expect(directories.slice(0, 2)).toEqual([shellBin, shellFallback])
  })
})
