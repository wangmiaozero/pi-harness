# macOS ad-hoc signing

Both ARM64 and Intel builds require a native macOS build host. `electron-builder.yml` sets identity `-`, disables notarization and enables hardened runtime with explicit JIT/library-validation entitlements needed by Electron's separately signed frameworks.

Before packaging, official runtime archives and their entire trees are verified against the pinned catalog. Unsigned or invalidly signed Pi native modules are signed first, then the standalone executable, before the containing Electron bundle. Node retains its official upstream signature. electron-builder signs Electron frameworks/helpers and the outer bundle in dependency order; runtimes are excluded from its generic re-signing pass.

Re-signing changes Pi's signature bytes. The validator still pins its upstream archive and full tree; each changed macOS native file is permitted only after a valid strict signature and its own pinned canonical content check. Canonicalization strips the signature in an isolated temporary copy and normalizes the signature allocation in `__LINKEDIT.vmsize`. Other commands, executable bytes and resources remain protected. A regression test re-signs tampered executable content and requires rejection.

`after-sign.mjs` verifies nested native executables and the complete bundle:

```sh
codesign --verify --deep --strict --verbose=2 '/path/to/Pi-Harness.app'
```

The native package gate mounts the actual DMG read-only, copies the application into an isolated Applications directory, verifies it and launches that copy. The ZIP is also extracted and verified. Pi, Node, npm/npx and RPC/MCP/session restart run without system Node/Pi on PATH.

These checks do not prove notarization, Apple developer identity or Gatekeeper acceptance. Confirm source and SHA256 before using **System Settings → Privacy & Security → Open Anyway**. Do not clear quarantine by default or disable Gatekeeper.
