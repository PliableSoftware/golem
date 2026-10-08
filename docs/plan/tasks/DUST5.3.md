---
task: DUST5.3
title: "Draft the feature overview from the claims ledger"
state: done
owner: agent
size: M
discipline: write
design: "docs/marketing/CLAIMS.md (DUST5.2) is the only source; docs/golem-spec.md section 1 for scope and non-goals."
gate: "docs/marketing/feature-overview.md exists, marked DRAFT at the top; every factual sentence carries a ledger id in a trailing HTML comment (<!-- C-nn -->) or is plainly opinion; a script or grep shows every cited id exists in CLAIMS.md; no banned claim appears; no redaction placeholder."
depends_on: [DUST5.2]
touches: [docs/marketing]
created: 2026-10-08
updated: 2026-10-08T23:21:56.200Z
---

## What this is

A feature overview a website could later use: what Golem is, who it is for, the main capabilities, and the non-goals. Plain and specific; name the mechanism rather than an adjective.

A claim the draft needs that the ledger lacks goes back into `CLAIMS.md` first, with its code check, then into the draft.

## Out of scope

- Publishing, or any change to a website, README or the npm description.
- Comparisons with named competitors.
- Screenshots or images.

## Outcome

shipped; see the Phase 4 and 5 debrief
