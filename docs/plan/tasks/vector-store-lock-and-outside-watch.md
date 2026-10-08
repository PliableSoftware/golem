---
task: vector-store-lock-and-outside-watch
title: "Vector store: a narrow stale-lock break race, a heartbeat that ignores the lock owner, and outside-project --watch deleting project chunks"
state: queued
owner: agent
size: M
discipline: code
design: "Residuals from DUST3.7 (2026-10-08), which passed two independent reviews. (1) src/knowledge/file-driver.ts: between a stale-lock breaker's rename and its put-back another process can take the slot; it now logs one stderr line and waits, but the holder and the new owner can both write and one update can be lost. The heartbeat refreshes the lock file's mtime without checking the owner token, so it can touch another process's lock. (2) Pre-existing, not from DUST3.7: an index target outside the project root gets source paths relative to its own directory (projectBaseDir in src/knowledge/ingest.ts:50, used at src/knowledge/knowledge-base.ts:196). The --watch handler (:210) and #applyWatchBatch (:236) call reindexFiles and removeSourcePaths with that base inside the same project id, so editing or deleting an outside README.md can delete or replace a project chunk with the same relative path. (3) search serves an instance's in-memory copy until that instance's next write."
gate: "Each defect has a regression test that fails on the current code: the heartbeat refuses to refresh a lock whose token is not its own; two processes contending for a stale lock never both write; golem index of an outside path with --watch, then editing an outside file named like a project file, leaves the project's chunks intact (outside targets use a distinct source-path namespace, for example an absolute or prefixed key); golem verify exit 0."
depends_on: []
touches: [src/knowledge, src/cli/auto-index.ts, tests]
created: 2026-10-08
---

## What this is

Three integrity gaps left deliberately after DUST3.7. The namespace fix for outside targets changes stored source paths, so it needs a one-time resync story; read the DUST3.7 review notes in the Phase 3 debrief first.

## Out of scope

- Replacing the lockfile with a different store.
- NEEDS-USER dead-code proposals in the Phase 3 index.
