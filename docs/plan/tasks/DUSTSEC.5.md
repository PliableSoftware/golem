---
task: DUSTSEC.5
title: "Autonomy classifier: newline-chained commands are never `read`; fix the destructive over-approvals"
state: done
owner: agent
size: S
discipline: code
design: "SUMMARY.md S5; DUST1.7 row 19; ADR-0002 ('unknown is never auto-allowed')"
gate: "classifyAction(\"ls\\nnode -e …rmSync…\") and the \\r variant are not `read` and decideGate does not `allow` them at `assisted` (before: read/allow). `git branch -D main`, `npx biome check --write .` and `git diff --output=<path>` are no longer `read`. New newline/CR test cases exist (there were zero). golem verify green by exit code."
depends_on: []
touches: [src/autonomy/classify.ts, tests/unit/autonomy]
created: 2026-10-08
updated: 2026-10-08T10:26:09.925Z
---

## What this is

Out-of-band HIGH fix (no contradiction; confirmed defect). `SHELL_COMPOSITION_RE`
(`src/autonomy/classify.ts:107`, `/[;&|>`]|\$\(/`) has no `\n` or `\r`, and `^ls(\s|$)` matches
`ls\n<anything>`, so a newline-chained command classifies as `read` and gets `allow` at a
non-`manual` level — an arbitrary-command bypass of the gate.

## The work

1. Add `\n` and `\r` to composition detection; check whether other read patterns anchor with
   `\s` in a way that lets a newline through.
2. Reclassify the three over-approvals (SUMMARY S5): `git branch -D`, any `--write`/`--fix`
   linter flag, `git diff --output=`. Look for siblings of the same shape (flags that write).
3. Tests: one per probe in the gate, plus a table of newline variants.

## Hard rules

- Misclassification may only escalate, never de-escalate (ADR-0002).
- No allow path added.

## Out of scope

- R8's conditional `PermissionRequest` deny (DUSTSEC.10).
- The `golem off` deny (DUSTSEC.3).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
