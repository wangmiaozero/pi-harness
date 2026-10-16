# Linux Community packages

The existing AppImage format is retained; no extra deb/rpm formats are introduced. Standard x64 and nomascot x86_64 filenames follow electron-builder's established naming. ARM64 artifacts are preview-only until native validation and architecture routing are approved.

The native hosted test target is Ubuntu 24.04. The gate sets executable permission, executes the AppImage's extraction entry point and starts its actual extracted application under Xvfb. This exercises the shipped application without relying on FUSE availability in the runner. Desktop integration, FUSE mounting and older glibc distributions require separate user-system validation; no broader distro compatibility is claimed.

The package includes its icon, desktop entry, Pi, Node, npm/npx and integrity receipts. Runtime header and entire-tree verification precede real execution. MCP and persistent sessions run using the selected bundled Node, with host Node/Pi removed from the application's test PATH.

For installation:

```sh
chmod +x Pi-Harness-*.AppImage
./Pi-Harness-<version>.AppImage
```

Use the exact downloaded filename. Verify the checksum first. Community updates are manual downloads from GitHub Releases. AppImage self-replacement has not passed cross-version validation and is not enabled by the new Community policy.
