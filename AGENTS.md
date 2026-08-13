# Agent instructions

This file is required reading for every AI / coding agent working on this repository (Cursor, Claude, Codex, Copilot, and others).

## Authorship (non-negotiable)

The **only** author of this project is:

- Name: **wangmiao**
- Email: **tuziling84@gmail.com**
- Repository: **https://github.com/wangmiaozero/pi-switch**

AI systems are tools, not authors. They must never appear as author, co-author, committer, maintainer, or copyright holder.

### Do

- Git `user.name` / `user.email` stay `wangmiao` / `tuziling84@gmail.com`
- `LICENSE`, `package.json` `author`, README author blocks, and `electron-builder.yml` copyright stay wangmiao
- Commit messages contain only wangmiao as author

### Do not

```
Co-authored-by: Cursor <cursoragent@cursor.com>
Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: Copilot <...@users.noreply.github.com>
Co-authored-by: Codex <...>
Made-with: Cursor / Claude / Copilot / Codex
```

- Do not add `Co-authored-by` for any AI, agent, or tool
- Do not put Cursor Agent, Claude, Copilot, Codex, ChatGPT, Gemini, or similar in LICENSE, package.json, README, changelog, or git metadata
- If the environment injects an AI `Co-authored-by` trailer, strip it before the commit is pushed (rewrite that commit; do not leave it on `origin/main`)

GitHub contributors must list **wangmiao only**.
