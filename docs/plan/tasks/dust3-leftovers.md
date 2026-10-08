---
task: dust3-leftovers
title: "Leftovers from the Dust Phase 3 comment pass and reviews: two behaviour gaps, four stale comments, one ADR numbering line, and wiki list-quote churn"
state: queued
owner: agent
size: M
discipline: code
design: "Found by DUST3.18 and the Phase 3 reviews (2026-10-08), each left alone because DUST3.18 was strings-and-comments only or the item was out of its list. Behaviour: (1) src/proxy/server.ts body-read and gunzip failures destroy the socket without reporting anything; (2) the device and chat answerer is not wired into src/hooks/host-gate.ts. Stale text: (3) src/config/control-surface-types.ts lines 184-191 (runtime:slider and setSliderLevel); (4) src/cli/init-uninit.ts:108 (/golem/* skills in the init description); (5) src/cli/statusline.ts:687; (6) src/pipeline/pipeline.ts says 'R2.3, opt-in' for local answer, which is on by default. Docs: (7) ADR-0007 still calls the base-URL rule invariant 8 at lines 167 and 329, while host.ts and session-host.ts now say invariant 7 for the no-exemption and park rule (item 7 in the ADR). Cosmetic: (8) a wiki upsert rewrites list quoting on 78 existing pages (parse, serialise, parse is stable and no value is lost); make the serialiser preserve the original quoting where it round-trips, so an upsert does not churn untouched frontmatter."
gate: "Behaviour items 1 and 2 have failing-first regression tests; items 3-6 are strings and comments only; item 7 is an ADR amendment note, not a rewrite; item 8 shows a no-op upsert leaves every page in docs/wiki byte-identical; golem verify exit 0."
depends_on: []
touches: [src/proxy/server.ts, src/hooks/host-gate.ts, src/config, src/cli, src/pipeline, src/wiki, docs/decisions, tests]
created: 2026-10-08
---

## What this is

A parking place for small, verified items so they are neither lost nor mixed into a no-behaviour-change pass. Re-confirm each against the current code before changing it.

## Out of scope

- Open contradictions G3, M2, H2, P3, P4 (undecided).
- The NEEDS-USER dead-code proposals.
