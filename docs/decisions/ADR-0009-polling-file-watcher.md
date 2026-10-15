---
title: ADR-0009 Polling File Watcher
type: adr
tags: [knowledge, file-watching, cross-platform, decision]
sources: [docs/decisions/ADR-0001-file-watcher.md, docs/plan/verification-notes.md, docs/plan/audit/dust-1/DECISIONS.md]
created: 2026-10-08
updated: 2026-10-08
---

# ADR-0009: Polling File Watcher

**Status:** accepted (2026-10-08). Supersedes [[ADR-0001 File Watcher Backend]],
which stays in the log as history. Written under the DUST Phase 1 default rule
("doc follows shipped code", `docs/plan/audit/dust-1/DECISIONS.md`, contradiction
K1): the watcher that ships is not the one ADR-0001 decided, so the decision is
recorded here instead of rewriting ADR-0001.

## What ADR-0001 decided, and what shipped

ADR-0001 chose `node:fs.watch` with `recursive: true` on Windows and macOS and a
manual per-directory watch-and-rewalk on Linux, with `chokidar` as the documented
fallback behind one `FileWatcher` interface.

None of that ships. The code has no `fs.watch` call and no `chokidar` dependency
(`src/knowledge/file-watcher.ts:1-27`; `grep -rn "chokidar" package.json` finds
nothing). The T6 commit (`a7c2a1f`, 2026-07-11) implemented ADR-0001, and the
2026-07-17 fix (`95d67b7`) replaced it after CI failed (verification-notes §68).

## Decision

**Every OS uses one polling backend.** `watchPath` (`src/knowledge/file-watcher.ts:99`)
scans the tree with `scanFiles` (pruned by `SKIP_DIRS`, chunkable files only) every
`pollMs` (default 1000, `:105`) and diffs mtime and size against the previous
snapshot. The scan is self-scheduling, not `setInterval`, so a slow scan on a
large tree never overlaps itself (`:155`). A baseline snapshot is taken at start,
so only changes after the watch begins are reported (`:134`).

Detected changes go through a debounce (default 500 ms) and a re-stat before
classification, so a burst of saves or a `git checkout` becomes one batch and a
half-written file gets time to settle (`:107-127`). The batch is handed to the
same `reindexFiles` / `removeSourcePaths` machinery ADR-0001 named, through
`GolemKnowledgeBase.ingest(..., watch: true)` (`src/knowledge/knowledge-base.ts:182-208`).

## Why not `fs.watch`

Neither of ADR-0001's `fs.watch` shapes is safe on Windows or macOS. libuv's
fs-event layer aborts the whole process, uncatchably and with no `error` event,
through `uv__relative_path`'s assertion
`!_wcsnicmp(filename, dir, dirlen)` (`src\win\fs-event.c`) when
`GetLongPathNameW` of a changed file does not prefix-match the watched directory.
That path runs for every directory watch, recursive or not, so the per-directory
design ADR-0001 chose for Linux fails the same way, and canonicalizing the
watched path does not avoid it. It fired on GitHub runner temp paths and could
crash a real Windows user. Full evidence: verification-notes §68 (fix
2026-07-17). ADR-0001's Option 2 was therefore rejected by evidence, not by
preference.

## Consequences

- No new dependency, and `chokidar` is still not adopted. ADR-0001's "swap in
  only if native watching proves unreliable" condition did occur, but polling
  solved it without a dependency.
- The `FileWatcher` interface seam ADR-0001 asked for exists
  (`file-watcher.ts`, `FileWatcher` and `FileWatcherOptions`), so a later backend
  swap stays a backend change.
- One code path on every OS, so the Linux CI leg exercises what Windows and macOS
  run. There is no per-platform branch to test.
- Cost: change latency up to `pollMs`, plus a periodic stat-scan of the tree.
  Acceptable for opt-in KB freshness, which is what this feeds.
- The same reasoning applies elsewhere: `src/cli/persona-watcher.ts:16` records
  why it also polls instead of using `fs.watch` or `fs.watchFile`.
