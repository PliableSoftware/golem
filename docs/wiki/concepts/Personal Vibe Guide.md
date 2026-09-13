---
title: Personal Vibe Guide
type: concept
tags: [vibe, personal-scope, skills, guidance, context-budget, redaction]
sources: [docs/plan/tasks/vibe-personal-style.md, src/vibe/, src/cli/commands/vibe.ts]
created: 2026-09-13
updated: 2026-09-13
---

# Personal Vibe Guide

A third style scope, below the project's and the team's: **how one human writes
code and prose**. Formatting, naming, comment density and shape, and the voice
they use in comments, commits and docs. It lives in the user's home directory,
follows them across every project, and is consulted automatically when an agent
authors code, prose or a review.

Related: [[Guidance Rules]] · [[Configuration Surfaces]] · [[Redaction Stage]] ·
[[Free and Team Tiers]] · [[Wiki-First Knowledge]].

## Where it lives

`~/.golem/vibe/` — the literal `~/.golem` user scope (spec Decision 19,
verification-notes §17), not an env-paths config dir.

| path | role | when it reaches context |
|---|---|---|
| `VIBE.md` | the brief: measured habits + voice | ALWAYS, on coding/writing/review turns |
| `guidelines/<topic>.md` | the detail behind one habit | on demand, one at a time |
| `snippets/<lang>/<id>.md` | exemplars with provenance | on demand |
| `candidates.jsonl` | observed but unconfirmed signals | never |
| `sources.json` | what the guide was seeded from | never |

**That split is the design.** Only the brief is paid for on every turn, and it is
capped at 4 KiB on write — truncated at a section boundary, since a half-stated
rule is worse than an absent one. Everything else is retrievable, so the guide
can grow for years without growing the prefix of every request. An agent that
bulk-reads `guidelines/` "for background" has defeated the whole mechanism.

## The gate

**Only a Golem-initialised project may read it.** `openVibeStore()` returns null
before touching the filesystem, so a directory that is not a Golem project
performs zero reads — not reads that happen to return nothing. The skill file
being present is NOT the gate: a `SKILL.md` is markdown and can be copied into
any repository.

One sharp edge, and the reason the gate is a function rather than a
`findProjectDir()` call: **the home directory is not a project.**
`~/.golem/settings.json` sits at exactly the path the project marker is looked
for, so an uncapped upward walk from anywhere under `~` finds it — which on a
developer machine is most of the disk. `isGolemProject()` rejects
`found === homedir` explicitly.

## Measured, not guessed

The seeder has no parser — deliberately, since no ML or native dependency may
enter the default install (`CLAUDE.md` hard rules). It counts line-level facts
it can prove: indent kind and width, quote preference, statement terminators,
line-width distribution, comment density and shape, identifier casing, and
whether files open with a header comment. Every rendered row carries its
evidence, so "98% of 4,100 lines" is visibly stronger than "60% of 12".

Two counting rules were bought with bugs, and both are the same mistake —
measuring the lines that are easy to count rather than the ones carrying signal:

- **Indentation is read from code lines only.** A JSDoc ` * ` continuation is
  indented one space, and in a well-commented file those are the majority.
- **Only lines where a terminator was a real choice count.** A bare `}` can never
  take a semicolon; counting it drags every file toward 50%.

## Generated versus human

`VIBE.md` has a generated block bounded by `<!-- golem:vibe-measured:begin -->` /
`:end`. A re-seed replaces that block wholesale and preserves every word outside
it verbatim. Measurements and stated preferences are different things, and the
file has to make which is which obvious — otherwise nobody trusts it enough to
write in it.

## Precedence

`project SOP > team standard > personal vibe`. Where a project's committed
conventions disagree, the project wins and the conflict is **surfaced**, never
silently resolved — the same rule the wiki follows for contradictions. The guide
informs new work; it is not a formatter and never reformats existing code.

## Redaction

Every byte written to the guide is derived from the user's real source files, so
it passes through the pipeline redactor BEFORE the write, never after. There is
no window in which unredacted text exists on disk.

## Surfaces

- `golem vibe show` — the brief, as a turn sees it
- `golem vibe seed <path...>` — measure from files or projects the user names
- `golem vibe sources` — what it was seeded from, with dates
- `golem vibe path` — where it lives on this machine
- `/vibe` — the skill: the same verbs plus `quiz`, which is the only surface
  allowed to write a *stated* preference, because it is the only one that can ask
- the `vibe` guidance rule — seeded by `golem init`, always in context, which is
  what makes the guide passive rather than something to invoke

`/vibe` is the one skill installed WITHOUT the `golem-` prefix, so
`init-skills.ts` carries an `UNPREFIXED_SKILLS` allowlist. Widening the prefix
glob instead would hand Golem authority over directories the user or a team
created — `.claude/skills/` is shared.

## Not yet built

Capture. A PostToolUse hook records what the agent wrote and the file watcher
sees the user's own edit that follows; the delta between those two is a
*correction*, the strongest style signal there is, and a hook alone cannot see it
because the user's edits are not tool calls. Candidates accumulate in
`candidates.jsonl` and `/vibe quiz` promotes the ones seen more than once.
