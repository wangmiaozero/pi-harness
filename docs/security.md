# Security model

Pi-Harness treats renderer input, local configuration, package metadata, archives, and external process output as untrusted data.

## Electron and IPC

- The renderer receives one typed API through `contextBridge`; raw `ipcRenderer` is never exposed.
- `contextIsolation` is enabled, `nodeIntegration` is disabled, webviews and new windows are denied, and permission requests are rejected by default.
- IPC channel names are centralized. Main rejects calls not originating from the current main window's main frame.
- Zod schemas validate high-risk inputs including settings patches, configuration writes, provider/model identifiers, backup operations, package/skill targets, paths, booleans, and bounded UI state.
- Errors cross IPC as sanitized data with a stable code, safe user message, recoverability, and redacted context.

## Filesystem authorization

Workspace access is limited to session roots, project roots, worktrees, and directories explicitly chosen through the OS picker or a native file-drop gesture. Explicit grants are stored in Main-owned `authorized-roots.json`; renderer-restored UI state cannot add a new grant. Agent startup must already be inside an allowed root.

Checks use both lexical containment and canonical real paths. This prevents `..`, absolute-path bypasses, path aliases, and symlink escapes. File editing additionally rejects symbolic links, non-regular files, binary/oversized content, and stale content revisions. Upload filenames cannot contain separators, null bytes, or traversal segments.

Generic “open in system” requests use a separate policy. Workspace descendants, configured skill roots, session storage, and known installed packages are allowed; configuration files/directories use explicit known paths. Arbitrary paths are rejected.

Backup IDs use the generated timestamp/hash format and are revalidated in both IPC and `BackupService`. Restore ignores unknown manifest filenames before reading or writing them.

## Package, skill, and archive safety

- Featured capability mutations accept a trusted catalog ID only. Main resolves source URL, selector, and destination.
- npm and Git package sources are parsed before path resolution. Traversal-shaped package names and either separator form of Git traversal are rejected.
- Project package operations reuse Workspace root authorization. Built-in and featured skill placement is constrained to validated skill roots and uses staging, validation, backup, and atomic rename.
- Node downloads come from the fixed official distribution URL, are SHA-256 verified, and extract with traversal protection into a temporary staging directory before replacement.

## Commands and navigation

Main uses `spawn`/`execFile` with explicit executable and argument arrays. Renderer values are not interpolated into shell command strings. Executables are resolved through the trusted command resolver, commands have timeouts, and captured output is sanitized. The macOS administrator permission repair is the narrow exception: it builds only fixed `chown`/`chmod` commands over validated package roots with POSIX quoting, then passes the script as one `osascript` argument.

External navigation is denied except for fixed application-owned URLs such as the official Node.js download page. Updater metadata and payloads come from the configured GitHub release provider.

## Secrets and diagnostics

Secrets use macOS Keychain or Electron `safeStorage`; plaintext credentials are not returned to the renderer. Logger serialization recursively redacts credential-shaped keys and handles circular objects without falling back to the original value. Diagnostic copy/export masks home paths and secret-like content.

Never commit `.env` files, signing identities, API keys, tokens, certificates, or updater credentials. Release automation deliberately skips signing when no signing secret is configured; unsigned artifacts are development/community artifacts, not a substitute for a signed production release.

Report a suspected vulnerability privately to [tuziling84@gmail.com](mailto:tuziling84@gmail.com) with reproduction steps and affected versions. Do not include live credentials.
