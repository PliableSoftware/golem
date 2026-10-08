---
task: DUST2.15
title: "KB lookup completeness: graph-first alias matching and full-text `fetch` for any hit"
state: queued
owner: agent
size: S
discipline: code
design: "spec Decision 28; wiki Wiki-First Knowledge; SUMMARY.md Gaps 1.4/r018 (P), r039 (P)"
gate: "A query naming a page alias surfaces that page via graph-first lookup; `fetch` returns full text for every hit kind `search` can return (getChunk); tests for each. golem verify green by exit code."
touches: [src/knowledge, src/mcp, tests]
created: 2026-10-08
---

## What this is

Roadmap gap (DUST1.4 rows 18, 39): graph-first matches title and wikilink but not alias; `fetch`
cannot return full text for some hit kinds.

## Out of scope

- K2 title-collision precedence (doc follows code, DUST2.5).
