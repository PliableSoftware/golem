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
