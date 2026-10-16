# Release readiness

A configured workflow is not evidence of a successful hosted build. This implementation has not published or replaced the historical manual `v2.0.0` release. Local evidence and hosted-run evidence must be reported separately.

The release collector requires matching native reports for macOS ARM64, macOS x64, Windows x64 and Linux x64. Both standard and nomascot variants need successful builds, resource/runtime integrity, real runtime execution, installed/extracted application E2E, session restart and matching artifact hashes. Source quality, license/audit and native environment regression jobs must also succeed. Experimental Windows/Linux ARM64 jobs never become public support merely because they cross-compile.

The four-platform release candidate gate fails closed for missing native reports. Required installed tests may not be skipped or flaky. Optional Gatekeeper trust, Windows reputation, FUSE/desktop integration and cross-version auto-install are distinct evidence; no paid signature or notarization is required for Community. Automatic installation remains disabled until that separate validation passes.

Reports are in Actions `validation-*` artifacts and `community-release-candidate/release-readiness.json`; native logs are emitted under `out/community-validation/<platform>-<arch>/`. These include deterministic fixture tests; they do not certify a commercial model service or arbitrary third-party extension. Final platform eligibility must cite actual run outcomes.

Current `v2.0.0` is protected from all new tag publication. A future reviewed version and dated changelog are required before a formal release. In the absence of four passing native reports, the correct overall state is **NOT READY FOR COMMUNITY RELEASE**.
