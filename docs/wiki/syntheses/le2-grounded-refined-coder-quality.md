---
title: LE2 — grounded-refined coder quality
type: synthesis
tags: [pre-r6, inference, coder, drafter, grounding, refine, measurement]
sources: [docs/plan/PRE_R6_BATCH.md, docs/wiki/syntheses/r4.7-drafter-quality-baseline.md, src/mcp/server.ts]
created: 2026-07-17
updated: 2026-07-17
---

# LE2 — grounded-refined coder quality

Fair re-measurement of local `coder` draft quality **with grounding + refine on,
over a real `semantic:bge-m3` index** — the follow-up
[[R4.7 — drafter quality & catalog re-verification]] deferred until the MCP
server ran R4.2 grounding / R4.4 refinement against a semantic (not lexical)
index. Ran the **same 5 representative repo tasks** as R4.7 for a like-for-like
comparison.

## Result

| Task | R4.7 ungrounded | LE2 grounded + refine |
|---|---|---|
| `clampSliderLevel` fn | accept | revise* |
| `union` vitest suite | accept | accept |
| `/golem/plan` skill | revise | revise |
| `gatherGrounding` | revise | **revise (much improved)** |
| `coder-refine.ts` | revise | **revise (much improved)** |

Verdict count: **1 accept / 4 revise / 0 reject** vs R4.7's 2 / 3 / 0.

## Findings

1. **The verdict count is the wrong metric.** It barely moved (and dipped by one
   on model variance — the `*` `clampSliderLevel` flip was a `module.exports`/CJS
   slip, not a grounding regression; grounding actually got the domain value —
   `MAX_SLIDER_LEVEL = 3`, not the prompt's "0–4" — *right*). What actually
   improved is the **quality of the "revise" drafts** for project-integrated
   code: for `gatherGrounding` and `coder-refine`, grounding surfaced the real
   source (`src/mcp/server.ts:670`, `src/mcp/coder-refine.ts`) and the drafts
   reproduced the correct architecture, leaving only mechanical import/wiring
   fixes — versus R4.7's "invented plausible-but-wrong integration." That is far
   cheaper for the paid model to finish, even at the same verdict label.

2. **`refine` fired 0 rounds on all 5.** The judge never flagged a high/medium
   issue worth revising — even the `module.exports`/CJS error a judge should
   catch. **Root-caused + fixed 2026-07-17:** it wasn't the prompt/threshold —
   the judge model (`qwen2.5:14b`) simply isn't pulled on this box, so every
   judge call failed and a silent `catch` reported `rounds:0`. Fixed with an
   explicit `RefineStatus` (no silent skips) + a judge→drafter self-review
   fallback; E2E-verified it now produces a real critique and revision. See
   [[PRE-R6 loose-ends closeout]].

3. **Rerank spot-check:** semantic search returns sensible hits
   (`policy.ts:45` `MAX_SLIDER_LEVEL` top at 0.66). But the chat-judge **rerank
   layer is opt-in (`rerank_enabled=false`) and not live** in the running
   server, so only the semantic *substrate* is validated here, not rerank itself.

## Takeaway
The co-developer thesis holds: grounding makes local drafts *cheaper to finish*,
which is the point (leave the paid model the judgment calls). The measured lever
to improve next is **refine**, not grounding. See [[PRE-R6 loose-ends closeout]].

## Rebaseline 2026-10-08

Findings above stand as the 2026-07-17 record. Drift against shipped code:

- `clampSliderLevel` and `MAX_SLIDER_LEVEL` no longer exist (`grep` over `src/` finds them only in a lint comment, `src/cli/wiki.ts:232`). The slider was retired (ADR-0004); the dial is `compression.level` (`off` | 1 | 2 | 3), `src/interfaces/policy.ts:37`. The "0-4 vs 0-3" finding is historical.
- `src/mcp/server.ts:670` is stale: `gatherGrounding` now lives at `src/mcp/search.ts:256`; `refineDraft` at `src/mcp/coder-refine.ts:156`. The coder tool is `src/mcp/coder-tools.ts`.
- `policy.ts:45` `MAX_SLIDER_LEVEL` search hit: that symbol is gone, so the rerank spot-check is not reproducible as written.
