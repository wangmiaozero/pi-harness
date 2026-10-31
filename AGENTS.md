# Agent instructions

Every AI agent must read the project AI documents before starting repository work, including after a session restart or context handoff. A summary is not a substitute for reading the current instructions.

Read these documents in order:

1. `task/internal/agents/AGENTS.md`
2. `task/internal/agents/CONTRIBUTING.md`
3. `task/internal/docs/engineering-governance.md`
4. The relevant domain documents linked from that governance document.

Codex and GPT desktop agents must also read `task/internal/agents/codex-gpt-desktop.md` and follow its minimal-verification and stop rules.

For release, packaging, installation/upgrade, or native CI work, also read `task/internal/docs/release-workflow.md` and `task/internal/docs/release-reliability.md` before acting.

These local documents are intentionally excluded from Git. If they are missing or unreadable, report the missing context before making changes or performing release operations; do not silently skip them or invent their contents. Follow the applicable instruction hierarchy and report any conflicting requirement before a consequential action.

Keep local AI rules and incident details under `task/`; never force-add them or create a public `CONTRIBUTING.md`. Historical task records are context, not new authorization.
