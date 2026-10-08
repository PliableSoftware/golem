---
task: DUST2.11
title: "golem plugin diagnostics: surface every problem, count it, and name regex-hang risk"
state: queued
owner: agent
size: M
discipline: code
design: "ADR-0005; wiki Plugin Seams; SUMMARY.md Gaps 1.1/r037 (P), r039 (P), r042 (N)"
gate: "`golem plugin` reports every load/validation problem it can detect with a count, flags rules whose regex has catastrophic-backtracking shape, and a throwing stage is skipped with the pre-stage body kept AND reported; tests for each. golem verify green by exit code."
touches: [src/plugins, src/cli/plugin.ts, src/pipeline, tests]
created: 2026-10-08
---

## What this is

Roadmap gap from Dust Phase 1 (not part of the Phase 2 doc batch). ADR-0005 promises diagnostics
the code only partly delivers. Evidence: DUST1.1 rows 37, 39, 42.

## The work

1. r037: confirm the stage-throw behaviour (skip, keep pre-stage body) and make it observable.
2. r039: enumerate problem kinds the loader already detects vs drops silently; report all, counted.
3. r042: a static heuristic for nested quantifiers / overlapping alternation; warn, do not reject.

## Hard rules

- Redaction never weakened: a plugin problem never disables built-ins.

## Out of scope

- WASM / declarative successor rules (1.1/r051, r052 — not started, spec register).
- S8 in-place mutation bypass (Phase 3).
