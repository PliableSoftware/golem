---
task: DUST2.10
title: "Code-owned claims: tool descriptions, doc comments and CLI/dashboard labels that drifted"
state: done
owner: agent
size: M
discipline: code
design: "SUMMARY.md drift groups 'code comments (inference)', 'code comments / tool descriptions (no owning doc)', 'honest-observability sweep', 'src/interfaces/ contract doc comments' (:353-381, :576-578); DECISIONS.md C1, M1, M3, T1, T2, V3"
gate: "Each row below is fixed; the only behavioural changes are label text and the coder outputSchema widening (M1); tests that snapshot labels/descriptions updated; 'byte-faithful' no longer describes level ≤ 1 in any src/ comment or generated skill text; golem verify green by exit code."
depends_on: [DUST2.1]
touches: [src/mcp, src/inference, src/cli, src/hooks, src/interfaces, src/cli/skills]
created: 2026-10-08
updated: 2026-10-08T12:19:12.712Z
---

## What this is

Claims that live in code rather than in a doc. Text-only except M1. Evidence per row is in its
DUST1.x note.

## Rows

- Inference comments: 1.6/r062 (worker_targets "retired" — DUSTSEC.13 owns; skip if done),
  r063 (`persona-lane.ts` "the ONE implementation"), r064 (dispatch route label).
- Tool descriptions / comments: 1.5/r029 + **M1** (`coder` structured result vs `outputSchema`:
  default rule — widen the schema to the keys the result carries; flag that MCP clients see a
  wider schema), 1.5/r050 + **M3** (`wiki_upsert` "every write is committed to git" → writes
  files), 1.5/r052 (`P1_TOOL_FALLBACK`), 1.7/r030, r033, 1.11/r091 `gateway.ts`, r099
  `prompt-guidance.ts`, r100 `proxy.ts` **HR**, r102 `select-target.ts`, r104 `session.ts`, r106
  `target.ts`, r108 `team.ts`.
- **V3:** drop the bare-model-name selection promise from the `resolveDefaultTargetId` doc.
- Honest-observability sweep 1.9/r062–r066, r070: **T1** `requests` label → "rewritten
  requests"; **T2** savings figures labelled "estimated" (chars/4).
- `src/interfaces/` doc comments (SUMMARY :576-578): comment-only edits; a frozen contract's
  TYPES must not change here.
- C1 wording in comments: `src/cli/dials.ts`, `gateways.ts`, `proxy-runtime.ts`,
  `route-resolver.ts`, `status-collect.ts`, `status.ts`, `upstream-display.ts`, `policy.ts:19`, and
  generated skill sources under `src/cli/skills/` (e.g. `golem-adversarial-review`). Regenerate
  generated files; do not hand-edit them only.

## Out of scope

- M2 (`slider` prompt in the frozen prompt set) — open, USER.
- Stale comments listed under SUMMARY "Phase 3 inputs" (:1024-1193) — Phase 3.
- Any behaviour change beyond M1.

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; fact-checked by sampling (58 claims), follow-ups in PR 240
