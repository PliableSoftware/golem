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

## Findings and decisions (2026-10-14)

- **r037, verified against `src/pipeline/pipeline.ts`:** stage 1 (built-in redaction) runs
  BEFORE stage 1.7 (plugin stages), so the body a stage receives, and the "pre-stage body"
  kept on failure, has already been through built-in redaction. True only while
  `policy.stages.redaction` is on (`proxy.bypass_all` is the sole exception, ADR-0004).
  The old try/catch did NOT keep it for a stage that mutated in place then threw, and
  could hang forever on a never-settling stage; `src/plugins/stage-runner.ts` snapshots
  and time-boxes (5s). Faults are counted per stage and logged.
- **r039:** loader problems now carry `kind` and `severity`; previously silent drops
  (registration after `setup()`, non-string metadata, missing stage description, `group`
  beyond the pattern's captures) are recorded. `golem plugin` prints counts.
- **r042:** `src/plugins/regex-risk.ts`, warn-only, pure TypeScript.
- **Exit code:** `golem plugin` stays 0 by default; `--check` exits 1 on error-level
  problems, `--strict` on any problem.
- **Review fixes (2026-10-14):** probe timer is ref'd so `golem plugin` cannot exit silently
  on a hung stage (child-process test); a timed-out probe is error-level so `--check` fails;
  thrown-value conversion is exception-safe, redacted and truncated; circuit breaker (3
  timeouts, 60s cool-off); detector uses exact code-point intervals plus a work budget.
- **Known, accepted:** a stage's late write after a timeout can still reach `parsed` (the
  parsed request object; skews telemetry `tokensBefore` only, never the forwarded body).
  The timeout and breaker are injectable on the pipeline (`pluginStageRun`).
- **Follow-up (not done):** a user-facing `plugins.stage_timeout_ms` setting. Adding one
  means schema, ui-model, config-schema asset and drift tests; no trivial existing pattern.
- Plugin rules still cannot set `scanEnd` / `validateAt` / `extendStart`.

## Out of scope

- WASM / declarative successor rules (1.1/r051, r052 — not started, spec register).
- S8 in-place mutation bypass (Phase 3).
