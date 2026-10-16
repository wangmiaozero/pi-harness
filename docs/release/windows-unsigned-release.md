# Windows Community packages

Windows x64 uses the existing unsigned per-user NSIS installer with selectable installation directory. Standard and nomascot names remain distinct. No paid signing service is used, and Authenticode verification settings are not disabled.

NSIS installation tests require GitHub Actions or an explicitly disposable machine (`PI_HARNESS_DISPOSABLE_INSTALL_TEST=1`); use `pnpm build:win` for local packaging on a normal workstation. The native gate installs NSIS silently into an isolated test directory on the disposable hosted runner, checks the installed Electron and runtime architectures, executes Pi/Node/npm/npx and runs RPC, MCP, process lifecycle and persisted-session tests. Environment regressions run on Windows before packaging. Building an EXE alone does not certify installation or update behavior.

Windows ARM64 has official Pi and Node distributions and a hosted native runner label. The preview job builds separate ARM64 installers with explicit architecture suffixes. Until that job is observed passing and updater architecture routing is reviewed, ARM64 remains preview-only and is not collected for public releases.

SmartScreen may warn because Community installers are unsigned. Confirm the official repository and file checksum before following Windows' explicit confirmation flow. Never disable Defender or change machine security policy. Updates currently use the official Releases page and manual installation; cross-version automatic NSIS installation is not verified.
