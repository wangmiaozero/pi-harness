# Release supply chain

Pi is obtained from the official earendil-works/pi release; Node and bundled npm/npx come from nodejs.org. The runtime catalog pins archive, official checksum-list and full-tree digests; cached bytes are always verified. Extraction validates paths and links, bounds expanded data, stages into private temporary directories and activates only after verification. Timeouts and cancellation do not overwrite the active runtime.

Workflow actions are pinned to immutable upstream commit IDs. Dependencies install with the pnpm lockfile. Electron's downloader and builder verify downloaded tool/runtime archives; a download cache is an optimization, not a replacement for those checks. CI runs dependency audit and records production license data.

Each native build emits evidence containing commit, version, platform, architecture, variant, test outcome and artifact digest. Collection rejects missing evidence, wrong versions/revisions, incomplete variants, unexpected files and transport hash mismatches. Draft upload verifies exact remote asset names, sizes and downloaded SHA256 before publication. Build jobs have read-only tokens; only publication has contents-write access. Preview never enters publication.

`SHA256SUMS` covers installer/blockmap bytes. `checksums.json` additionally describes installer sizes, platform, architecture and variant. They prove consistency with the downloaded lists, not independent publisher identity. Use only the official repository over HTTPS. Do not print tokens/certificates or add private configuration to artifacts. The ASAR resource validator rejects private documents and unintended runtime files.
