---
task: DUST5.5
title: "Draft a short blog post about the Dust method: what it found, what review caught, and what the skill packages"
state: queued
owner: agent
size: S
discipline: write
design: "The three Dust debriefs; the Dust Method wiki page and the DUST4.4 dogfood FINDINGS.md; docs/marketing/CLAIMS.md."
gate: "docs/marketing/blog-dust-method.md exists, marked DRAFT, 800-1200 words; every number is a CLAIMS.md row with its date; it includes at least one thing the method got wrong (from the Phase 2 debrief or the dogfood findings); no banned claim; no redaction placeholder."
depends_on: [DUST5.2, DUST4.4]
touches: [docs/marketing]
created: 2026-10-08
---

## What this is

One post on the method: drift after heavy development, eleven read-only audits in parallel worktrees, a default rule with every choice listed, re-verification before refactoring, and independent review catching defects the agents' own green tests missed. End with `/golem-dust` as the way to run it.

Use the debriefs' figures as figures from one project's run, dated, never as expected results. Include the failures: the audit was wrong in places, three fix rounds introduced new defects, the review gate was waived for old backlog with recorded reasons.

## Out of scope

- Publishing or posting anywhere (DUST5.8).
- Naming people, customers or other projects.
- Security detail beyond what DUST5.4 states.
