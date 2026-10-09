---
task: readme-estimates-claim
title: "Reword the README claim 'real billed-token telemetry, not estimates': savings are estimates (USER decision)"
state: done
owner: agent
size: S
discipline: write
design: "docs/plan/audit/dust-1/DECISIONS.md README (USER, 2026-10-09); found by the Phase 5 claims ledger (docs/marketing/CLAIMS.md B-38). The README says Golem gives real billed-token telemetry, not estimates, but token savings figures are chars/4 estimates; only the cache report uses billed usage."
gate: "README.md says what is true, with each number's source: savings and tokens saved are estimates (say how they are estimated, from the code), and the cache report uses billed usage from the API response; no other README sentence still says or implies billed or exact savings; the same claim is checked in docs/golem-spec.md, the wiki (Cache Observability, Compression Levels) and the dashboard text and fixed where it appears; every changed sentence is checked against the code with a path:line; golem verify exit 0 and golem wiki check exit 0."
depends_on: []
touches: [README.md, docs/golem-spec.md, docs/wiki/concepts, tests]
created: 2026-10-09
updated: 2026-10-09T12:54:06.897Z
---

## What this is

A false marketing claim in the README that the ledger caught. Read `src/cli/stats.ts` and the cache report code to see exactly which figures are billed and which are estimates, and reword to that, no more and no less.

## Out of scope

- Changing the telemetry so savings become billed figures.

## Outcome

shipped (PR merged with CI gate green; not independently reviewed, not a hard-rule change)
