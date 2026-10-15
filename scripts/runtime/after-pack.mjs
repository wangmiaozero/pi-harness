import fs from 'node:fs/promises'
import path from 'node:path'
import { verifyDistribution } from '../../src/main/runtime/distribution.mjs'

export default async function afterPack(context) {
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  const platform = context.electronPlatformName
  const resources =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app/Contents/Resources`
        )
      : path.join(context.appOutDir, 'resources')
  for (const kind of ['pi', 'node'])
    await verifyDistribution(path.join(resources, 'runtimes', kind), kind, platform, arch)
  const extension = path.join(resources, 'desktop-extension/index.mjs')
  await fs.access(extension)
  const treeSize = async (dir) => {
    let size = 0
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) size += await treeSize(file)
      else if (entry.isFile()) size += (await fs.stat(file)).size
    }
    return size
  }
  const report = {
    platform,
    arch,
    runtimeBytes: await treeSize(path.join(resources, 'runtimes')),
    integrity: 'verified',
    execution:
      platform === process.platform && arch === process.arch
        ? 'verified before packaging'
        : 'requires native runner'
  }
  const output = path.join(context.packager.projectDir, 'out/runtime-validation')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(
    path.join(output, `package-${platform}-${arch}.json`),
    JSON.stringify(report, null, 2) + '\n'
  )
}
