---
task: DUST5.6
title: "Independent read-only fact-check of every Phase 5 draft against the code"
state: queued
owner: agent
size: S
discipline: review
design: "docs/marketing/CLAIMS.md and the three drafts; the Phase 2 fact-check precedent (54 of 58 claims true, VERDICT: concerns) in the Phase 2 debrief."
gate: "A reviewer that did not write the drafts checks EVERY CLAIMS.md row cited by a draft against the cited path:line at the current development head, and every draft sentence against the banned list; it writes docs/marketing/REVIEW.md with counts, each false or overstated claim, and a VERDICT (clean, concerns, block); findings are fixed in the drafts and REVIEW.md records the fix; a second pass runs if the first found anything."
depends_on: [DUST5.3, DUST5.4, DUST5.5]
touches: [docs/marketing]
created: 2026-10-08
---

## What this is

The Phase 2 review sampled; this one checks every cited claim, because the drafts are short and their errors are public once published. Dispatch it to a fresh agent with no authoring context (the `golem-reviewer` persona fits). The reviewer reports; the drafting agent fixes.

Also check that every DUSTSEC "unreleased" statement still holds at review time (`git tag --contains`).

## Out of scope

- Style or tone edits beyond what a false claim requires.
- Publishing.
