# Update strategy

| Policy            | Detection                     | Installation                                  | Published updater feeds     |
| ----------------- | ----------------------------- | --------------------------------------------- | --------------------------- |
| Community macOS   | Official stable Release check | Manual DMG/ZIP                                | Withheld                    |
| Community Windows | Official stable Release check | Manual NSIS                                   | Withheld                    |
| Community Linux   | Official stable Release check | Manual AppImage                               | Withheld                    |
| Verified (future) | Existing updater integration  | Requires signing and cross-version validation | Requires validated payloads |

New Community packages include `release-policy.json`; automatic installation is disabled by that trusted Main-side policy. Version checks and the existing fixed official download action remain available. Legacy packages without the policy retain their original behavior, including the macOS signature guard and manual fallback when update metadata is missing. No security check is bypassed.

Builder-generated latest/nomascot metadata is still produced and verified against the actual payload size and SHA512 in each native job. It remains in Actions validation artifacts. Collection withholds feeds from public Community releases while automatic installation is unverified, so old clients do not consume an unvalidated installation path. Both variants remain distinct and can never fall through to the other variant's payload.

Before enabling automatic installation, run a true old-install → new-release → replacement → restart/session/config validation on each platform. macOS additionally requires Developer ID, valid nested signatures and notarization. Windows requires a reviewed Authenticode/unsigned update trust policy; Linux requires AppImage self-replacement evidence. A manual upgrade test or successful version check is insufficient. ARM64 feed publication also requires explicit compatibility tests for older x64 clients.
