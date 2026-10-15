---
task: DUST2.20
title: "Compression gating completeness: per-content-type Headroom mapping, tool-result cache with mtime invalidation, lossy-stage gate declarations"
state: queued
owner: agent
size: M
discipline: code
design: "ADR-0004; wiki Compression, Compression Levels; SUMMARY.md Gaps 1.3/r034, r037, r043, r045 (P); DECISIONS.md C3, C4"
gate: "`compression.level` maps to Headroom config per content type as documented; a tool-result cache entry invalidates on file mtime change; every lossy stage declares the level that gates it and a test enumerates them; the unified MCP surface decision for Headroom retrieve/stats/memory is recorded (implement or retire). golem verify green by exit code."
touches: [src/compression, src/pipeline, src/mcp, tests]
created: 2026-10-08
---

## What this is

Roadmap gap (DUST1.3 rows 34, 37, 43, 45). C4 narrowed the "everything lossy is reversible" claim
in docs (DUST2.4); this task makes the gate declarations real.

## Hard rules

- Headroom imports only in `src/compression/headroom-adapter.ts`; Headroom pinned exactly.
- Lossless and prefix-stable at level ≤ 1 (C1).

## Out of scope

- G06/G07 semantic/exact response caches (spec register). C3 CCR swap dial-independence (doc follows code).
