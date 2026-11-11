# Modifications

Copied from https://github.com/pbakaus/impeccable, `.claude/skills/impeccable/`, version 4.8.2, commit ec229b48547f24685ffb22aa51c462c5ae27908c (Apache-2.0; LICENSE and NOTICE.md from the repository root are included).

Changes in this copy:

- `scripts/` removed: the engine launcher (`impeccable`, `impeccable.cmd`), its checksum manifest and the live-mode browser scripts. The launcher downloads and runs a prebuilt binary on first use.
- `SKILL.md`, Setup: step 1 replaced with instructions to work without the engine; the "Launcher unavailable" paragraph removed.
- The project hooks (`.claude/settings.json`) and sub-agents (`.claude/agents/`) of the upstream repository are not included.

All files under `reference/` are unchanged.
