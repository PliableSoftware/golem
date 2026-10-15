---
task: DUST3.12
title: "Telemetry store correctness: no rollup splice across rotation, no lost event on a partial line, no literal NUL bytes in source, fold the `all` window once"
state: done
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.9 D3, D4, D8, D11; DUST1.9 'Dead candidates'; honest observability (spec §1); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop except tests of deleted symbols, deleted with them; `git diff --stat` shows the two .ts files as text, not binary."
depends_on: []
touches: [src/telemetry/jsonl-store.ts, src/telemetry/cost-benchmark.ts, src/telemetry/windowed-stats.ts, src/telemetry/index.ts, tests]
created: 2026-10-08
updated: 2026-10-08T18:33:47.551Z
---

## What this is

The telemetry store can report wrong numbers. Its header claims "never a wrong number". Work
in your own worktree (`git worktree add ../golem-dust3-12 -b dust3-12 development`), failing test
first, commit as you go.

## The work

1. **D8 first: literal NUL bytes in source** (`src/telemetry/jsonl-store.ts:178`,
   `src/telemetry/cost-benchmark.ts:304,335`). Git and `rg` treat both files as binary, which
   hid them from the audit's greps. Replace with `\u0000` escapes. No behaviour change; existing
   tests must pass.
2. **D3: the rollup can splice two files across a rotation** (`jsonl-store.ts:525-538`). Trust is
   `size >=` and `mtime >=` only. Record an inode or rotation counter and distrust on change.
3. **D4: a partial trailing line advances the watermark** (`jsonl-store.ts:544,600-603`). Advance
   only to the last `\n`.
4. **D11: the `all` window is folded twice** (`src/telemetry/windowed-stats.ts:114-118`). Drop the
   pre-loop fold.
5. Then fix the header claim at `jsonl-store.ts:30-31,558-559` to match what is now true.

## SAFE-TO-DELETE (execute)

| item | where | proof |
|---|---|---|
| `windowedStats` (no-fallback variant) | `src/telemetry/windowed-stats.ts:90`; barrel `src/telemetry/index.ts:75` | `grep -rnw --exclude-dir=node_modules windowedStats src tests scripts vscode-extension` → 2 hits (definition + barrel); `windowedStatsWithFallback` does not call it |

## NEEDS-USER (proposals only, do not delete)

| item | file:line | evidence | recommendation |
|---|---|---|---|
| `aggregateUsageByLevel`, `usageReportRows` | `src/telemetry/types.ts:267`, `jsonl-store.ts:615`, `usage-report.ts:53` | Test-only readers left over from the slider A/B; the writer `recordUsageEvent` is still live | Delete the readers and their `byLevel` describe blocks; keep the writer |
| `aggregateUsageBySemanticForced`, `semanticForcedReportRows` | `jsonl-store.ts:642`, `usage-report.ts:86` | Staged for R2.6 (queued) | Keep; defer to R2.6 |
| `aggregateAvoidedUpstream` | `types.ts:289`, `jsonl-store.ts:739` | Test-only reader; writer live (`telemetry-hooks.ts:55`) | Keep for DUST2.18 (dashboard) |

## Out of scope

- Watch, dashboard and statusline CLI defects: DUST3.13.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
