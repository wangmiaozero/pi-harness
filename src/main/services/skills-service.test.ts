import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  packageNameFromSource,
  parseMarketDocument,
  resolveInstalledPackagePath
} from './skills-service'

describe('Skills marketplace recipes', () => {
  it('parses packages from a resilient shell bundle without treating variables as packages', () => {
    const recipe = `
## 标准开发版：一键安装

\`\`\`bash
for pkg in "pi-web-access" "@ff-labs/pi-fff"; do
  pi install "npm:$pkg" || echo failed
done
\`\`\`
`

    const result = parseMarketDocument('标准开发版一键安装.md', '/market/standard.md', recipe)

    expect(result.kind).toBe('bundle')
    expect(result.packages.map((pkg) => pkg.source)).toEqual([
      'npm:pi-web-access',
      'npm:@ff-labs/pi-fff'
    ])
  })

  it('parses direct package sources and removes duplicates', () => {
    const recipe = `
# 推荐指南

pi install npm:pi-web-access
pi install npm:pi-web-access
pi install git:github.com/example/skill-pack
pi install npm:<package>
`

    const result = parseMarketDocument('推荐指南.md', '/market/guide.md', recipe)

    expect(result.kind).toBe('guide')
    expect(result.packages.map((pkg) => pkg.source)).toEqual([
      'npm:pi-web-access',
      'git:github.com/example/skill-pack'
    ])
  })
})

describe('Pi package source paths', () => {
  it('handles scoped and versioned npm package sources', () => {
    expect(packageNameFromSource('npm:@scope/pi-tool@1.2.3')).toBe('@scope/pi-tool')
    expect(packageNameFromSource('npm:pi-tool@1.2.3')).toBe('pi-tool')
    expect(resolveInstalledPackagePath('/agent', 'npm:@scope/pi-tool@1.2.3')).toBe(
      path.join('/agent', 'npm', 'node_modules', '@scope/pi-tool')
    )
  })
})
