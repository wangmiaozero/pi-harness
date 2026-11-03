import { changelogSection } from './policy.mjs'
import { catalog } from '../../src/main/runtime/distribution.mjs'

export function renderReleaseNotes(changelog, version, previewRevision) {
  const notes = previewRevision
    ? `# Build Preview ${version}\n\nThis is an unpublished test build from ${previewRevision}.`
    : changelogSection(changelog, version)
        .replace(/^## [^\n]+/, `# v${version}`)
        .replace(/^### (Added|Fixed)$/gm, '## $1')
        .replace(/^#### /gm, '### ')
        .replace(/\n\n## (Added|Fixed)/g, '\n\n---\n\n## $1')

  return `${notes}

---

## Downloads

Community Release · free distribution.

Supported platforms: macOS ARM64/x64, Windows x64, Linux x64. Standard and nomascot installers are provided. Windows/Linux ARM64 remain preview targets.

Runtime versions: Pi ${catalog.pi.version}; Node.js ${catalog.node.version}; npm/npx ${catalog.node.npmVersion}.

## Installation and updates

macOS builds are ad-hoc signed, without Apple Developer ID or notarization. Windows installers are unsigned and may show SmartScreen warnings. Verify the official download source and SHA256SUMS before opening. macOS: use System Settings → Privacy & Security → Open Anyway when blocked. Do not disable system security.

Check for new versions in the app, download from the official GitHub Releases page and install manually on every Community platform. Automatic installation has not been validated; updater feeds are withheld.

## Verify your download

Signed releases include checksums.json.sig: verify its Ed25519 signature using the public key shipped with Pi-Harness, then verify installer size and SHA256. SHA256 alone does not authenticate the publisher. Build previews are unsigned and are not trusted releases.
`
}
