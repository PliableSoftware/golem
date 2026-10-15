---
task: dust3-leftovers
title: Leftovers from the Dust Phase 3 comment pass and reviews: two behaviour gaps, four stale comments, one ADR numbering line, and wiki list-quote churn
state: done
owner: agent
size: M
discipline: code
design: Found by DUST3.18 and the Phase 3 reviews (2026-10-08), each left alone because DUST3.18 was strings-and-comments only or the item was out of its list. Behaviour: (1) src/proxy/server.ts body-read and gunzip failures destroy the socket without reporting anything; (2) the device and chat answerer is not wired into src/hooks/host-gate.ts. Stale text: (3) src/config/control-surface-types.ts lines 184-191 (runtime:slider and setSliderLevel); (4) src/cli/init-uninit.ts:108 (/golem/* skills in the init description); (5) src/cli/statusline.ts:687; (6) src/pipeline/pipeline.ts says 'R2.3, opt-in' for local answer, which is on by default. Docs: (7) ADR-0007 still calls the base-URL rule invariant 8 at lines 167 and 329, while host.ts and session-host.ts now say invariant 7 for the no-exemption and park rule (item 7 in the ADR). Cosmetic: (8) a wiki upsert rewrites list quoting on 78 existing pages (parse, serialise, parse is stable and no value is lost); make the serialiser preserve the original quoting where it round-trips, so an upsert does not churn untouched frontmatter.
gate: Behaviour items 1 and 2 have failing-first regression tests; items 3-6 are strings and comments only; item 7 is an ADR amendment note, not a rewrite; item 8 shows a no-op upsert leaves every page in docs/wiki byte-identical; golem verify exit 0.
depends_on: []
touches: [src/proxy/server.ts, src/hooks/host-gate.ts, src/config, src/cli, src/pipeline, src/wiki, docs/decisions, tests]
created: 2026-10-08
updated: 2026-10-15T06:12:37.907Z
---

## What this is

A parking place for small, verified items so they are neither lost nor mixed into a no-behaviour-change pass. Re-confirm each against the current code before changing it.

## Out of scope

- Open contradictions G3, M2, H2, P3, P4 (undecided).
- The NEEDS-USER dead-code proposals.

## Outcome (2026-10-14)

1. **Proxy body-read / gunzip** — before: `src/proxy/server.ts` translating path destroyed the socket and returned with no outcome line. After: reports `upstream_error` (or `client_gone` when the client aborted) with a detail naming the stage. Tests: `tests/integration/proxy-translate-outcomes.test.ts` (failed first).
2. **Device/chat answerer in `src/hooks/host-gate.ts`** — NOT a bug, not built. Before and after: an `ask` resolves to a refusal. There is no upstream route carrying a permission answer (`src/session/transport.ts` has only `message` and `interrupt`); that is R13.9 plus Decision 61, and whether it reaches hosted sessions is open P3 (out of scope here). Comments in `src/hooks/host-gate.ts` and `src/session/host-gate.ts` now say that instead of "shipped but not attached".
3. **`control-surface-types.ts` slider text** — already fixed. No `runtime:slider` or `setSliderLevel` remains in the file (grep); the one "slider" mention (line 93) is accurate history.
4. **`/golem/* skills` in the init description** — before `/golem/* skills`, after `/golem-* skills` (`src/cli/commands/init-uninit.ts:108`; the file moved from `src/cli/`).
5. **`statusline.ts:687`** — already accurate ("no preset to resolve against ... retiring the slider"); no change.
6. **`pipeline.ts` "R2.3, opt-in"** — before: opt-in. After: local answer is on by default via `knowledge.local_answer_enabled` (two comments).
7. **ADR-0007** — line 167 said invariant 8 for the base-URL rule; now invariant 7, with a dated amendment note. Line 329 (and 375) cite invariant 8 for local-only enrolment, which is correct, so unchanged.
8. **Wiki list-quote churn** — before: re-serialising 79 of 242 parseable pages changed them (quoting, `updated`-before-`created` order, and two pages with a `task:` key that would have been dropped). After: `serializeFrontmatter(fm, original)` keeps unchanged lines, key order and unknown keys; `FileWikiStore` passes the block it read. Re-serialising every page in `docs/wiki` is now byte-identical (0 of 242 differ). Tests in `tests/unit/wiki/`.

## Outcome

shipped in #303
