---
task: DUST5.8
title: "Publish (or not) the Phase 5 material: website, blog, changelog and any security advisory"
state: queued
owner: user
size: S
discipline: write
design: "docs/marketing/ drafts and REVIEW.md (DUST5.6)."
gate: "The user decides what goes out, where, and when; anything published is re-checked against the code at publish time."
depends_on: [DUST5.6]
touches: [docs/marketing]
created: 2026-10-08
---

## What this is

Every outward-facing act from Phase 5, kept in one user-owned task: posting the blog, changing the website, publishing a changelog, and deciding whether the DUSTSEC fixes need a release and a security advisory before any public mention of them. An agent must not take any of these steps.

Decisions the drafts leave open for the user:
- Cut a release containing the DUSTSEC fixes before publishing the changelog narrative?
- Publish a security advisory for affected versions (up to v0.54.3)?
- Which claims, if any, to drop for tone.

## Out of scope

- Any agent action. Agents may revise drafts only on a new agent task.
