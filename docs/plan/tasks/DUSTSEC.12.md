---
task: DUSTSEC.12
title: "Shim runs no compression (D56(c)) — SHIM_POLICY stops being policyFor(1)"
state: queued
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md C2 (USER, 2026-10-08); spec Decision 56(c); DUST1.1 #5"
gate: "Probe: a shim build forwards a body that level-1 dedup/compaction would have rewritten, with only redaction applied (before: level-1 rewrites). A secret in a shim request is still redacted. golem verify green by exit code."
touches: [src/cli/proxy-runtime.ts, tests]
created: 2026-10-08
---

## What this is

`const SHIM_POLICY = policyFor(CompressionLevel.Lossless)` (`src/cli/proxy-runtime.ts:48`, used at
`:203`) contradicts D56(c) "no compression"; the banner and three comments already side with D56.

**USER decision (verbatim, C2):** shim code follows D56(c): no compression (change
`SHIM_POLICY = policyFor(1)`).

## The work

1. Set the shim policy to the no-compression level. **Verify first** that the off level keeps the
   redaction stage on (ADR-0004: compression off ≠ redaction off). If `policyFor(off)` disables
   redaction, do NOT use it — build the shim policy as redaction-only and report the finding.
2. Align the three comments and the banner.
3. Tests per the gate.

## Hard rules

- Redaction never weakened: the shim still redacts.

## Out of scope

- Shim feature work; D56 doc text (DUST2.2).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.
