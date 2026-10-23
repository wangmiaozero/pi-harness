import { describe, expect, it, vi } from 'vitest'
import { artifactName, NodeInstaller } from './node-installer'

describe('NodeInstaller release policy', () => {
  it('chooses the newest supported LTS release instead of forcing Node 22', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { version: 'v26.1.0', lts: false, files: ['osx-arm64-tar'] },
          { version: 'v24.22.1', lts: 'Krypton', files: ['osx-arm64-tar'] },
          { version: 'v22.22.0', lts: 'Jod', files: ['osx-arm64-tar'] },
          { version: 'v20.20.0', lts: 'Iron', files: ['osx-arm64-tar'] }
        ]),
        { status: 200 }
      )
    )
    const installer = new NodeInstaller({ platform: 'darwin', arch: 'arm64', fetch })

    await expect(installer.resolveRecommendedVersion()).resolves.toBe('v24.22.1')
  })

  it('builds official artifacts for macOS, Windows, and Linux', () => {
    expect(artifactName('v24.22.1', 'darwin', 'arm64')).toBe('node-v24.22.1-darwin-arm64.tar.gz')
    expect(artifactName('v24.22.1', 'win32', 'x64')).toBe('node-v24.22.1-win-x64.zip')
    expect(artifactName('v24.22.1', 'linux', 'x64')).toBe('node-v24.22.1-linux-x64.tar.gz')
  })
})
