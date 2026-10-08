---
task: wiki-check-unlisted-pages
title: "golem wiki check flags unlisted debriefs but not other unlisted pages"
state: queued
owner: agent
size: S
discipline: code
design: "Found by DUST2.8 (2026-10-08): six pages existed on disk but were missing from WIKI.md and golem wiki check passed. The six were found by comparing page titles to the index by hand (concepts, a question, a synthesis)."
gate: "golem wiki check reports every page under the wiki directory that WIKI.md does not list, not only debriefs; a test fails on the old checker with an unlisted concept page; the existing wiki still passes after DUST2.8 listed the six; golem verify exit 0."
depends_on: []
touches: [src/wiki, tests]
created: 2026-10-08
---

## What this is

The index is how graph traversal reaches a page, so an unlisted page is invisible to it. The checker should treat any unlisted page as an issue, with the existing allow-list for generated pages if one exists.

## Out of scope

- Changing the WIKI.md line format.
- Auto-writing index lines.
