# Built-in Skills Collections

Pi-Harness distinguishes the read-only bundled source from the Skill instance installed for Pi:

```text
resources/builtin-skills/<source>  --explicit install-->  Pi Skill root/<skill-id>
```

Removing an installed Skill never removes the bundled source. No built-in Skill is automatically installed at startup, after an application update, or after a user removes it.

## Matt Pocock Skills

The `builtin:mattpocock-skills` collection contains the formal `engineering`, `productivity`, and `misc` Skills from `mattpocock/skills`. `deprecated` and `in-progress` are excluded. The complete Skill directory is bundled, including Markdown references, scripts, templates, examples, assets, agent metadata, and the upstream MIT `LICENSE`.

Development sync:

```bash
pnpm sync:builtin-skills
pnpm sync:builtin-skills -- --source /path/to/mattpocock/skills
pnpm check:builtin-skills
```

The default source is the sibling `../skills` checkout. Production code never reads that checkout. The sync script scans `SKILL.md`, parses name and description, records the Git commit, hashes every file, generates `manifest.json`, validates the staging directory, and then replaces the repository bundle.

## Runtime paths

- Development bundled root: `<appPath>/resources/builtin-skills`.
- Packaged bundled root: `<process.resourcesPath>/builtin-skills`, copied by electron-builder `extraResources` and kept outside `app.asar`.
- Global install root: `<Pi configDir>/skills`.
- Project install root: `<project>/.pi/skills` after FileAccess authorization.
- Ownership metadata: Pi-Harness `metadata.json.builtinSkills`; this records origin, scope, installed path, source commit, and source hash only. It is not a replacement for Pi configuration or package state.
- Backups: Pi-Harness `capability-backups` under Electron `userData`.

## Lifecycle and safety

Install copies the complete bundled directory into a temporary sibling, validates `SKILL.md` and the source hash, backs up a conflict only after explicit confirmation, and atomically renames the staged directory into place.

Uninstall requires an exact Ownership record matching collection, Skill id, scope, project root, and expected direct-child path. It backs up the installed instance, removes it, removes Ownership, and verifies the path is absent. Missing files can have their stale Ownership removed. A same-name Skill without Ownership is reported as `conflict` and is never silently deleted.

Health states are `not-installed`, `healthy`, `missing`, `modified`, `conflict`, `corrupted`, and `update-available`. Installed files are compared with the hash recorded at install time; an application bundle with a newer commit/hash exposes an update action but never silently replaces local files.
