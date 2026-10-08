---
task: DUST2.18
title: "Dashboard: tokens saved/spent, cache hit rate and cost estimate on the dashboard itself"
state: queued
owner: agent
size: S
discipline: code
design: "spec §5 (as rebaselined by DUST2.2); SUMMARY.md Gaps 1.9/r002, r003, r004 (P); DECISIONS.md A6, T2"
gate: "The dashboard shows tokens saved/spent, cache hit rate and a cost estimate from the same sources as `golem stats --cache` / `golem bench cost`, labelled 'estimated' where chars/4; tests for the data path. golem verify green by exit code."
depends_on: [DUST2.10]
touches: [src/dashboard, src/cli, src/telemetry, tests]
created: 2026-10-08
---

## What this is

Roadmap gap. The data exists on `stats --cache` and `bench cost` but not on the dashboard
(DUST1.9 rows 2-4). Per-device utilization, canary quality-delta and `replay-eval` are NOT in
scope — A6 moved them to the spec's not-started register.
