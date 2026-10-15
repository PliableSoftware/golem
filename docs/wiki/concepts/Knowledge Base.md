---
title: Knowledge Base
type: concept
tags: [rag, vector, search, knowledge, embeddings]
sources: [src/knowledge/knowledge-base.ts, src/knowledge/file-driver.ts, src/knowledge/chunker.ts, src/mcp/search.ts, src/cli/auto-index.ts, src/knowledge/watch-daemon.ts, src/knowledge/file-watcher.ts, src/knowledge/driver.ts, src/wiki/frontmatter.ts, docs/golem-spec.md#3.1]
created: 2026-07-25
updated: 2026-10-15
---

# Knowledge Base

Golem's local RAG layer: a per-project vector index over the documents you ingest
(codebases, docs, ADRs, fetched web pages), plus a **graph-first** lookup that lets
the committed [[Wiki-First Knowledge|wiki]] answer before similarity search ever
runs. Claude reaches it through the `search` / `fetch` / `ingest` MCP tools. Source:
`src/knowledge/knowledge-base.ts`, `src/mcp/search.ts`.

> **Local answers quote only durable prose:** the proxy's local answer (Decision 33)
> serves extractive quotes from indexed markdown but never from `docs/plan/`
> (working state) or `docs/marketing/` (unverified draft copy). Both stay ingested
> and searchable; the exclusion is `isProseSource` in `src/knowledge/local-answer.ts`.

> **Code vs spec:** spec §3.1 targets Qdrant; the shipped default is an on-disk
> `FileVectorDriver` (`src/knowledge/file-driver.ts`) — no server process, zero
> install friction — behind the same `VectorDriver` seam a Qdrant driver can later
> implement; the old `knowledge.vector_db_url` key is deprecated (accepted, ignored, warned
> once on load). **One collection per project** (no cross-project bleed). Without a
> configured embedder, `ingest`/`search` degrade rather than crash. `canonicalProjectId`
> collapses a project id to one identity — Windows path-spelling variants, and (as
> of 2026-08-22) a git worktree resolving to its main checkout — see
> [[CCR Ref Scope]] for the sibling decision this agrees with.

## Ingest path (write)

A file, directory, fetched page, or ingested doc is chunked, each chunk embedded by
the tier-appropriate model, and the vectors upserted. An optional file watcher
incrementally re-indexes on change (ADR-0001).

```mermaid
flowchart LR
  SRC["File / dir / web page / doc"] --> CH["Chunk<br/>heading-aware md · tree-sitter code (opt) · pdf/html extract"]
  CH --> EMB["Embed per kind<br/>text vs code model, tier-selected (Ollama)"]
  EMB --> UP["Upsert vectors<br/>VectorDriver (FileVectorDriver default)"]
  WATCH["File watcher (opt)"] -.->|"on change"| RE["reindex changed / remove deleted"]
  RE --> UP
```

## Index freshness: the watch daemon and resumable builds (DUST2.14)

While `golem mcp serve` is up, `startKnowledgeWatch` (`src/cli/auto-index.ts`) runs one
**watch daemon** (`src/knowledge/watch-daemon.ts`) over the index roots (`knowledge.watch_paths`,
else the project) **and the wiki dir**, so a `wiki_upsert` or an editor save reaches the vector
index without a manual `ingest`. A wiki dir inside a root is covered once; one outside (an absolute
`knowledge.wiki_dir`) gets its own watcher and `external:` keys. Set `GOLEM_KB_WATCH=off` to disable.
The wiki stays the truth: the daemon only reads pages and writes the derived index.

- **Polling, bounded.** Same polling watcher on every OS (no native dependency; the pages it
  watches are the [[Wiki-First Knowledge|wiki]]). One watcher per distinct root, a cap of
  5000 chunkable files per root (a larger tree is not watched, with a log line; a tree that grows past
  it pauses reporting until it shrinks), 2s poll, debounce, `node_modules`/`.git`/`dist`/`.golem`
  and dot-dirs pruned. Pending work is keyed by path, so an event storm or a rename-over-existing
  settles on the final state; one apply runs at a time, deletions first, in slices of 20 files.
- **Never throws into the host.** Every failure is counted (`daemon.stats.errors`), logged, and
  swallowed; a failed batch leaves the manifest behind the index, so the next session's sync
  redoes it. Shutdown closes watchers, clears timers, drops queued work and waits for the apply in
  flight.
- **Never reads outside a root.** Each changed path is re-resolved with `realpath.native` and
  dropped unless still inside its root's real path (a symlink swapped in after the scan, `..`).
- **Checkpoints.** The manifest (`manifest.json` beside each collection) is **versioned**
  (`version: 1`; an absent field reads as 1, a higher one is not trusted), written atomically
  (`replaceViaTemp`), and validated on read: a corrupt, truncated or newer-format manifest is
  discarded with a warning and the collection is rebuilt from the files, never half-believed.
  The first build is no longer one shot: it starts from an empty manifest and runs the same
  checkpointed sync (deletions first, then a checkpoint every 20 files), so a build killed halfway
  keeps every finished batch and the rerun continues without duplicating or losing chunks. The
  daemon folds what it indexed back into the manifest (stat taken before the read, so the record can
  lag the content, never lead it); files outside the sync roots are never recorded.

See [[Auto-Index Cost]] for what the session-start sync spends.

## Search path (read) — graph-first, then vector

`assembleHits` (`src/mcp/search.ts:207`, module-local; moved out of `server.ts` by the R8.28 split) is the one place hit assembly lives, shared by
the `search` tool and the `coder` tool's grounding. It tries a cheap, precise
**wiki title or alias match** (and one hop along that page's `[[wikilinks]]`) with **no
embedding call**, then always runs vector search too, de-dupes, boosts wiki hits
above other sources, and optionally reranks with a local chat-judge.

```mermaid
flowchart TB
  Q["search(query)"] --> GF["Graph-first wiki lookup<br/>exact title / alias match → one-hop wikilinks (no embedding)"]
  GF --> VEC["Vector search<br/>embed query → cosine top-k"]
  VEC --> DEDUP["De-dupe vs graph hits"]
  DEDUP --> BOOST["Boost wiki hits above other sources"]
  BOOST --> RR{"rerank enabled?"}
  RR -->|"yes"| JUDGE["Chat-judge rerank (local model)"]
  RR -->|"no"| OUT["Top-k hits → fetch for full text"]
  JUDGE --> OUT
```

`graphFirstWikiHits` (`src/mcp/search.ts`) is re-exported from `src/mcp/server.ts`
but lives in `search.ts`.

**Aliases (DUST2.15).** A page's frontmatter `aliases: [PC, Cache Warmup]` (a bracketed
list or one bare scalar; optional, parsed by `src/wiki/frontmatter.ts`, never written by
`wiki_upsert` but kept verbatim on rewrite) is matched like a title: case-insensitive,
trimmed, blanks and repeats ignored. Order is deterministic: the title match first, then
every alias match in `relPath` order — an alias shared by two pages surfaces **both**.
A `[[wikilink]]` in the one-hop step may name an alias too (a title wins over an alias,
the first `relPath` wins between aliases). Tables are built in one pass, so a large wiki
costs O(pages + links). An alias hit scores 1.9, under an exact title (2) and over a
linked page (1.6). The title-collision rule below is unchanged. On a title collision between the project wiki and the
user-scope wiki, graph-first builds its title map with `Map.set` over a page list that
puts user pages last, so the **user page wins** (`search.ts:172-173`,
`federated-wiki-reader.ts:39`); `readPage`/`resolveLink` still prefer the project page.
The two paths disagree and that is left open (audit contradiction D1); see
[[Wiki-First Knowledge]].

Graph-first is **purely additive**: a free-text query that names no page just skips
straight to vector search, so nothing regresses. This is why keeping the wiki current
pays off directly — see [[Wiki-First Knowledge]].

## Embedder identity on build

A build never silently narrows an existing index. `planBuildEmbedder`
(`src/cli/auto-index.ts:328`) compares the embedder recorded in the manifest with the
one the detected hardware tier would use, and returns one of four plans:

- `use-current` — no semantic index yet, or the tier's model built it.
- `pin` — keep the existing index's model, because the tier's would narrow the vectors
  (a degraded capability probe must not trigger a full re-embed at 768 in place of 1024).
- `reembed` — the whole index is re-embedded into another space (a wider model is now
  available, or the original is gone); a notice says so.
- `lexical` — no semantic model is available; the built-in lexical embedder is used,
  with a notice that retrieval is weaker.

Underneath, `EmbedderMismatchError` (`src/knowledge/driver.ts:42`) rejects a query whose
vector width differs from a non-empty index, and `FileVectorDriver.upsert` resets the
collection when incoming vectors have a new width (`src/knowledge/file-driver.ts:196-209`).
Cost side: [[Auto-Index Cost]].

## Scopes and federation

`search` can span more than the project index:

- **knowledge** (default) — the project's own vector index (code, docs, and pages
  fetched via [[Web Cache]]).
- **memory** (opt-in) — Headroom's conversational memory, via the optional Python
  sidecar (Decisions 13/18). Absent it, search silently degrades to knowledge-only.
- **user-scope wiki** — `~/.golem/wiki/` federated read-only across projects.

Hits from every active scope are merged, sorted by score, and truncated to *k*. Full
text for any hit comes back through `fetch` (`getChunk`), so Claude pulls ~2–5K
tokens of relevant chunks instead of reading whole directories.

## `fetch` coverage and safety

`fetch(chunk_id)` resolves every hit kind `search` returns:

- **Stored chunks** (ingested trees, cached web pages) — `getChunk` on the vector store,
  looked up by the opaque id only. A chunk's `source_path` may be `external:<abs path>`
  (an index target outside the project); it is data, never joined to a base or read from
  disk by `fetch`.
- **Graph-first wiki hits** (`wiki:<relPath>`, `user:`-prefixed for the user wiki) —
  read from the wiki store. An id with `..`, an absolute or drive path, a backslash or NUL is
  refused before the store sees it, and the store refuses anything escaping the wiki dir.
- **Memory-scope hits** (`memory:<id>`) — Headroom has no lookup by id, so the server keeps
  the last 200 memory hits `search` returned and serves the full text from that; an id
  `search` never returned is a clear error.

Anything missing or refused answers `Unknown chunk "<id>"` as an error result, never a crash.

See [[Architecture]] for how the KB sits beside the proxy and inference router, and
[[Distillation Pipeline]] for how raw captures become durable, linkable pages.
