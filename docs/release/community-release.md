# Community Release

Community is the default free distribution policy. Packages include Pi Standalone, an independent Node.js runtime, npm and npx. No Apple Developer account, Developer ID certificate, notarization account or Windows signing certificate is required.

The standard and nomascot variants retain the existing installer names. macOS uses DMG and ZIP, Windows uses NSIS, and Linux uses AppImage. The release gate currently requires macOS ARM64/x64, Windows x64 and Linux x64. Windows/Linux ARM64 are preview validation targets; they are excluded from public release collection until their native evidence and architecture-specific updater policy are approved.

Community macOS bundles use ad-hoc signatures. These check local bundle consistency, do not identify an Apple developer and do not guarantee Gatekeeper acceptance. Windows installers are unsigned and may trigger SmartScreen. Never disable Gatekeeper, Defender or quarantine protections.

`resources/release-policy.json` records the installed update policy. All current Community platforms use version checks and manual installation from the official GitHub Releases page. Automatic replacement is not certified by a successful build or a version check.

The `verified` channel remains a reserved extension point in the release policy type. Certificate provisioning, nested runtime signing, notarization and real cross-version update tests must be implemented and validated before enabling automatic installation. The current release workflow only produces Community packages.

See [preview and release steps](github-actions-release.md), [platform readiness](release-readiness.md), and [update strategy](update-strategy.md).
