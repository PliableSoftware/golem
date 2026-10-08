---
task: stale-committed-to-git-claims
title: "Two generated surfaces still say every wiki write is committed to git; the store only writes files"
state: queued
owner: agent
size: S
discipline: code
design: "Found by DUST2.10 (2026-10-08): the wiki_upsert tool description was corrected (M3), but src/cli/wiki.ts (~:58, which generates docs/wiki/WIKI.md) and src/cli/skills/research.ts still say every write is committed to git. The store writes files; git is the user's. Decision 44 says git makes every write reviewable, which is true only once the user commits."
gate: "Both strings say what is true (writes are files; commit them to review); the generated WIKI.md preamble and the generated research skill are regenerated from source in the same change; tests that pin either string are updated; golem verify and golem wiki check exit 0."
depends_on: []
touches: [src/cli/wiki.ts, src/cli/skills/research.ts, docs/wiki/WIKI.md, .claude/skills, tests]
created: 2026-10-08
---

## What this is

Two generated outputs repeat a claim the code does not make. Fix the sources, regenerate the outputs, never hand-edit the generated files alone.

## Out of scope

- Making wiki_upsert commit anything.
- Decision 44 itself.
