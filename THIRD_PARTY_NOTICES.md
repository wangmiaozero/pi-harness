# Third-party notices

Pi-Harness original code is licensed under the terms in [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Third-party projects and dependencies remain subject to their own licenses.

## Archify

- Project: [tt-a1i/archify](https://github.com/tt-a1i/archify)
- Version: 3.0.1; commit `58ab0b98d2d0def8e49dced705c7b566936723ec`.
- Copyright: Copyright (c) 2026 tt-a1i (Archify); Copyright (c) 2025 Cocoon AI.
- License: MIT; the full license is distributed at `archify/LICENSE` in packaged applications.
- Used as: the local architecture renderer and interactive HTML viewer. The optional brand icon catalog is omitted; no brand icons are distributed.
- The embedded JetBrains Mono font is licensed under SIL Open Font License 1.1. Its notice is preserved in the template and at `archify/assets/JetBrainsMono-OFL.txt`.

Project analysis also uses `ignore`, `typebox`, Vue's SFC compiler, Babel's parser and types under MIT, and `jsonc-parser` under MIT. Their license files are retained with the packaged dependencies.

TOML metadata parsing uses [smol-toml](https://github.com/squirrelchat/smol-toml) 1.9.1 under BSD-3-Clause. Its full license is retained with the packaged dependency.

Pi-Harness is inspired by the following MIT-licensed project:

## Pi Web

- Project: [agegr/pi-web](https://github.com/agegr/pi-web)
- License: MIT
- Used as: reference implementation for Agent Workspace session lifecycle, streaming events, tool-call normalization, path security, git worktrees, and session JSONL compatibility.

Pi-Harness does not embed the Pi Web Next.js/React application. Agent execution uses the official Pi Coding Agent.

## Matt Pocock Skills

- Project: [mattpocock/skills](https://github.com/mattpocock/skills)
- Copyright: Copyright (c) 2026 Matt Pocock
- License: MIT
- Used as: the read-only "Skills For Real Engineers" collection bundled with Pi-Harness. Each Skill is installed into Pi only after an explicit user action.

The original license text is distributed with the collection at `builtin-skills/mattpocock/LICENSE` in packaged applications.

## Emil Kowalski Skills

- Project: [emilkowalski/skills](https://github.com/emilkowalski/skills)
- Copyright: Copyright (c) 2026 Emil Kowalski
- License: MIT
- Used as: bundled Skill content, installed into Pi only after an explicit user action.

The original license text is distributed with the collection at `builtin-skills/emilkowalski/LICENSE` in packaged applications.

## Agent Aura

- Project: [wangmiaozero/agent-aura](https://github.com/wangmiaozero/agent-aura)
- Copyright: Copyright (c) 2026 wangmiao
- License: MIT
- Used as: WebGL2 animated glow effect for active Agent states.
- Attribution: Agent Aura's Glow engine is adapted from
  [gaomeng1900/ai-motion](https://github.com/gaomeng1900/ai-motion),
  Copyright (c) 2025 Simon <gaomeng1900@gmail.com>.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Claude Code History Viewer

- Project: [jhlee0409/claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer)
- Version: 1.31.0; commit `acdfaea9b05f3c4393086494a9e8e00716ad438a`.
- Used as: the reference and adaptation source for local conversation format parsing and discovery algorithms.
- License: MIT. No Tauri or React application is embedded.

MIT License

Copyright (c) 2025 JaeHyeok Lee

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Pi and Node.js distributions

- Pi Coding Agent 1.3.0: [earendil-works/pi](https://github.com/earendil-works/pi), MIT, Copyright (c) 2025 Mario Zechner. The complete license is retained with the distributed Pi files.
- Node.js 24.22.0 (npm and npx 11.19.1): [nodejs/node](https://github.com/nodejs/node), Node.js license and its bundled third-party notices. The complete upstream LICENSE, including npm and other bundled components, is retained with the distributed Node.js files.
- ZIP extraction uses [unzipper](https://github.com/ZJONSSON/node-unzipper) under MIT; the dependency license is retained in packaged applications.
