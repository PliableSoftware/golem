---
task: DUST2.5
title: "Wiki rebaseline: knowledge base, web cache, distillation and tool pages"
state: done
owner: agent
size: M
discipline: write
design: "SUMMARY.md drift groups 'wiki: Auto-Index Cost / Distillation Pipeline / Knowledge Base / LSP Bridge / Managed Tools / Tool Search / Web Cache / Wiki-First Knowledge' (:587-731); hygiene 'Dangling sources:' (:756-758); DECISIONS.md K2, K3, K5, K6, K7, M5, M7"
gate: "Every row listed below is fixed with the code evidence from its DUST1.x note; dangling `sources:` entries are removed or repointed; default-rule choices marked; golem wiki check green by exit code."
depends_on: [DUST2.1]
touches: [docs/wiki/concepts]
created: 2026-10-08
updated: 2026-10-08T12:19:10.044Z
---

## Rows

| page | rows | notes |
|---|---|---|
| `concepts/Knowledge Base.md` | 1.4/r035 | `assembleHits`/`graphFirstWikiHits` moved out of `src/mcp/server.ts` |
| `concepts/Wiki-First Knowledge.md` | 1.4/r038, r045 | K2: user page wins under graph-first; K6: drop the plan-gate (D44/D54); dangling source `docs/plan/proposals/wiki-knowledge-pivot.md` |
| `concepts/Web Cache.md` | 1.4/r064 | K5 green path shipped (R9.12/R9.19); K7 `max-age`/`Expires` only with revalidation on |
| `concepts/Distillation Pipeline.md` | 1.4/r051, r058 | K3 bare `---` separator; K6 plan-gate; dangling `docs/plan/next_batch.md`, `docs/plan/R3_BATCH.md` |
| `concepts/Auto-Index Cost.md` | 1.4/r073 | |
| `concepts/LSP Bridge.md` | 1.4/r088 | sources now under `src/pkg/` (verify) |
| `concepts/Managed Tools.md` | 1.5/r033, r035 | M7: 6 runtime deps, `web-tree-sitter` caret range |
| `concepts/Tool Search.md` | 1.5/r045, r048 | M5: date-stamp the figures; state the live count (11 tools, ~1116 tokens per DUST1.5); C1 wording |

ADR-0001's dangling `docs/plan/next_batch.md` source is DUST2.3's (superseding ADR).

## Out of scope

- Implementing the KB gaps (DUST2.13–2.15). Other pages.

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.

## Outcome

shipped; fact-checked by sampling (58 claims), follow-ups in PR 240
