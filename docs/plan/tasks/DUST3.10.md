---
task: DUST3.10
title: "Inference roles and tool accounting: ollama setup pulls every live role, persona-sourced routes are labelled as such, bench drops the retired `level` cases and adds `code`, snooze and coder errors are instrumented"
state: done
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.6 D26e, C-c; DUST1.5 h3, h5; 'Dead candidates' DUST1.5 (bench cases), DUST1.6 (persona_worker branch); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop (bench data rows are not tests)."
depends_on: []
touches: [src/inference/ollama-bootstrap.ts, src/inference/target-dispatcher.ts, src/inference/workers.ts, src/tools/cases.ts, src/mcp/devices-snooze.ts, src/mcp/coder-tools.ts, tests]
created: 2026-10-08
updated: 2026-10-08T18:33:46.487Z
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-10 -b dust3-10 development`), failing
test first, commit as you go.

## The work

1. **D26e: `golem ollama setup` pulls only the drafter** (`src/inference/ollama-bootstrap.ts:236-257`;
   `src/inference/catalog.ts:30-84`). `summarizer` (distill) and `judge` (rerank, `coder --refine`)
   are live roles with different models on every tier. They fail with
   `CapabilityUnavailableError` on a machine setup reported ready. Pull them, or report them
   missing. Fix the "`drafter` is the only role" comment (`:11-12`).
2. **C-c: a persona-sourced worker route is labelled `worker`** (`src/inference/target-dispatcher.ts:237,748`;
   `src/inference/workers.ts:96`). Return `route: "persona_worker"` when the value comes from
   `inference.personas`. **Note:** the audit listed the `persona_worker` branch in `selectTarget`
   (`target-dispatcher.ts:749-755`) as unreachable dead code. This fix makes it the live path,
   so do not delete it; fold it into the fix. Test both labels.
3. **h3: bench cases target the retired `level` tool** (`src/tools/cases.ts:84-85,192,198`:
   `level-1`, `level-2`, `arg-level-1`, `arg-level-2`). They cap every accuracy figure. Delete
   them (SAFE: data rows, `grep -rnE '"(level-1|level-2|arg-level-1|arg-level-2)"' src tests` → only
   `cases.ts`), add a `code` tool case, and add a test that every case's `expected` tool is in the
   live catalog. Remove the `// level — set the slider` comment.
4. **h5: `snooze` and coder's backend-unavailable path are uninstrumented**
   (`src/mcp/devices-snooze.ts:236`, `src/mcp/coder-tools.ts:573`). Wrap them in `instrumented()`.
   `wiki_upsert` is DUST3.8.

## Out of scope

- C-b (second coder resolution chain), `coderRouteConflict`, `HaikuFallbackRequired`:
  NEEDS-USER, listed in DUST3.2.
- Tool-description drift in `coder-tools.ts:156,173`: DUST3.18.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
