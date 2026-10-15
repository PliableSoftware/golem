---
task: DUSTSEC.3
title: "PreToolUse denies agent Bash that runs `golem off` or sets `bypass_all`; skill says exactly what is enforced"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R4 (USER, 2026-10-08); SUMMARY.md Gaps 1.1/r092; DUST1.1 row 'CLI-only: a tool call cannot set it'"
gate: "A PreToolUse Bash payload running `golem off`, `golem proxy … bypass`, or a config write setting `proxy.bypass_all` (direct `golem config set`, or an edit of a settings file) is denied with a reason naming bypass_all — before the fix it was allowed. A plain `golem status` is not denied. The skill text matches the enforcement. golem verify green by exit code."
depends_on: [DUSTSEC.2]
touches: [src/hooks/pre-tool-use.ts, src/autonomy, src/cli/skills/basics.ts, .claude/skills/golem-bypass/SKILL.md, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:08.864Z
---

## What this is

ADR-0004 says `bypass_all` is CLI-only, but an agent's Bash tool can run `golem off` today
(`src/mcp/deps.ts:31` blocks only the MCP setter; DUST1.1 row "CLI-only", P). The skill tells the
model "no tool call can turn redaction off" (`src/cli/skills/basics.ts:83`), which is not true.

**USER decision (verbatim, R4):** a PreToolUse hook DENIES agent Bash that runs `golem off` or
sets `bypass_all`; reword the skill to say exactly what is enforced.

## The work

1. Find every CLI spelling that turns `bypass_all` on (`golem off`, any `proxy` subcommand,
   `golem config set proxy.bypass_all …`). Enumerate them from `src/cli/commands/`, not memory.
2. Add the deny in the PreToolUse path (`src/hooks/pre-tool-use.ts`). It must hold at EVERY
   autonomy level including `manual` and independent of the autonomy gate being enabled — this is
   a redaction guard, not an autonomy rule. Match robustly: leading env assignments, `npx`,
   chained commands (`;`, `&&`, newline — see DUSTSEC.5 for the newline lesson).
3. Decide and document what is NOT caught (e.g. a Write/Edit to a settings JSON, an obfuscated
   shell). Either catch the settings-file write too, or say plainly in the skill that it is not
   enforced. The skill must claim no more than the hook enforces.
4. Reword the skill source and regenerate.

## Hard rules

- Never emit `allow`; a failure in the new check exits with no decision (native flow), never a silent allow of a bypass.
- Redaction never weakened.

## Out of scope

- The removed endpoint/header (DUSTSEC.2).
- The general classifier (DUSTSEC.5).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
