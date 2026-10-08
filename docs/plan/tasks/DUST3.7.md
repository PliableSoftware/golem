---
task: DUST3.7
title: "Vector store integrity: no cross-process lost updates, stale vectors dropped, sub-path index keeps the manifest, no duplicate files, getChunk opens its collection"
state: queued
owner: agent
size: L
discipline: code
design: "SUMMARY.md DUST1.4 D6 (high impact), D3, D4, D5, D7; DUST1.4 'Dead candidates'; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after (D6 with two writers in separate processes or two driver instances on one file); golem verify exit 0 before AND after; suite test count does not drop except the tests of deleted symbols, deleted with them."
depends_on: []
touches: [src/knowledge/file-driver.ts, src/knowledge/knowledge-base.ts, src/knowledge/ingest.ts, src/knowledge/index.ts, src/cli/auto-index.ts, src/cli/commands/local-ollama.ts, tests]
created: 2026-10-08
---

## What this is

The file vector store loses data in normal use. Every Claude Code session runs the `mcp serve`
daemon and the WebFetch hook, and each loads its own copy of `chunks.jsonl` and rewrites the
whole file. Pages the hook ingests are erased by the daemon. Fix that first, then the smaller
index-integrity bugs.

Work in your own worktree (`git worktree add ../golem-dust3-7 -b dust3-7 development`), failing
test first, commit each fix as it goes green. DUST2.14 (watcher, resumable checkpoints) touches
`src/knowledge` and `src/cli/commands` too. If it is in flight, rebase rather than resolve by hand.

## The work

1. **D6: cross-process lost update** (`src/knowledge/file-driver.ts:152-153,218-225`). Load once
   per process, then a whole-file temp+rename rewrite with no lock and no reload. Fix: a lockfile
   around reload-merge-write, or append-only records with compaction. Keep the default install
   free of native deps. Test: two driver instances on one store write different chunks, and both
   survive.
2. **D3: a file that stops yielding chunks keeps its old vectors** (`src/knowledge/knowledge-base.ts:263-264`).
   Delete by the input files' source paths, not by the paths present in the new chunks.
3. **D4: `golem index <path>` and `--watch` wipe the manifest file map**
   (`src/cli/commands/local-ollama.ts:210-217`, `src/cli/auto-index.ts:439`).
   `writeManifest(..., [target], now)` leaves `files = {}`. Merge into the existing map.
4. **D5: a sub-path ingest duplicates files** (`src/knowledge/ingest.ts:156,199`). `sourcePath` is
   relative to the ingest target, not the project root. Make it project-relative.
5. **D7: `getChunk` misses until the collection is opened** (`file-driver.ts:279-283`,
   `knowledge-base.ts:176-180`). Open the collection on a miss.

## SAFE-TO-DELETE (execute)

| item | where | proof |
|---|---|---|
| `asFederatedSearch` | `src/knowledge/knowledge-base.ts:337`; barrel `src/knowledge/index.ts:86` | `grep -rnw --exclude-dir=node_modules asFederatedSearch src tests scripts vscode-extension` → 2 hits (definition + barrel) |

## NEEDS-USER (proposals only, do not delete)

| item | file:line | evidence | recommendation |
|---|---|---|---|
| `resolvePersistedEmbedMode` | `src/cli/auto-index.ts:136` | No `src/` caller; its own describe block in `auto-index.test.ts`; a comment at `src/cli/proxy-runtime.ts:115` | Delete with its tests and the comment |
| `isPdfExtractionAvailable` | `src/knowledge/extractors.ts:52` | No `src/` caller; one case in `extractors.test.ts`; its comment's "golem ext registry uses it" is false (`src/pkg/manifest.ts:253` has its own detect) | Delete with its test case |
| `knowledge.vector_db_url` + Qdrant branch | `src/config/schema.ts:479`; `src/knowledge/index.ts:177-182`; `ui-model.ts:414` | Public config key; no reader passes it; the branch only throws NotImplementedYet; K4 retired the doc claim | Retire the key via `RETIRED_SETTINGS` (warns) and delete the branch |
| `InMemoryVectorDriver` | `src/knowledge/driver.ts:139` | Test fixture used by 30+ tests | Keep |

## Out of scope

- D10 (full rebuild deletes first, checkpoints at end): DUST2.14.
- D8 web-cache freshness: DUST2.13. D1 user-wiki-wins: intended (K2).
- Wiki write path, distill, frontmatter, rerank, watcher shutdown: DUST3.8.
