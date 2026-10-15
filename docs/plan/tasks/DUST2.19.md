---
task: DUST2.19
title: "Hosted sessions: surface remote-authored turns locally, park at the usage limit, interrupt from the device"
state: queued
owner: agent
size: M
discipline: code
design: "ADR-0007; wiki Hosted Session; SUMMARY.md Gaps 1.10/r018, r020, r021 (P)"
gate: "A remote-authored turn is visibly marked in the local session view; a hosted session parks at the usage limit like any other (snooze path, note filed); a device can interrupt a running turn and the turn resolves cancelled; tests for each. golem verify green by exit code."
touches: [src/session, src/hooks, tests]
created: 2026-10-08
---

## What this is

Roadmap gap (DUST1.10 rows 18, 20, 21). Distinct from R13.8/R13.9/R13.10, which own listing,
continuation and permission answering.

## Out of scope

- P3 (does Decision 61 reach hosted sessions) — open, USER. Permission answering from the device (R13.9).
