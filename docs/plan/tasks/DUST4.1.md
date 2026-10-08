---
task: DUST4.1
title: "Write the /golem-dust skill: audit, rebaseline and refactor as one distributable SKILL.md, registered in P0_SKILLS"
state: done
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/PLAN.md (Phase 4); lessons from the three Dust debriefs in docs/wiki/debriefs/ (2026-09-26-DUST1.12-dust-phase-1-audit.md, 2026-10-08-DUST2-rebaseline.md, 2026-10-08-DUST3-refactor.md) and the default rule in docs/plan/audit/dust-1/DECISIONS.md. Mechanism: src/cli/skills.ts (P0_SKILLS), src/cli/skills/*.ts (one module per group), src/cli/init-skills.ts (install)."
gate: "src/cli/skills/dust.ts exports DUST_SKILLS with one key `dust`, spread into P0_SKILLS; a unit test asserts every required lesson below is present by a stable marker; tests/contract/skills-tools-layering.contract.test.ts passes with no new layering exception unless it carries a real reason; golem verify exit 0."
depends_on: []
touches: [src/cli/skills/dust.ts, src/cli/skills.ts, tests/unit/cli/skills.test.ts]
created: 2026-10-08
updated: 2026-10-08T23:21:52.409Z
---

## What this is

Package the Dust method (Phases 1-3 of `docs/plan/audit/dust-1/PLAN.md`) as one skill, `/golem-dust`, so any Golem-managed project can run the same shake-out. Phases 4 and 5 of the original plan are this project's packaging and marketing, not part of the method, and stay out of the skill.

## Where it plugs in (verified 2026-10-08)

The PLAN says "generated into `.claude/skills` the same way the `golem-*` rules generate from `src/hooks/guidance.ts`". That is not quite how the code is split, and the brief follows the code:

- `src/hooks/guidance.ts` generates **rules** (`.claude/rules/golem-<name>.md`), loaded into context every session.
- **Skills** come from `src/cli/skills/*.ts`, each group exporting a `Record<string, string>` that `src/cli/skills.ts` spreads into `P0_SKILLS`. `installSkills` in `src/cli/init-skills.ts` writes each one to `.claude/skills/golem-<cmd>/SKILL.md`, hash-managed through `src/cli/managed-files.ts` (an edited file is reported as a conflict and kept).

So the smallest change is one new module, `src/cli/skills/dust.ts`, exporting `DUST_SKILLS = { dust }`, plus one spread line in `src/cli/skills.ts`. No new generator, no guidance rule. A rule would cost context on every turn of every session for a method run a few times a year.

Name: `dust`, which installs as `.claude/skills/golem-dust/SKILL.md` and is typed `/golem-dust`. Do not add it to `UNPREFIXED_SKILLS`. Frontmatter `invocationMode: user` (22 of the 23 shipped skills use it; this one must never fire on its own).

## Skill content

One `SKILL.md`; the install writes a single file per skill, so there are no supporting files. Shape it on `firstPancake` in `src/cli/skills/hygiene.ts` (a long, phased, user-invoked method). Sections:

1. **When to run it**: after heavy development, when docs and code have drifted. Not a code review and not a release gate.
2. **Phase 1, audit (read-only).** Partition by subsystem; one note per partition, one branch per partition; each in its own `git worktree` and run in parallel; classify every documented claim M/D/P/N/X with `path:line` evidence; a close-out step merges the notes and writes a SUMMARY whose counts are **recounted mechanically from the tables**, never added up from the notes' own headers; contradictions are listed for the human, not resolved; HIGH security items are flagged for an out-of-band fix before the refactor.
3. **Decisions record.** The human decides the listed contradictions. Everything else follows the DEFAULT RULE: *doc follows shipped code, unless the item touches security, a hard rule or a recorded user decision*. Every choice made under it is listed (id, outcome, task) so any can be overturned; the exceptions are left OPEN and named.
4. **Phase 2, rebaseline.** Wiki and spec follow the verified code with `path:line` citations; decision text is never rewritten, it gets a dated note; open contradictions get their own section; every partial or not-started gap gets a task doc or is retired. Land code-comment passes before docs cite line numbers, or cite a symbol as well as a line.
5. **Phase 3, refactor.** First **re-verify every audit item against the current code**; items that no longer reproduce are dropped with a note. Propose removals before deleting; anything touching public config, CLI, MCP, plugin or interface surface is a proposal for the human, not a deletion. A no-behaviour-change pass needs **machine evidence**: strip comments and mask string contents in base and head, then compare.
6. **Review and verification.** Every change that touches a hard rule gets an independent read-only review before merge, and a second round when the first found anything, because fix rounds introduce new defects. Run the project's verify **serially** before merging: parallel typechecks get killed for memory (exit 137) and make "before" baselines unreliable. Never merge on a CI result for an older head than the one pushed.
7. **Standing rules for every agent in the run.** Commit early on your own branch; park at a usage limit with a note rather than stopping (`/golem-park`); never commit redaction placeholders (check bytes before quoting anything read through the proxy); no attribution trailers in committed content unless the project asks for them; never hand-resolve a generated file.

Name the project's own commands generically ("the project's verify command", "the task index") and point at Golem's equivalents (`golem verify`, `golem task index --write`) as the Golem-managed default. The skill must work in a project that has no `docs/golem-spec.md`: say "the spec or design doc", "the wiki or docs tree".

## Constraints the text must satisfy

- `tests/contract/skills-tools-layering.contract.test.ts` fails a skill that shells out to `golem <verb>` when an MCP tool covers the verb (`search`, `fetch`, `wiki_read`, and so on). Call the tool, or declare `<!-- golem:layering-exception <verb> — <reason> -->` with a reason over 20 characters.
- The body is a TypeScript template literal: escape every backtick and `${`.
- Do not write a literal redaction placeholder in the skill, not even as an example to grep for. Describe the shape in words ("the proxy's bracketed REDACTED marker"). A literal one in committed source is exactly what the lesson forbids.
- Do not quote the bypass-off command. The PreToolUse guard (DUSTSEC.3) matches its text in Bash, and the skill has no reason to name it.

## Tests

Extend `tests/unit/cli/skills.test.ts`: `P0_SKILLS.dust` exists; frontmatter has `description` and `invocationMode: user`; one assertion per required lesson (re-verify, worktree partition, read-only parallel, default rule with every choice listed, independent review twice, strip-and-compare, serial verify, stale CI gate, park, placeholders, trailers), each matched by a short stable phrase so a later wording pass does not silently drop one.

## Out of scope

- Any change to `installSkills`, `managed-files.ts` or init seeding (DUST4.2).
- A guidance rule for Dust. Revisit only if the dogfood (DUST4.4) shows agents fail to find the skill.
- A per-skill opt-out toggle.
- The debrief template section (DUST4.3 adds it).
- Wiki, README and spec text (DUST4.3).

## Outcome

shipped; see the Phase 4 and 5 debrief
