import path from 'node:path'
import { assessNodeSecurity } from '../../src/shared/runtime/node-security-policy.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export default async function beforePack(context) {
  if (
    !assessNodeSecurity(process.versions.node).executionAllowed ||
    !process.versions.node.startsWith('24.')
  )
    throw new Error('Packaging requires security-patched Node 24 LTS')
  const nomascot = context.packager.config.extraMetadata?.piHarnessVariant === 'nomascot'
  if (nomascot || context.electronPlatformName === 'win32') {
    // electron-builder concatenates inherited extraResources arrays. Filter the
    // effective list rather than adding another list that retains parent assets.
    const resources = context.packager.config.extraResources ?? []
    context.packager.config.extraResources = resources.filter((entry) =>
      typeof entry === 'string'
        ? !entry.replaceAll('\\', '/').includes('petpacks')
        : entry.to !== 'petpacks' && !String(entry.from).replaceAll('\\', '/').includes('petpacks')
    )
  }
  if (context.electronPlatformName === 'win32' && !nomascot) {
    // Keep the complete built-in pack in app.asar. Installing and deleting
    // twenty thousand loose frames makes ARM64 NSIS upgrades unnecessarily slow.
    context.packager.config.files = [
      ...(context.packager.config.files ?? []),
      { from: 'resources/petpacks', to: 'resources/petpacks', filter: ['**/*'] }
    ]
  }
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error('Only official x64 and arm64 runtime distributions can be packaged')
  const args = [
    path.join(context.packager.projectDir, 'scripts/runtime/prepare-runtime.mjs'),
    `--platform=${context.electronPlatformName}`,
    `--arch=${arch}`
  ]
  if (process.env.PI_HARNESS_RUNTIME_OFFLINE === '1') args.push('--offline')
  const result = await promisify(execFile)(process.execPath, args, {
    cwd: context.packager.projectDir,
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024
  })
  process.stdout.write(result.stdout)
}
