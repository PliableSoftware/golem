---
task: DUSTSEC.7
title: "Stop exporting the mutable REDACTION_RULES — freeze it or hand out a copy"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R5 (USER, 2026-10-08); SUMMARY.md Gaps 1.1/r028; DUST1.1 contradiction #8"
gate: "Probe: code that imports the rule table and tries to push, splice or replace an entry (or mutate a rule object's pattern) cannot change what the next redaction call does — before the fix it could. Built-ins stay first and in order. golem verify green by exit code."
depends_on: []
touches: [src/pipeline/redaction-rules.ts, src/pipeline/redaction.ts, src/pipeline/index.ts, src/hooks, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:10.989Z
---

## What this is

ADR-0005 claims "Yes, structurally" a plugin cannot weaken the built-ins, but
`export const REDACTION_RULES: readonly RedactionRule[]` (`src/pipeline/redaction-rules.ts:104`)
is `readonly` only at the type level — the array and its rule objects are mutable at runtime.

**USER decision (verbatim, R5):** stop exporting the mutable `REDACTION_RULES` (freeze or export a
copy); reword ADR-0005 "structurally" to "cannot via the API; a plugin has process authority
anyway". The ADR wording is DUST2.3's job; this task is the code.

## The work

1. Consumers today: `src/pipeline/index.ts`, `src/pipeline/redaction.ts`, `src/hooks/web-fetch.ts`,
   `src/hooks/post-tool-use.ts`, `src/hooks/redact.ts` (grep again). Pick deep-freeze (array AND
   each rule object, including any RegExp state concerns) or a module-private table with a
   copy-returning accessor. Say which in the PR and why.
2. A regex with the `g`/`y` flag carries `lastIndex` — confirm freezing does not break any rule
   that relies on it (see DUSTSEC.6 for how that bites).
3. Tests: the mutation probes in the gate.

## Hard rules

- Redaction never weakened or reordered: rule order and content are byte-identical before/after.
- Prefix stability: redaction output for a fixed input must not change.

## Out of scope

- Plugin rules on other paths (DUSTSEC.8). ADR text (DUST2.3).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
