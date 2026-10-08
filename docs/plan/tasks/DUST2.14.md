---
task: DUST2.14
title: "Wiki → vector index via the watcher; watcher daemons for chosen paths; resumable ingest checkpoints"
state: queued
owner: agent
size: M
discipline: code
design: "spec Decision 28; wiki Wiki-First Knowledge, Knowledge Base; SUMMARY.md Gaps 1.4/r008 (P), r020 (N), r070 (P); ADR-0001 (superseded by DUST2.3's polling-watcher ADR)"
gate: "A wiki page write reaches the vector index without a manual ingest; configured extra paths are watched; a killed ingest keeps finished batches (checkpoint every 20 files, deletions first); tests for each. golem verify green by exit code."
depends_on: [DUST2.3]
touches: [src/knowledge, src/cli/commands, tests]
created: 2026-10-08
---

## What this is

Roadmap gap: "wiki write → watcher → vector index" is not started (DUST1.4 row 20); watcher
daemons and checkpointing are partial (rows 8, 70).

## Hard rules

- Redaction before storage (S13 `wiki_upsert` unredacted is a Phase 3 item — do not depend on it, do not fix it here).
- No heavyweight native deps (the shipped watcher is polling).

## Out of scope

- Qdrant server / shared collection (spec register).
