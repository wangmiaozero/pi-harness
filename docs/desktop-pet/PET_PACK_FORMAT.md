# Pet Pack Format

A **pet pack** is a self-contained directory of WebP animation frames plus a
`pet-pack.json` manifest. Pi-Harness ships one bundled pack (`bigfish`); users
can install additional packs as ZIP files or local folders via
**Settings → Desktop Pet → Pet Packs**.

Installed user packs live under `<userData>/petpacks/<pack-id>/`. Imports are
validated and installed **atomically**: a pack is staged in a hidden
`.staging/` directory, fully validated, and only then swapped into place. A
failed import never leaves a broken or partial install.

---

## Directory layout

```
mypet/
├── pet-pack.json          # required manifest
├── LICENSE                # required for redistribution; declared in licenseFiles
├── preview.png            # optional, shown in the pack manager (PNG/JPEG/WebP)
└── clips/                 # animation clips
    ├── idle/
    │   ├── idle_001.webp
    │   ├── idle_002.webp
    │   └── …
    └── thinking/
        └── …
```

Two layouts are supported for clip directories:

- **`clips/<name>/`** — the layout used by bundled packs; declare it with the
  clip's `dir` field (`"dir": "clips/idle"`).
- **`<name>/`** — flat layout; omit the `dir` field (it defaults to the clip
  name).

Frame files must follow the naming convention `<clip-name>_<3-digit
counter>.webp`, starting at `001` with no gaps up to the declared `frames`
count.

## Manifest schema (`pet-pack.json`)

```jsonc
{
  "formatVersion": 1,
  "id": "mypet",                       // required: /^[\w-]{1,64}$/, unique across installed packs
  "name": "我的宠物",                   // required: display name
  "nameEn": "My Pet",                  // required: ASCII fallback name
  "author": "you",                     // required
  "version": "1.0.0",                  // required
  "license": "MIT",                    // required
  "licenseFiles": ["LICENSE"],         // recommended: files to show for provenance
  "description": "optional description",
  "baseWidth": 412,                    // required: design width of one frame (px)
  "baseHeight": 344,                   // required: design height of one frame (px)
  "fps": 24,                           // required: 1–60
  "clips": {
    "idle":     { "dir": "clips/idle", "frames": 241, "loop": true },
    "thinking": { "dir": "clips/thinking", "frames": 120, "loop": true }
  },
  "preview": "preview.png",            // optional: preview image for the pack manager
  "defaultAnimation": "idle",          // optional: clip used when a state has no mapping/chain match
  "agentStateMapping": {               // optional: explicit state → clip overrides
    "thinking": "thinking",
    "failed": "error"
  }
}
```

### Clip constraints

| Constraint | Limit |
|---|---|
| Clips per pack | 64 |
| Frames per clip | 1024 |
| Frame format | WebP only (`RIFF…WEBP` magic verified on import) |
| Frame size | 32 MB per file |
| Pack total | 200 MB |
| ZIP entries | 2000 |

## State → clip resolution

Agent states (`idle`, `thinking`, `running`, `tool-calling`, `coding`,
`waiting`, `review`, `success`, `failed`, `warning`, `sleeping`) resolve to a
clip in this order:

1. `agentStateMapping[state]`, if declared and the clip exists;
2. the built-in fallback chain for the state, e.g.
   `thinking → working → idle`, `tool-calling → working_command → working_search
   → working → idle`, `success/error → idle`;
3. `defaultAnimation`, if declared and the clip exists;
4. the `idle` clip;
5. the first declared clip.

A pack with a **single `idle` clip is fully functional** — every state
degrades to it.

Recognized clip names: `idle`, `idle_stretch`, `idle_yawn`, `thinking`,
`working`, `working_command`, `working_search`, `waiting`, `success`, `error`,
`sleeping`, plus custom names via `agentStateMapping` / `defaultAnimation`.

## Importing

**Settings → Desktop Pet → Pet Packs → Import**, then choose a `.zip` file or
a local folder. Importing never enables the pet — it only installs the pack.
Installing a ZIP with the same pack id as an existing user pack **updates**
that pack (the previous version is backed up and restored if the new one fails
validation).

Switching packs applies live: the pet window swaps to the new pack without a
restart. If the active pack is uninstalled, the pet falls back to the bundled
BigFish.

## Security model

Pet packs are untrusted input. The importer is fail-closed:

- **No code execution** — packs are data only (JSON manifest + WebP frames +
  images). Nothing inside a pack is ever executed or rendered as HTML.
- **ZIP Slip is impossible** — entry names may not be absolute, contain `..`
  segments, backslashes, drive letters or NUL bytes. Everything extracts
  strictly inside the pack directory.
- **Symlinks and special files are rejected** in both ZIPs and folder imports.
- **Encrypted and unsupported-compression ZIP entries are rejected** (only
  `stored` and `deflate`).
- **Decompression bombs are bounded** by per-file size, total size, entry
  count and compression-ratio limits checked before inflating.
- **Every frame's bytes are verified** as real WebP; the preview image is
  verified as PNG/JPEG/WebP.
- **The bundled BigFish pack is protected**: it can never be overwritten,
  replaced (including case-insensitive id collisions like `BigFish`) or
  uninstalled.
- **TOCTOU-resistant installs** — packs are staged, validated, then moved with
  atomic renames; re-validation runs after landing.

## Compatibility with the bundled schema

The bundled BigFish `pet-pack.json` uses the same schema this document
describes (including the `clips/<name>/` layout via the `dir` field). Third
party packs that omit `preview`, `defaultAnimation` and `agentStateMapping`
are valid — the pet falls back to the shared state chain and the `idle` clip.
