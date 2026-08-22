# Mock fixtures

Used when developing without a real Pi install.

| Path                                 | Purpose                     |
| ------------------------------------ | --------------------------- |
| `mock-pi/models.json`                | Sample providers + models   |
| `mock-pi/settings.json`              | Sample active model pointer |
| `mock-pi/skills/demo-skill/SKILL.md` | Sample skill                |

Point Settings → Manual config directory at `fixtures/mock-pi` (absolute path),
or set env `PI_HARNESS_PI_CONFIG_DIR` to that folder.

`mockMode` in app settings remains a UI flag for future fixture auto-wiring;
fixtures themselves are real JSON files you can load via manualConfigDir today.
