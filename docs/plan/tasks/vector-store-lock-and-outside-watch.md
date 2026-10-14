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

## Notes from the fix (2026-10)

- **Lock wait budget.** A dead lock holder plus a dead `<lock>.break` sidecar can each cost one `staleMs` (30 s) before they are cleared, so the default 60 s wait can be consumed by that alone and surface as `vector store lock timeout`. No code change; retry succeeds.
- **Write fence.** `acquireLock` now returns a release with `assertHeld()` and a sticky `lost` flag; `#flush` re-verifies the owner token before each commit rename and aborts (nothing written) with `vector store lock lost before commit`. Residual: a filesystem has no compare-and-swap, so a stall longer than `staleMs` plus an exact interleave can still let a break replace a fresh lock; the fence turns the overwrite into an aborted write.
- **Follow-up (not fixed): no migration for old relative-keyed outside-target chunks.** Chunks written by an outside `golem index <dir> --watch` BEFORE the `external:` namespace stay under their old relative `sourcePath` (for example `README.md`) and are still served by `search` as orphans. Repro: on an old build run `golem index ../other` (project id = this repo), then upgrade; `golem search` still returns the old `README.md` chunk from `../other`. The auto-index sync path removes them via the manifest; an explicit index does not.
- **Follow-up (not fixed): the namespace only applies when `projectId` is an absolute path.** `projectBaseDir` returns the target itself for a relative project id, so a relative `project_id` or `--dir .` still keys an outside target relative to itself and can collide with project files. Repro: set `project_id` to a relative name, `golem index ../other --watch`, edit `../other/README.md` where the project also has `README.md`.
- **Residual (documented, not closed): C1/C2/B3/B4 sidecar interleaving.** With a stale lock and a stale sidecar, two clearers judge the sidecar stale, one clears it, a breaker B3 creates a fresh sidecar and passes its check, the other clearer renames B3's sidecar away, B4 creates a new one (the put-back hits EEXIST), and B3 and B4 both take over. It needs a few ms of lag, not a stall. Discarding instead of putting back would not close it (B3 is already past its check). The write fence bounds it to an aborted write unless the winner's whole read-modify-write finishes before the other rename lands; a leftover sidecar blocks breakers for at most one `staleMs`.
- **Residual: half-commit.** If the lock is lost between the two `assertHeld` calls in `#flush`, `meta.json` (new dimension) is committed and `chunks.jsonl` is not; the next load drops the old-dimension chunks, so a different-dimension reindex can lose the old collection. Needs a holder stalled past `staleMs` AND an embedder change.
- **Follow-up (not fixed): watcher errors are swallowed.** `knowledge-base.ts` (~:210) ends the watch handler with `.catch(() => {})`, which now also hides lock-lost aborts. A `reindexFiles` whose delete committed and whose upsert aborted leaves that file chunk-less until the next sync.
- **Follow-up (not fixed): `#readDisk` is synchronous** and can block the event loop for about `staleMs` on a huge `chunks.jsonl`, so a live holder can lose its lock and processes can keep aborting each other.
- **Follow-up (not fixed): case-insensitive roots.** `realpathSync` (JS) keeps the spelled case, so `Proj` vs `proj` on case-insensitive macOS/Windows is still treated as outside; `realpathSync.native` would fix it.
- **Follow-up (not fixed): leftovers are never swept.** `.break.clear.<token>` and `.take.<token>` files left by a crash are not cleaned up.
- **Fixed in review: symlink into a project subdirectory.** `projectBaseDir` now uses the climbed (target-spelled) base only when it really resolves to the project root; otherwise the project root is the base and the files are keyed `external:`.
