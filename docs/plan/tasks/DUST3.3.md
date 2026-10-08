---
task: DUST3.3
title: "Pipeline redaction correctness: re-redact after in-place plugin mutation, make connection-password idempotent, refuse zero-length plugin rules, bound plugin problems, log the held stage"
state: queued
owner: agent
size: M
discipline: code
design: "SUMMARY.md S8, S10 and 'Functional, medium' DUST1.1 rows; DUST1.1 notes h4, h6; ADR-0005; DUST2.23 (defers S9/S10 to Phase 3); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop; recorded-shape tests for level <= 1 unchanged."
depends_on: []
touches: [src/pipeline/pipeline.ts, src/pipeline/redaction.ts, src/pipeline/redaction-rules.ts, src/plugins/loader.ts, tests]
created: 2026-10-08
---

## What this is

Confirmed redaction-path defects that still reproduce on 2026-10-08. **Hard-rule area:**
redaction is never weakened or reordered; every change here may only make redaction stronger
or more stable. Write the failing test first for each item.

Work in your own worktree (`git worktree add ../golem-dust3-3 -b dust3-3 development`), commit
each fix as it goes green.

## The work

1. **S8: in-place plugin mutation skips re-redaction** (`src/pipeline/pipeline.ts:604-631`).
   Re-redaction runs only when a stage returns a new object (`next !== body`). A stage that
   mutates `body` in place leaves `touched` false, and a later stage that marks the request
   changed forwards the raw secret. Fix: re-redact after any plugin stage ran, or hand the
   stage a clone. Test: a plugin that mutates in place and injects a secret-shaped string; assert
   the forwarded body holds a placeholder.
2. **S10: `connection-password` re-matches its own placeholder** (`src/pipeline/redaction-rules.ts:190-196`).
   The `[^\s@/]+` group matches `[REDACTED:connection-password:N]`, so a second pass renumbers
   it. That breaks idempotency and prefix stability. Fix: exclude the placeholder shape from the
   group. Test: `redact(redact(x)) === redact(x)` for a connection string; property-style over
   every built-in rule.
3. **Zero-length plugin regex** (`src/plugins/loader.ts:222`; `src/pipeline/redaction.ts:95-119`).
   A rule like `/x*/g` inserts a placeholder at every position. Fix: reject a pattern that matches
   `""` at load (reported as a problem), and skip empty matches in `applyRule`. Test both.
4. **Unbounded plugin `validate` problems** (`src/plugins/loader.ts:249-254`). Each throw is
   pushed for the life of the process. Fix: dedupe by rule and message, keep a count. Coordinate
   with DUST2.11 (plugin diagnostics, same file): if it has landed, build on its counter.
5. **Held-request log omits its stage** (`src/pipeline/pipeline.ts:567` vs `:583`).
   `reportHeldRequest` runs before the `finally` sets `stageMs["local-answer"]`. Test the logged
   record names the stage.
6. Once 2 lands, the idempotency comments become true. Re-check them: `src/pipeline/redaction.ts:20`,
   `src/pipeline/redaction-rules.ts:16`, and the "Redaction is idempotent (placeholders are outside
   every rule's charset)" comment near `pipeline.ts:596`. Keep them only if a test proves the claim.

## Hard rules

- Redaction never weakened or reordered. No dial or plugin problem may disable built-ins.
- Lossless and prefix-stable at level <= 1: run the DUST2.24 recorded-shape suites.

## Out of scope

- S9 (object keys never redacted): NEEDS-USER design call, see `[REDACTED:high-entropy:3].md`.
- h9 path-like tokens with `=`/`+` and a policy that cannot represent redaction-off: DUST2.23.
- Whole-body `JSON.stringify` re-serialisation: settled by decision C1 / DUST2.24.
- Plugin diagnostics UX (counts, regex-hang heuristic): DUST2.11.
