# Resource Market

Pi-Harness keeps classic color themes in the application. Character themes and desktop pets are optional packs.

Open **Settings → Resource Market**. The market searches only `https://registry.npmjs.org` for packages whose names match:

```text
^@pi-harness/(theme|pet)-[a-z0-9][a-z0-9-]*$
```

Each package is installed, updated, and removed on its own. The installer downloads the registry tarball, checks its `sha512` integrity, rejects scripts, symlinks, and path traversal, then commits the files atomically.

Theme packs are stored in `<userData>/market/themes/<id>/`. Pet packs use the existing pet installer and are stored in `<userData>/petpacks/<id>/`. The local index is `<userData>/market/registry.json`.

The application starts without waiting for the registry. A saved theme or pet id is not cleared when its files are absent. The workspace uses the base appearance, and Settings says the pack still needs to be installed. Installing that pack restores it. Changing the selection yourself is kept.

Nothing is downloaded automatically.
