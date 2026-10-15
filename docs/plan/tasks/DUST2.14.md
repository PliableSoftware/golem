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

## Open questions for the user (DUST2.14 implementation, 2026-10-15)

Safe readings implemented; none blocks the gate.

1. **Redaction of indexed file text.** The vector index stores file chunks as read; redaction
   runs at the proxy/hook boundary and at `wiki_upsert`/distill writes, not inside
   `reindexFiles`. The daemon routes through the same single store path (`#embedAndStore`) as a
   full ingest, so it neither adds nor removes any redaction. Should chunks be redacted before
   embedding (cost: the high-entropy sweep false-positives on code, and chunk text no longer
   matches the file)? Left as-is; S13 stays a Phase 3 item per the hard rules.
2. **Wiki dir outside the index roots** (absolute `knowledge.wiki_dir`, or `watch_paths` that
   excludes `docs/wiki`) is watched for writes made while a server runs, but has no session-start
   catch-up: the manifest tracks only the sync roots (a foreign key would read as "deleted" and
   erase it). Add a separate manifest section for extra roots, or widen the sync to multi-root?
3. **Always-on poller.** The daemon starts with every `golem mcp serve` (opt-out env
   `GOLEM_KB_WATCH=off`; 5000-file cap, 2s poll are constants). Promote to
   `knowledge.watch_enabled` / `knowledge.watch_max_files` config keys (touches team-policy and
   the UI model)?
4. **Multi-root and file-root builds** still use the one-shot full index (no mid-build
   checkpoint); only the single-directory-root build resumes.

### Known limits after independent review (DUST2.14, documented, no code)

- **File replaced by a directory of the same name, or grown past 1 MB.** The watcher's scan
  skips both, so no event fires and the file's old chunks stay until the next session's sync
  (which sees it as deleted). Search can return that stale text for the rest of the session.
- **realpath TOCTOU.** The daemon re-resolves each changed path before reading it, but a symlink
  swapped in between that check and the read still slips through. The scan itself never follows
  symlinks, so exploiting it needs a local writer racing the daemon (low).
- **Startup sync and daemon can embed the same file.** Reduced, not removed: the daemon starts
  after the sync, skips a file the manifest already records at the same stat, and remembers what
  it indexed. A file edited while the sync runs is indexed by whichever sees it first.
- **Redaction before embedding** is unchanged and remains a USER decision: chunks are indexed as
  read, through the single `#embedChunks`/`upsert` path a full ingest uses.
- **Leader gap.** When the leader dies, edits made before a follower's next retry (30s) and
  takeover are picked up by the takeover catch-up sync, not instantly.
- **A scan counts every walked file.** A tree with more than 10x `maxFiles` regular files (50 000
  at the default) is not watched at all (the wiki still is, on its own watcher).
