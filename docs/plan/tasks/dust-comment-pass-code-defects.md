---
task: dust-comment-pass-code-defects
title: "Two behaviour defects the Dust comment pass found but left alone: session-report invents compression level 1, and spawn-failure detection is unreachable"
state: queued
owner: agent
size: M
discipline: code
design: "Found by DUST2.10 (2026-10-08), which was strings-and-comments only. H5 (audit row 1.9/r066): src/cli/session-report.ts:176 does `golem?.compression ?? 1`, so when state collection fails the report states compression level 1 as if it were real, a made-up value in an honest-observability surface. r030 (audit row 1.7/r030, spawnResume failure detection): the failed check in spawnResume is unreachable, so a failed spawn is not detected; only its comment was corrected."
gate: "Each defect has a regression test that fails on the current code and passes after: when state collection fails the report says the level is unknown rather than 1, and a failed spawnResume is detected and surfaced; golem verify exit 0."
depends_on: []
touches: [src/cli/session-report.ts, src/session, tests]
created: 2026-10-08
---

## What this is

Two real defects, kept out of a no-behaviour-change pass on purpose. Read the SUMMARY.md Phase 3 inputs rows for H5 and r030 first, and re-confirm each against the code before changing it; the audit may have drifted.

## Out of scope

- The rest of the Phase 3 confirmed-bug list (separate tasks).

## Outcome (2026-10-09, branch fix/dust-comment-pass-defects)

Both defects re-confirmed against the code, fixed at the root, regression tests fail-first.

**H5, `src/cli/session-report.ts`**
- Before: `collectState` rejects, report says `compression: {level: "1", name: "lossless"}`, a value nothing read.
- After: `{level: "unknown", name: "unknown"}`. Schema unchanged (`level` is already `z.string()`), no `src/interfaces/` change. `golem watch` renders a single `unknown` rather than `unknown unknown`.
- Test: `tests/unit/cli/session-report.test.ts`, "degrades to safe defaults when the liveness collector fails".

**r030, `spawnResume` in `src/cli/task.ts`**
- Before: the `failed` check ran before Node emits `'error'`, so it was dead code. A launch failure was only caught by the missing-pid fallback, so the user saw "spawn produced no pid" and never the OS error (ENOENT/EACCES). `golem task resume --spawn` also marked the task `running` after a failed launch.
- After: `spawnResume` is async and resolves on the first of `'spawn'` / `'error'`. A failed launch returns `spawned: false` with `spawn failed: <OS message> — run it manually`. Still an argument array, no shell, no behaviour change for a successful launch. `golem task resume --spawn` leaves the state untouched on failure (attempts still increments).
- Test: `tests/unit/cli/task.test.ts`, `describe("spawnResume")`. The command-level state change is not covered by a test.

**Same-pattern grep**: no other `let failed` / synchronous read of an async `'error'` flag in `src/`; the other `?? 1` compression hits are `init` defaults, not fallbacks for a failed read.
