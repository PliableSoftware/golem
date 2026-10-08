---
task: DUST2.13
title: "Web cache: honour max-age/Expires freshness and ingest fetched pages into the KB"
state: queued
owner: agent
size: M
discipline: code
design: "wiki Web Cache; SUMMARY.md Gaps 1.4/r065 (P), r067 (P); DECISIONS.md K7"
gate: "An entry with `max-age`/`Expires` is served fresh within its window without revalidation; 304 updates meta; `no-store` or a changed 200 drops the entry; a fetched page is searchable via `search` and a re-fetch of a known URL is served offline; tests for each. golem verify green by exit code."
touches: [src/hooks/web-fetch.ts, src/hooks/web-fetch, src/knowledge, tests]
created: 2026-10-08
---

## What this is

Roadmap gap. The page promises HTTP freshness semantics and KB ingestion that are partial
(DUST1.4 rows 65, 67). K7 decided the DOC follows code for now (DUST2.5); this task is the
optional path to make the original claim true.

## Hard rules

- Redaction before storage on every cached/ingested page.

## Out of scope

- Doc edits (DUST2.5).
