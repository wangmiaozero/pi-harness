# Release troubleshooting

| Failure                                      | Action                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected v2.0.0 / version mismatch          | Use a genuinely new version and matching tag; preserve the historical release.                                                                              |
| Missing dated changelog                      | Add real Added/Fixed content for the exact new version before tagging.                                                                                      |
| Missing official runtime / checksum mismatch | Inspect the pinned catalog and upstream bytes; clear only the affected cache entry after review. Do not disable verification.                               |
| macOS nested signature/content failure       | Inspect the signed Pi and complete bundle logs. Verify canonical content matches the official executable; do not change receipts to accept arbitrary bytes. |
| Installed E2E failure                        | Download the target validation artifact, inspect the failing suite and actual installed executable; do not promote skipped tests.                           |
| ARM64 preview failure                        | Keep it preview-only; investigate the native runner/toolchain. Required established platforms must still pass.                                              |
| Missing candidate artifact                   | Inspect the mandatory native jobs and source quality. No release should be public.                                                                          |
| GITHUB_TOKEN forbidden                       | Check repository Actions policy and the publish job's contents-write permission. Do not expose the token.                                                   |
| Upload interrupted                           | Re-run the failed publish job from the same run with the original candidate. A matching draft can resume without overwriting assets.                        |
| Draft marker/asset conflict                  | Stop; review the existing draft and source/candidate. Do not clobber assets, move tags or alter public releases.                                            |
| Update offers manual download                | Expected for Community. Download the matching architecture/variant and verify SHA256.                                                                       |
| Gatekeeper / SmartScreen                     | Verify official source and checksums, then use the operating system's explicit per-app confirmation. Never disable system protection.                       |

See [release operation steps](github-actions-release.md) and the run's job logs. Full remote publication is unverified until a separately authorized future tag completes every job.
