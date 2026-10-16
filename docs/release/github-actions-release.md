# GitHub Actions release

## Build Preview

Open the repository's **Actions → Release / Build Preview → Run workflow**, select a reviewed branch and run it. Both variants are built and installed/executed on native runners. Download `packages-*`, `validation-*`, and `community-release-candidate` under the run's Artifacts. Preview runs do not create tags, change versions or create Releases. Failed mandatory platform validation prevents a complete candidate.

ARM64 Windows/Linux jobs are experimental. Their failures are visible and their artifacts remain previews; the public collector accepts only the four established targets.

## Publish a new version

1. Update `package.json` to a new stable SemVer greater than the previous release. Never reuse `2.0.0`.
2. Add a dated `## X.Y.Z — YYYY-MM-DD` changelog section containing real `### Added` and/or `### Fixed` entries.
3. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm compile`, `pnpm test:runtime` (after `pnpm runtime:prepare`) and native `pnpm release:package` as applicable. Review the preview run on every required platform.
4. Review, commit and push the intended source changes.
5. Create and push a new version tag, for example a future release:

   ```sh
   git tag v2.0.1
   git push origin v2.0.1
   ```

6. Follow **Actions → Release / Build Preview**. The workflow validates the tag commit/version/changelog, runs CI, gathers only matching native evidence, recalculates all asset hashes and creates a draft Release.
7. Every uploaded asset is downloaded again and SHA256-checked. Only after the exact asset set passes does the workflow make the draft public.
8. Check the final [Releases page](https://github.com/wangmiaozero/pi-harness/releases), installation packages, release notes and `SHA256SUMS`.

Only the final publish job has `contents: write`; build and preview jobs use read access. The repository must allow Actions and a writable built-in `GITHUB_TOKEN` in that job. No personal access token is required. Standard hosted runners are free for public repositories; quotas and availability remain subject to GitHub policies.

## Failure and retry

Build failures do not create a public Release. Interrupted uploads leave a draft. Re-run the failed publish job in the **same workflow run**, preserving the original candidate artifact. A draft is resumable only when its run-ID/commit marker matches; existing files must match the candidate exactly. Conflicting or unrelated drafts, public Releases, and `v2.0.0` are rejected. Do not use clobber/replace uploads or move tags. If a fresh build differs, review the failed draft and explicitly resolve it before starting another run.

The workflow is implemented in the existing `release.yml`; CI is reused rather than maintaining a second build system. Local scripts never publish as part of `pnpm build:*` or `pnpm release:package`.
