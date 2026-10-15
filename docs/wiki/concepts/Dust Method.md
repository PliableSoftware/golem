---
title: Dust Method
type: concept
tags: [dust, method, audit, rebaseline, refactor, docs-drift, review]
sources: [src/cli/skills/dust.ts, docs/plan/audit/dust-1/DECISIONS.md, docs/plan/audit/dust-1/SUMMARY.md, docs/plan/tasks/DUST4.3.md]
created: 2026-10-08
updated: 2026-10-08
---

# Dust Method

A shake-out for a project whose docs and shipped code have drifted apart after
heavy development: find where they disagree, make the docs true, then clean the
code. It ships as the user-invoked skill `/golem-dust`, which is the canonical
step list (`src/cli/skills/dust.ts`). This page explains why the steps are what
they are; it does not restate them.

## When to use it

- After a long stretch of fast building, when the spec, wiki and task docs no
  longer match what the code does.
- Before a push that builds on the docs (a first release, an onboarding, an
  external audit).

It is not a code review and not a release gate. It audits claims against code;
it does not judge whether the code is good.

## The phases

Each phase starts only when the human has accepted the one before.

1. **Audit (read-only).** Partition by subsystem, one note and one branch per
   partition, each in its own worktree and run in parallel. Every documented
   claim is classified (matches, drifted, partial, not started, contradicted)
   with `path:line` evidence. The summary's counts are recounted from the
   tables, never added up from the notes' own headers. Contradictions are
   listed for the human; HIGH security items are flagged for a fix outside the
   refactor.
2. **Rebaseline.** Wiki and spec follow the verified code. Decision text is
   never rewritten; a dated note is added. Every gap gets a task doc or is
   retired (see [[Plan Tasks]]).
3. **Refactor.** Re-verify every audit item against current code first, then
   fix and delete, with independent review on every hard-rule change.

## The default rule

Between the audit and the rebaseline the human settles the listed
contradictions. Everything else follows one rule: **the doc follows the shipped
code, unless the item touches security, a hard rule or a recorded user
decision.** Every choice made under it is recorded (id, outcome, task) so any
can be overturned, and the exceptions stay OPEN and named. This repo's record is
`docs/plan/audit/dust-1/DECISIONS.md`; the rule exists so that most drift is
resolved without a meeting, and the risky items are never resolved by default.

## What this repo learned

Review lessons, from this project's one run:

- Authors' green tests prove the new test passes, not that nothing got weaker.
  Independent review of the hard-rule branches caught problems the authors'
  tests missed (redaction weakenings, a credential leak, a review-gate bypass),
  and some fix rounds introduced a new defect, so review again after fixes. The
  redaction rule most of the risk sat on is in [[Redaction Stage]].
- The audit is wrong in places. Re-check a claim against the code before acting
  on it.
- Verify serially. Parallel typechecks were killed for memory (exit 137), which
  made the agents' own "before" baselines unreliable.
- A no-behaviour-change pass needs machine evidence (comments stripped and
  strings masked in base and head, then compared); defects found on the way are
  filed, not fixed in that pass.
- Land code-comment passes before docs cite line numbers, or cite a symbol too.
  Otherwise the anchors shift.
- A passing checker is not a complete one: `golem wiki check` did not flag
  unlisted pages that were not debriefs.
- A rename is not done when the code compiles; the prose, comments, tests and
  done-task gates are swept too (see [[Guidance Rules]] for how working
  practices are kept in rule files rather than prose).

Numbers from this project's run, dated, not expected results:

- Phase 1 (2026-09-26): eleven audits, 800 table rows, 791 classified, 436
  matches, 194 drifted; five HIGH security items flagged.
- Phase 2 (2026-10-08): spec rebaselined to v1.33; a sampled fact-check found 54
  of 58 claims true.
- Phase 3 (2026-10-08): 63 confirmed bugs fixed and 12 safe deletions after 52
  audit items failed to reproduce; 25 dead-code proposals left for the user.

The three debriefs, by filename under `docs/wiki/debriefs/`:

- 2026-09-26-DUST1.12-dust-phase-1-audit.md
- 2026-10-08-DUST2-rebaseline.md
- 2026-10-08-DUST3-refactor.md

## Limits

It has been run once, here, on one project. Nothing on this page is evidence
that the method transfers or that the default rule picks right outside this
repo's hard rules. The skill carries a debrief template so later runs can be
compared. Phases 4 and 5 of the initiative were not started at the time of the
third debrief.
