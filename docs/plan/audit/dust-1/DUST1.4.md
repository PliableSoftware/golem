# DUST1.4 — knowledge base, wiki, web cache, repo map, LSP bridge: docs vs code

Audit of `fd3aedc` (development), worktree `golem-dust1.4`, branch `dust/DUST1.4`.
Read-only. Nothing outside this file was changed. No tests were run: every
classification below comes from reading the code directly, and the test column
names the file that covers the behaviour (or says none does).

Owned docs: spec §3.1; Decisions 2, 3, 13, 17, 24, 28, 29, 42, 44, 54 and the
KB-retrieval half of 33; ADR-0001; wiki `concepts/` Knowledge Base, Wiki-First
Knowledge, Distillation Pipeline, Web Cache, Auto-Index Cost, Repo Map, LSP Bridge;
the zone/write rules in `WIKI.md`.

## Bucket counts

| class | count |
|---|---|
| shipped-and-matches | 57 |
| shipped-but-drifted | 16 |
| partial | 7 |
| not-started | 3 |
| dead-or-superseded | 7 |
| **classified rows** | **90** |
| unverifiable here (not counted) | 8 |

No existing `docs/plan/tasks/` doc covers any partial or not-started item. I checked
every queued task and grepped `touches:` and the bodies for qdrant, watch, alias,
separator, federat, webcache, distill and redact. So the task column reads `none`
throughout.

## Classification table

Paths are repo-relative. `T:` is the test file that covers the behaviour; `—` means
none was found.

### Spec §3.1 and the store Decisions (2, 3, 13, 17, 24)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Vector DB is embedded Qdrant | §3.1 l.163; Dec 3 (l.309) | `src/knowledge/index.ts:175-188` (FileVectorDriver default) | T: `tests/unit/knowledge/file-driver.test.ts` | dead-or-superseded | Dec 17 and the §26 refinement replaced it, but §3.1 was never re-worded. It still reads "Qdrant … embedded local mode" | none |
| Qdrant **server** via config URL ("fully supported", Dec 17; Dec 12) | §3.1 l.163; Dec 17 (l.323) | `src/knowledge/index.ts:177-182` throws `NotImplementedYetError`; `src/cli/build-knowledge.ts:137-143` never passes `vectorDbUrl`; the only reader of `knowledge.vector_db_url` is the schema (`src/config/schema.ts:476`) | — | not-started | Setting the key has no effect and gives no warning. The one code path that would throw on it is unreachable | none |
| One collection per project | §3.1; Dec 3; KB page l.21 | `src/knowledge/file-driver.ts:85-91` (`collectionDir` = sha256(canonical id)[0..16]) | T: `file-driver.test.ts`, `file-driver-contract.test.ts` | shipped-and-matches | | none |
| Opt-in shared cross-project "knowledge" collection | §3.1 l.163 | none (the user-scope wiki, `src/wiki/federated-wiki-reader.ts`, is a different mechanism) | — | not-started | | none |
| `search_local` federates memory + knowledge "with a shared reranker" / "merged and reranked" | §3.1 l.162; Dec 2 (l.308); Dec 13 (l.319) | merge: `src/knowledge/knowledge-base.ts:152-173`; rerank opt-in: `src/mcp/search.ts:222`, `schema.ts:599,1145` (`rerank_enabled` false); memory opt-in: `schema.ts:608,1146` | T: `tests/unit/knowledge/knowledge.test.ts`, `rerank.test.ts` | shipped-but-drifted | Cosine scores and Headroom memory scores are merged on one scale with no normalisation (`knowledge-base.ts:173`). There is no shared reranker, only the optional chat-judge, which is off by default | none |
| Text-model vs code-model embeddings ("Embed per kind", KB page mermaid) | §3.1 l.164; KB page l.36 | `src/inference/catalog.ts:36-37,48,63,74-75,86-87` maps both kinds to the same model on every tier; `src/cli/build-knowledge.ts:119-124` pins both together | T: `tests/unit/cli/build-knowledge.test.ts` | shipped-but-drifted | R10.7 unified the models on purpose (one index is one vector space). The code is right; the doc still describes two models | none |
| Lexical fallback when no semantic embedder ("degrade rather than crash") | KB page l.22 | `src/knowledge/index.ts:165-166`; `src/knowledge/hashing-embedder.ts` | T: `hashing-embedder.test.ts` | shipped-and-matches | | none |
| File-watcher daemons for chosen paths | §3.1 l.165; KB page l.30-31, l.38; `schema.ts:477` ("watched for changes") | watcher: `src/knowledge/file-watcher.ts:99-179`. It is started only by `ingest(…, watch:true)` (`knowledge-base.ts:199-209`), from `golem index --watch` (`src/cli/commands/local-ollama.ts:159,209`) or the MCP `ingest` tool (`src/mcp/search.ts:502`). `mcp serve` scans `watch_paths` once at startup (`src/cli/commands/mcp-serve.ts:166-184`) | T: `tests/integration/knowledge-watch.test.ts`, `tests/unit/knowledge/file-watcher.test.ts` | partial | Nothing watches `watch_paths`, and no watcher daemon exists | none |
| tree-sitter code chunking | §3.1 l.165; KB page l.35 | `src/knowledge/ingest.ts:79-90`; `schema.ts:527,1139` (opt-in, off) | T: `tree-sitter-chunker.test.ts` | shipped-and-matches | The KB page labels it "(opt)" | none |
| Heading-aware doc chunking | §3.1 l.165 | `src/knowledge/chunker.ts:92-134` | T: `chunker.test.ts` | shipped-and-matches | | none |
| pdf/html extraction on ingest | KB page l.35 | `src/knowledge/ingest.ts:67-72`; `src/knowledge/extractors.ts:89,122-130` (pdf needs optional `unpdf`) | T: `extractors.test.ts` | shipped-and-matches | | none |
| MCP tools `index_path`, `search_local(query,k,filter)`, `get_chunk(id)` | §3.1 l.166 | `src/mcp/search.ts:300-332` (`search(query,k,project_id)`), `:374-440` (`fetch`), `:460-528` (`ingest`) | T: `tests/integration/mcp-knowledge.test.ts` | shipped-but-drifted | Renamed (Dec 27/35). There is no `filter` parameter and no `scopes` parameter | none |
| Dec 2: memory on Headroom's Qdrant; evaluate `--code-graph` | Dec 2 (l.308) | superseded by Dec 13 and Dec 17; no `--code-graph` evaluation appears in code (the repo map is Golem's own, `src/knowledge/repo-map*.ts`) | — | dead-or-superseded | | none |
| Dec 13: Headroom memory on its own backend, federated as a second store | Dec 13 (l.319) | `src/cli/build-knowledge.ts:133-135`; `knowledge-base.ts:152-169`; `fetch` refuses memory ids, `src/mcp/search.ts:395-402` | T: `knowledge.test.ts` | shipped-and-matches | The "reranked" half is drifted; see the federation row | none |
| Dec 17: LanceDB as the embedded engine (sqlite-vec fallback) | Dec 17 | `src/knowledge/file-driver.ts:1-15` (pure-TS JSONL driver, LanceDB left as an "optional scale upgrade") | T: `file-driver.test.ts` | dead-or-superseded | No LanceDB code exists. Stale comments still name it (see below) | none |
| Dec 24: proxy-side KB substitution, "design memo only; not built" | Dec 24 (l.372-378) | sub-mode 1 is built: `src/compression/context-substitution.ts`, `src/cli/proxy-runtime.ts:270-275`, `src/knowledge/web-cache.ts:178-185`. Sub-mode 2 is built via Dec 33 (`src/knowledge/local-answer.ts`) | T: `tests/unit/pipeline/local-answer-stage.test.ts` | dead-or-superseded | The status text is stale, and its "slider ≥3" gating was retired by ADR-0004 | none |

### Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `wiki_dir` setting, default `docs/wiki`, env `GOLEM_KNOWLEDGE_WIKI_DIR`, user wiki `~/.golem/wiki` | Dec 28 (l.406) | `schema.ts:497,1136`; `src/config/env.ts:6-12` derives the env name; `src/cli/wiki.ts:104-118` | T: `tests/unit/cli/wiki.test.ts` | shipped-and-matches | | none |
| Graph-first lookup "title/**alias**/wikilink" | Dec 28 (l.405); Wiki-First l.15 | `src/mcp/search.ts:164-187` (exact case-insensitive title plus one wikilink hop) | T: `mcp-knowledge.test.ts` | partial | Aliases are not implemented. There is no alias frontmatter and the lookup never reads the `[[T\|alias]]` form | none |
| Redaction before storage on every wiki write | Dec 28 (l.406); Dec 44; WIKI.md rule 1 | the distill paths strip secrets (`src/knowledge/distill-store.ts:33,68,105`), but `wiki_upsert` → `FileWikiStore.upsertPage` writes verbatim (`src/mcp/wiki-tools.ts:134-150`, `src/wiki/file-wiki-store.ts:125-173`) | — | partial | Only the promote path runs over redacted input. The direct write path does no redaction | none |
| Wiki pages reach the index through the watcher ("wiki write → watcher → vector index") | Dec 28 (l.408); ADR-0001 context | no reindex on `wiki_upsert` (`wiki-tools.ts:145-150`); the wiki is indexed only by the next session-start sync (`mcp-serve.ts:166`) | — | not-started | Graph-first reads the disk, so a title lookup sees a new page immediately. Vector search does not see it until the next session | none |
| `upsertPage` appends under a **dated** `---` separator, union-merges tags/sources, bumps `updated` | Dec 29 (l.417); `wiki_upsert` description `wiki-tools.ts:104-106`; Distillation l.150-151 | `src/wiki/file-wiki-store.ts:152-164` writes a bare `\n\n---\n\n` with no date; the union and the `updated` bump match | T: `tests/contract/wiki-contract.ts:53-76` (asserts both bodies are present; the separator and its date are not pinned) | shipped-but-drifted | See Contradictions | none |
| Two tools, `wiki_read` / `wiki_upsert` | Dec 29 (l.414) | `src/mcp/wiki-tools.ts:47-165` | T: `tests/integration/mcp-wiki.test.ts` | shipped-and-matches | | none |
| Plan-gated agent writes, "propose, get approval, then `wiki_upsert`" | Dec 29 (l.413); Wiki-First l.22, l.61-65; Distillation l.130-134 | superseded: `wiki-tools.ts:100-103` ("Author freely"); `src/cli/init-claude-settings.ts:92,275-289` removes the legacy ask rule | T: `mcp-wiki.test.ts` | dead-or-superseded | The Wiki-First and Distillation pages still teach the gate that Dec 44 and Dec 54 removed | none |
| Lazy webcache backfill: the pointer to an existing draft is added to the served content | Dec 29 (l.415); Distillation l.77-83 | `src/hooks/web-fetch/serve.ts:213-225`, in its own try/catch | T: `tests/integration/hooks/web-fetch.test.ts` | shipped-and-matches | | none |
| Dec 44: de-gated authorship; ADRs live outside the wiki; `promote` refuses `adr`; scaffold has no `decisions/` | Dec 44 | `src/cli/wiki.ts:19-32`; `src/cli/promote.ts:143-150`; `wiki-tools.ts:100-107` | T: `tests/unit/cli/promote.test.ts`, `wiki.test.ts` | shipped-and-matches | | none |
| Dec 54: init writes only the allow rule and removes the legacy `wiki_upsert` ask rule | Dec 54 | `src/cli/init-claude-settings.ts:263-289` | T: cli-init tests (DUST1.8's area) | shipped-and-matches | The spec says "`src/cli/init.ts` only", but the code lives in `init-claude-settings.ts`. Location only | none |
| WIKI.md zone 1 = `.golem/webcache`, `.golem/ccr` | WIKI.md l.21; Dec 28 | zone-1 stores also include `.golem/notes` (`src/cli/notes.ts:27-29`), `.golem/distill` (`distill-store.ts:24-26`) and `.golem/knowledge` (`src/knowledge/index.ts:136-138`) | — | shipped-but-drifted | The zone-1 list is incomplete. The Wiki-First and Distillation pages call notes and distill zone 1, but WIKI.md does not | none |
| WIKI.md zone-2 directories | WIKI.md l.22 | `src/cli/wiki.ts:24-32` | T: `wiki.test.ts` | shipped-and-matches | | none |
| "Author freely" (zone 2) | WIKI.md l.22 | `wiki-tools.ts:100-103` | T: `mcp-wiki.test.ts` | shipped-and-matches | | none |
| ADRs outside the wiki at `docs/decisions/` | WIKI.md l.24-28 | `src/cli/wiki.ts:19-23`; `promote.ts:143-150` | T: `promote.test.ts` | shipped-and-matches | | none |
| Required frontmatter and the page-type list | WIKI.md l.48-59; Dec 28 | `src/wiki/frontmatter.ts:11,56-58`; `src/cli/wiki.ts:190-200,511-525`; `src/interfaces/wiki.ts:22-31` | T: `tests/unit/wiki/frontmatter.test.ts`, `wiki.test.ts` | shipped-and-matches | WIKI.md's own `type: schema` is valid in code but missing from the list WIKI.md prints | none |
| Every page carries at least one wikilink | WIKI.md l.46-47 | `src/cli/wiki.ts:526-533` (the schema page is exempt) | T: `wiki.test.ts` | shipped-and-matches | | none |

### Knowledge Base page and Wiki-First page: search path

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| FileVectorDriver default behind the `VectorDriver` seam | KB page l.18-21 | `src/knowledge/index.ts:175-188`; `src/knowledge/driver.ts:73-90` | T: `file-driver-contract.test.ts` | shipped-and-matches | | none |
| `canonicalProjectId`: Windows spelling fold and worktree → main checkout | KB page l.22-25; Auto-Index l.56-65 | `src/knowledge/file-driver.ts:65-76` | T: `file-driver.test.ts` | shipped-and-matches | The identity collapses, but storage stays under each checkout's own `.golem/knowledge` (`src/cli/auto-index.ts:554`), so a worktree gets a separate collection with the same hash name | none |
| `assembleHits` "in `src/mcp/server.ts`"; `graphFirstWikiHits` "(`src/mcp/server.ts`)" | KB page l.44; Wiki-First l.33, l.87 | `src/mcp/search.ts:207-223`, `:164-187`; only re-exported from `server.ts:31` | T: `mcp-knowledge.test.ts` | shipped-but-drifted | Location only (the R8.28 split moved them). Behaviour matches | none |
| Graph-first with no embedding call, vector search always runs, de-dupe by sourcePath, wiki boost, optional chat-judge rerank | KB page l.45-64; Wiki-First l.31-47 | `search.ts:207-223`; boost `:91,105-115`; rerank `src/knowledge/rerank.ts:70-105` | T: `mcp-knowledge.test.ts`, `rerank.test.ts` | shipped-and-matches | | none |
| Hits from every scope are merged, sorted by score, truncated to k | KB page l.76 | `knowledge-base.ts:171-173` | T: `knowledge.test.ts` | shipped-and-matches | | none |
| "Matches score above any vector hit, so a query that names a page … always surfaces that page first" | Wiki-First l.36-37 | scores `search.ts:124-125`; with `rerank_enabled`, `rerankHits` may reorder graph hits below vector hits (`search.ts:222`) | T: `rerank.test.ts` | shipped-but-drifted | "Always" holds only while rerank is off, which is the default | none |
| `fetch` returns the full text of any hit (`getChunk`) | KB page l.76-78; §3.1 `get_chunk` | `src/knowledge/knowledge-base.ts:176-180` → `file-driver.ts:279-283` looks only at collections already loaded in *this* process; `getChunk` never calls `openCollection` | T: `tests/integration/knowledge-persistence.test.ts` (goes through search first) | partial | A chunk id reused from an earlier session, fetched before any search in the new process, returns "Unknown chunk". Pages ingested by the WebFetch hook process are never visible (defect D6) | none |
| `fetch` resolves `wiki:<relPath>` ids from the WikiStore | Wiki-First l.44-46 | `search.ts:403-430` | T: `mcp-knowledge.test.ts` | shipped-and-matches | | none |
| Falls back to vector-only when there is no WikiStore or `wikiDir` | Wiki-First l.46-47 | `search.ts:213-216` | T: `mcp-knowledge.test.ts` | shipped-and-matches | | none |
| Zone 1 → 2 capture: `golem note` and WebFetch redact, then store | Wiki-First l.53-55 | `src/cli/notes.ts:51-61`; `src/hooks/web-fetch.ts:264,459` | T: `tests/unit/cli/notes.test.ts`, `web-fetch.test.ts` | shipped-and-matches | | none |
| Promote is human-gated and only calls `wiki_upsert` on approval (Dec 29) | Wiki-First l.61-65 | superseded by Dec 44 (row above). `golem wiki promote` still asks for consent (`promote.ts:152-164`) | T: `promote.test.ts` | dead-or-superseded | | none |
| User-scope wiki at `~/.golem/wiki`, `golem wiki init --user` | Wiki-First l.69-76 | `src/cli/wiki.ts:116-118`; `src/cli/commands/wiki.ts:59-76` | T: `wiki.test.ts` | shipped-and-matches | | none |
| `FederatedWikiReader`: `user:` prefix, and "a title collision favors the project page" | Wiki-First l.78-82; `federated-wiki-reader.ts:48-49,63` | `readPage`/`resolveLink` let the project win (`federated-wiki-reader.ts:51-69`). **`listPages` returns user pages last** (`:39`) and graph-first builds `byTitle` with `Map.set`, so the **user page wins** (`src/mcp/search.ts:172-173`) | T: `tests/unit/wiki/federated-wiki-reader.test.ts:83` (covers `readPage` only) | shipped-but-drifted | `search`, through graph-first, surfaces the user page on a collision. See Contradictions and D1 | none |
| `backlinks` computed over the merged set | Wiki-First l.82-83 | `federated-wiki-reader.ts:76-86` | T: `federated-wiki-reader.test.ts` | shipped-and-matches | | none |
| Writes are never federated; `wikiSearch` defaults to the project wiki | Wiki-First l.83-86 | `mcp-serve.ts:336-345`; also wired at `src/cli/task-grounding.ts:52` | T: `mcp-wiki.test.ts` | shipped-and-matches | "Only the two wiring points" is no longer true (task-grounding is a third). Minor | none |
| `knowledge.user_wiki_enabled` defaults to true | Wiki-First l.91-93 | `schema.ts:590,1144` | — | shipped-and-matches | | none |

### Distillation Pipeline page

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `golem note`: pipelineRedact + stripKnownSecrets, `notes.jsonl`, `list` newest first | Distillation l.42-48 | `src/cli/notes.ts:51-78` | T: `notes.test.ts` | shipped-and-matches | | none |
| `distillPage`: summarizer role, strict JSON, wikilinks canonicalised to real titles, `DistillParseError` | l.52-61 | `src/knowledge/distill.ts:261-321` | T: `tests/unit/knowledge/distill.test.ts` | shipped-and-matches | | none |
| Drafts keyed by slug, so "distilling the same URL again overwrites its prior draft" | l.63-68 | `distill-store.ts:61` keys the draft on the **model-chosen** `draft.slug` (`distill.ts:284`), not the URL | T: `distill-store.test.ts` | shipped-but-drifted | `--force` re-distill with a different title leaves two drafts for one URL, and two URLs that get the same slug overwrite each other (D11) | none |
| `golem wiki distill <url>`: prefers an existing draft unless `--force`; clear errors; `--pending` | l.72-76 | `src/cli/distill.ts:49-95`; `commands/wiki.ts:102-108` | T: `tests/unit/cli/distill.test.ts` | shipped-and-matches | | none |
| The lazy pointer runs in its own try/catch | l.77-83 | `serve.ts:213-225` | T: `web-fetch.test.ts` | shipped-and-matches | | none |
| `/golem-wiki-ingest` runs `golem wiki distill` first | l.84-86 | `.claude/skills/golem-wiki-ingest/SKILL.md` (checked by grep only) | — | shipped-and-matches | | none |
| `distillNote`: question/artifact, `note:<ts>` source, `findDraftByNoteTs`, `golem note distill [ts]` | l.90-108 | `distill.ts:328-345`; `distill-store.ts:83-102,207-214`; `src/cli/distill-note.ts:43-93` | T: `distill-note.test.ts` | shipped-and-matches | | none |
| `synthesizeWeekly`: debriefs + notes, `--days` default 7, clear error when empty | l.112-128 | `src/cli/synthesize.ts:48-103`; `commands/wiki.ts:150-155` | T: `synthesize.test.ts` | shipped-and-matches | The sources are cited as `docs/wiki/debriefs/…` (with the prefix), not the bare relPath the page describes | none |
| Stage 3 "plan-gated, unchanged" | l.130-134 | superseded by Dec 44 | — | dead-or-superseded | | none |
| `golem wiki promote --list` / `<id> [--yes]`, "dated separator" append, draft removed, non-TTY refused | l.140-156 | `src/cli/promote.ts:138-190` | T: `promote.test.ts` | shipped-but-drifted | Everything matches except "dated separator", which inherits the Dec 29 drift | none |

### Web Cache page and Decision 42

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Content-addressed store under `.golem/webcache`, keyed by sha256(url) | Web Cache l.14-16 | `src/knowledge/web-cache.ts:46-53` (32-hex prefix plus a stored-url collision guard at `:89-90`) | T: `web-cache.test.ts` | shipped-and-matches | | none |
| PreToolUse fetch-cache-serve; redact before store; fail-open | Web Cache l.19-51; Dec 42 | `src/hooks/web-fetch.ts:221-301,311-418` | T: `web-fetch.test.ts`, `web-fetch-budget.test.ts` | shipped-and-matches | | none |
| Default TTL 168h; raw mode on by default | Web Cache l.53-54; Dec 42 | `web-fetch.ts:63`; `schema.ts:626,1148` | T: `web-fetch.test.ts` | shipped-and-matches | | none |
| Pages over ~8k are truncated inline and given a CCR `hash=` ref | Web Cache l.55-58; Dec 42 | `src/hooks/web-fetch/serve.ts:64,86-101,196-208` | T: `web-fetch.test.ts` | shipped-and-matches | | none |
| PostToolUse caches nothing in raw mode and captures the answer in legacy mode | Web Cache l.59-62; Dec 42 | `web-fetch.ts:447-463` | T: `web-fetch.test.ts` | shipped-and-matches | | none |
| A served page renders RED; the green alternative was "tested and **declined**" | Web Cache l.64-75 | the green path shipped (R9.12/R9.19): `serve.ts:1-21,132-165,243-264` (allow + `updatedInput` to the loopback stub, gated by cert, probe and reach latch) | T: `tests/integration/hooks/web-fetch-reach.test.ts` | shipped-but-drifted | The page is from 2026-08-09 and predates R9.12. On the green path WebFetch *does* run, against the stub, so "WebFetch never runs on the happy path" is not always true | none |
| Fresh within TTL **or** an explicit `max-age`/`Expires`; 304 → updateMeta; `no-store` or a changed 200 drops the entry | Web Cache l.77-92 | `isFresh` looks at the TTL only (`web-cache.ts:56-61`); `expiresAt` is read only when `webcache_revalidate` is on, and only for an entry already inside the TTL (`web-fetch.ts:370-377`); the first raw fetch ignores `no-store` (`web-fetch.ts:267-268`, `revalidate.ts:67-81`) | T: `web-fetch.test.ts:515` (only the revalidate-on case) | partial | With the default (revalidate off), `max-age`/`Expires` has no effect in either direction. A `no-store` page is cached for 7 days | none |
| Conditional revalidation is opt-in | Web Cache l.80-81 | `schema.ts:617,1147`; `web-fetch.ts:370-408` | T: `web-fetch.test.ts` | shipped-and-matches | | none |
| Fetched pages are also ingested into the KB, "so a re-fetch of a known URL is free and offline" and `search` finds them | Web Cache l.96-98; Dec 42 | the hook ingests through its own process's `FileVectorDriver` (`web-fetch.ts:195-211`, `src/cli/commands/prompt-guidance.ts:311-313`); the running MCP server never reloads (`file-driver.ts:153`) and its next flush overwrites the file (`file-driver.ts:218-232`) | — | partial | The cache half works. The KB half is lost or invisible while an MCP server is running (D6) | none |
| Dec 42 "15 s `AbortSignal.timeout`" | Dec 42 (l.480) | `src/knowledge/raw-fetch.ts:50` (11 s default) plus the remaining budget (`web-fetch.ts:240-253`) | T: `web-fetch-budget.test.ts` | shipped-but-drifted | The code is right (R9.21). The spec is stale | none |

### Auto-Index Cost page

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `mcp serve` calls `ensureProjectIndexed` fire-and-forget; `golem index` makes the same call | Auto-Index l.26-29 | `mcp-serve.ts:166-184`; `local-ollama.ts:175-187` | T: `tests/unit/cli/auto-index.test.ts` | shipped-and-matches | | none |
| Checkpoint every 20 files, deletions first; "a killed run keeps finished batches" | l.33-43 | incremental: `src/cli/auto-index.ts:519,632-657`. Full build: `fullIndex` writes the manifest once, at the end (`:522-543`), after `rm(dir)` (`:572,621`) | T: `auto-index.test.ts` | partial | The first-run, embedder-change and multi-root fallback builds still have repeat-cost bug #1. A killed run restarts from zero, and the old index is already deleted (D10) | none |
| `auto_index_max_files` default 50, `0` uncapped, passed only by `mcp serve`, not applied to the first build | l.45-54 | `schema.ts:491,1135`; `auto-index.ts:594-611`; `mcp-serve.ts:177` | T: `auto-index.test.ts` | shipped-and-matches | | none |
| Collection dir is sha256(canonical)[0..16]; separators folded only for Windows paths | l.58-65 | `file-driver.ts:65-91` | T: `file-driver.test.ts` | shipped-and-matches | | none |
| "see `planBuildEmbedder`'s notices in [[Knowledge Base]]" | l.53-54 | `auto-index.ts:278-420`; the KB page has no such section | — | shipped-but-drifted | The cross-reference points at nothing. R10.4/R10.6 embedder identity is documented nowhere in the owned pages | none |

### Repo Map page

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `extractFileFacts` in `tree-sitter-chunker.ts` is the only `web-tree-sitter` toucher | Repo Map l.34-36 | `src/knowledge/tree-sitter-chunker.ts` (exported `src/knowledge/index.ts:126-131`) | T: `tree-sitter-chunker.test.ts` | shipped-and-matches | | none |
| Import edges `./x.js` → `x.ts`; reference edges weighted `sqrt`; only exported non-member definitions | l.37-42 | `src/knowledge/repo-map-graph.ts:25,80-89,109` | T: `repo-map.test.ts` | shipped-and-matches | Undocumented detail: weight is divided by the number of definers, and identifiers with more than MAX_DEFINERS definers are dropped (`:9,109`) | none |
| Personalised PageRank; lower damping when steered; word-part affinity weighted by rarity | l.43-48 | `src/knowledge/repo-map-rank.ts:16-21,49-91`; `repo-map-graph.ts:171-190` | T: `repo-map.test.ts` | shipped-and-matches | | none |
| Budget, per-file cap, drops stated in a footer | l.49-50 | `src/knowledge/repo-map.ts:73-83,182-245` | T: `repo-map.test.ts` | shipped-and-matches | | none |
| Byte-stable: no clock, no randomness | l.52-58 | a grep of `repo-map*.ts` finds no `Date.`, `Math.random` or `performance.now` | T: `repo-map.test.ts` | shipped-and-matches | | none |
| `code` is one tool with a `mode`; `repo_map_enabled` gates registration; `read_skeleton_enabled` | l.72-88 | `src/mcp/server.ts:279-280`; `src/mcp/code-tool.ts:38`; `mcp-serve.ts:331`; `src/hooks/post-tool-use.ts:107` | T: `tests/integration/mcp-knowledge.test.ts` | shipped-and-matches | | none |
| Degrades to "no repo map available" when tree-sitter is absent | l.79-83 | `RepoMapUnavailable` (`src/knowledge/index.ts:100`); `schema.ts:533-535` | T: `repo-map.test.ts` | shipped-and-matches | | none |
| `golem bench map [--score]` over 22 hand-labelled cases | l.90-97 | `src/cli/commands/bench.ts:130-135`; `src/knowledge/repo-map-cases.ts:33` (22 entries); `repo-map-bench.ts` | T: `repo-map-bench.test.ts` | shipped-and-matches | | none |

### LSP Bridge page

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Four modes on `code`, added to the schema only when the bridge is injected | LSP l.12-36 | `src/mcp/code-tool.ts:38,146` | T: `tests/integration/lsp-bridge.test.ts` | shipped-and-matches | | none |
| 1-based line/character in and out | l.24-25 | `src/pkg/lsp/bridge.ts:350,362-364,401` | T: `lsp-bridge.test.ts` | shipped-and-matches | | none |
| `PATH`/`PATHEXT` resolution, argument arrays, never a shell; failure → `available:false` | l.40-44 | `src/pkg/lsp/client.ts:20,123`; `servers.ts:20-22`; `bridge.ts:14,133,330` | T: `lsp-bridge.test.ts` | shipped-and-matches | | none |
| Lazy spawn, pooled per server, idle eviction, bounded waits, synchronous kill on exit | l.46-51 | `bridge.ts:17,34-36,145-157,307-314`; `client.ts:219-245`; `mcp-serve.ts:252` | T: `lsp-bridge.test.ts` | shipped-and-matches | | none |
| `lsp_enabled` needs `repo_map_enabled`; `lsp_timeout_ms` 15,000; `lsp_servers` rows | l.61-68 | `mcp-serve.ts:233-250`; `schema.ts:556-583,1142-1143` | — | shipped-and-matches | | none |
| Only the TypeScript row is built in | l.70-72 | `src/pkg/lsp/servers.ts:38` | T: `lsp-bridge.test.ts` | shipped-and-matches | | none |
| Page sources `src/ext/lsp/`, `src/ext/manifest.ts` | LSP frontmatter l.5 | the code is at `src/pkg/lsp/` and `src/pkg/manifest.ts`; `src/ext/` does not exist | — | shipped-but-drifted | Path drift only | none |

### ADR-0001 and Decision 33 (KB half)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Backend: `fs.watch` recursive on Windows and macOS, a per-directory watch on Linux, chokidar as fallback | ADR-0001 l.65-79 (status **accepted**) | `src/knowledge/file-watcher.ts:4-26,139-167`: mtime/size **polling on every OS**, `fs.watch` deliberately unused | T: `file-watcher.test.ts` | shipped-but-drifted | The debounce, re-stat and `FileWatcher` seam match. The backend is a different decision (verification-notes §68) that no ADR records. ADR-0001's context ("`watch:true` throws NotImplementedYetError") is also stale. See Contradictions | none |
| Dec 33 KB half: extractive; `knowledge` scope only; prose-only (`isProseSource`: "wiki/spec/root docs, never code/tests/plan docs"); floor 0.6; label | Dec 33 (l.440-450) | `src/knowledge/local-answer.ts:18-21,52-57,77-93`; wired `src/cli/proxy-build/sidecars.ts:79-86` | T: `tests/unit/knowledge/local-answer.test.ts`, `tests/contract/local-answer.contract.test.ts` | shipped-but-drifted | `isProseSource` accepts **any** `.md/.markdown/.mdx/.txt/.rst` outside `docs/plan/`: `docs/decisions/*`, `vscode-extension/README.md`, debriefs, any nested README. That is broader than "wiki/spec/root docs". Web-cache pages (`web:<url>`) are always excluded, and graph-first is not used | none |

## Code defects noticed (Phase 3 input)

These go beyond doc drift: each is a way the code does the wrong thing. Most serious first.

- **D6 — cross-process lost update on the vector store.** Every process that opens
  `FileVectorDriver` (the `mcp serve` daemon, the WebFetch PreToolUse hook through
  `buildKnowledgeStack` at `src/cli/commands/prompt-guidance.ts:311-313`, `golem index`,
  and the proxy's local-answer KB) loads its own in-memory copy once
  (`file-driver.ts:152-153`). Each `upsert`/`delete` then rewrites the *whole*
  `chunks.jsonl` from that copy (`:215,218-232`), with no lock and no reload.
  - A page the hook ingests is erased by the daemon's next checkpoint or ingest.
  - A daemon checkpoint landing between the hook's load and its flush is erased by
    the hook.
  - The daemon's `search` never sees hook-ingested pages until it restarts.
  - Every Claude Code session runs this combination.
- **D3 — a file that stops yielding chunks keeps its old chunks.** `reindexFiles`
  deletes only the sourcePaths that appear in the *new* chunks
  (`knowledge-base.ts:263-264`), and `chunkFilesRelativeTo` skips unreadable files
  silently (`ingest.ts:221-227`). So a file truncated to empty, or a `.pdf` after
  `unpdf` is removed, keeps stale vectors. The manifest still records it as synced
  (`auto-index.ts:648-652`), so nothing retries.
- **D4 — `golem index <path>` and `golem index --watch` wipe the manifest's file map.**
  `writeManifest(…, [target], now)` is called without `files`
  (`local-ollama.ts:210-218`), and `files` defaults to `{}` (`auto-index.ts:439`). At
  the next session start every file counts as changed. Above 50 files the sync
  defers indefinitely; otherwise it re-embeds the whole tree.
- **D5 — ingesting a sub-path creates a second copy of those files.** sourcePaths are
  relative to the ingest root (`ingest.ts:144,156`). `ingest("src")` stores `foo.ts`
  while the root auto-index stores `src/foo.ts`. The incremental sync never cleans
  the sub-path copy, and the wiki boost and graph de-dupe cannot recognise it. The
  multi-root `watch_paths` case collides the same way, because each root is
  relative to itself.
- **D1 — graph-first lets the user wiki win title collisions** (`search.ts:172-173`,
  `federated-wiki-reader.ts:39`). This is the opposite of the documented rule, and a
  personal page silently shadows the project's canonical page in `search`.
- **D2 — `upsertPage` does not normalise `.md` but `readPage` does**
  (`file-wiki-store.ts:97` vs `:126,131`).
  - `wiki_upsert` with `rel_path: "concepts/Foo"` writes a file with no extension.
    `listPages` and `golem wiki check` ignore it (`:85`, `cli/wiki.ts:484`), so the
    page is invisible.
  - Meanwhile `wiki_upsert`'s `existedBefore` pre-check uses `readPage`, which
    resolves `Foo.md` or a title match (`wiki-tools.ts:135-144`). It reports
    "updated … appended:true" for what was actually a new sibling file.
- **D10 — full rebuilds are not checkpointed.** `rm(dir)` runs first, then one
  manifest write at the end (`auto-index.ts:572,621,522-543`). A session shorter
  than a full build never completes one and has already deleted the old index.
- **D7 — `getChunk` does not open the collection** (`knowledge-base.ts:176-180`,
  `file-driver.ts:279-283`). `fetch` on a chunk id before any search in this process
  fails.
- **D8 — web-cache freshness ignores `Cache-Control`/`Expires` unless revalidation is
  on, and ignores `no-store` on the first fetch** (`web-cache.ts:56-61`,
  `web-fetch.ts:267-268`).
- **D11 — distill drafts are keyed by the model's slug, not by source** (`distill-store.ts:61`).
- **D12 — frontmatter lists split on `,`** (`frontmatter.ts:25`). A source URL that
  contains a comma does not round-trip, so `findDraftByUrl` misses it.
- **D13 — watchers started by the MCP `ingest` tool are never closed.**
  `closeWatchers` has no caller, so the polling timers live for the whole server
  process.
- **D14 — graph-first silently turns off when the KB fails to build.** `wiki` is
  wired, but `wikiDir` is only set inside the `knowledge !== undefined` branch
  (`mcp-serve.ts:151-153,293-301`). A failed KB build therefore disables graph-first
  search too.
- **D9 (cosmetic) — `rerankHits` accepts invented ids** as long as every original id
  is also present (`rerank.ts:89-100`). Its header comment says the opposite.

## Undocumented

Behaviour in owned src that no owned doc mentions:

- **Embedder identity (R10.4/R10.6).**
  - `planQueryEmbedder`, `planBuildEmbedder`, `resolvePersistedEmbedder`, and the
    manifest's `embedder` record (`src/cli/auto-index.ts:136-420`).
  - The `EmbedderMismatchError` dimension guard (`src/knowledge/driver.ts:42-66`).
  - The collection reset in `FileVectorDriver.upsert` when the vector width changes
    (`file-driver.ts:196-209`).
  - Auto-Index Cost points at the KB page for this, and the KB page does not have it.
- **Lexical hashing embedder (`src/knowledge/hashing-embedder.ts`).** Its dimension
  and tokenisation are undocumented. The KB page only says "degrade".
- **`WebCache.list` and `contentHashIndex` (`web-cache.ts:149-185`).** These feed
  proxy context substitution (Dec 24 sub-mode 1).
- **WebFetch hook budget (R9.21).** `WEB_FETCH_PRE_TIMEOUT_SECONDS`, the serve
  reserve, and serve-before-ingest (`web-fetch.ts:62-94,236-299`). None of it is on
  the Web Cache page.
- **Loopback-stub pass-through and the no-cache guard** (`web-fetch.ts:325-326,442-445`).
- **`golem wiki check` lint rules** (`src/cli/wiki.ts:213-600`): retired-identifier
  scan with prose-unit exemptions, duplicate titles, broken wikilinks, and the check
  that every debrief is listed in WIKI.md's Index. WIKI.md itself describes none of
  them.
- **`golem index <path>` / `--watch` behaviour** (`local-ollama.ts:208-231`),
  including the manifest rewrite in D4.
- **Repo-map definer split and `MAX_DEFINERS` cut-off** (`repo-map-graph.ts:9,109`).
- **`src/cli/watch.ts` is the `golem watch` session TUI**
  (`note-dashboard-watch.ts:13`) and has nothing to do with KB file-watching. No
  owned doc covers it, and it is probably mis-partitioned into DUST1.4. DUST1.9
  (status/UI) should own it.

## Dead candidates

Each was checked with `grep -rn --include=*.ts <symbol> src`, excluding `*.test.ts`,
the definition itself and the barrel re-export:

- `GolemKnowledgeBase.closeWatchers` (`knowledge-base.ts:226`): 0 callers (see D13).
- `asFederatedSearch` (`knowledge-base.ts:337`): 0 callers outside `knowledge/index.ts:86`.
- `resolvePersistedEmbedMode` (`auto-index.ts:136`): 0 callers. Only a comment
  mentions it (`src/cli/proxy-runtime.ts:107`).
- `isPdfExtractionAvailable` (`extractors.ts:52`): 0 callers. Its comment says the
  `golem ext` registry uses it, but the registry uses its own module detect
  (`src/pkg/manifest.ts:253`).
- `knowledge.vector_db_url` (`schema.ts:476`) and the Qdrant branch in `selectDriver`
  (`knowledge/index.ts:177-182`): no reader passes the key, so the branch is
  unreachable in production.
- `InMemoryVectorDriver` (`driver.ts:139`): 0 production callers, test-only. The
  comment says so, but other comments still call it "the P0 default" (see Stale
  comments).
- `ZONE_FOR_TYPE.adr = "decisions"` (`promote.ts:42`): unreachable by design, and
  documented as such.

## Stale comments

Each of these contradicts the code beside it.

- `src/knowledge/driver.ts:4-13,134-138`: names LanceDB as the embedded engine and
  InMemory as "the P0 non-durable default until the embedded native driver lands".
  The FileVectorDriver is the default.
- `src/knowledge/index.ts:1-10,142,158-159`: "in-memory at C1 until the native
  engine", and "When set, uses the server driver" for `vectorDbUrl`. It throws
  instead.
- `src/hooks/web-fetch.ts`:
  - `:4-13` (module header): PreToolUse "Else allow the fetch" and PostToolUse
    "capture the fetched content". Both are pre-Decision-42.
  - `:133`: `buildKnowledge` is marked "Post hook only", but the pre hook ingests too
    (`:290`).
  - `:153-158`: says `fetchRaw` means "the PostToolUse hook caches/ingests the raw
    page". The pre hook does.
- `src/knowledge/raw-fetch.ts:11-15`: validators "only populate after a separate
  conditional GET", and the fetch is called "only from the store-only PostToolUse
  hook". Both are wrong: the pre hook calls it and seeds the validators (`web-fetch.ts:267`).
- `src/config/schema.ts`:
  - `:477`: `watch_paths` "auto-ingested and watched for changes". Never watched.
  - `:619-624`: `webcache_fetch_raw` says "fetch the RAW page ourselves in the
    PostToolUse hook". It is the PreToolUse hook.
- `src/cli/wiki.ts:463-464`: "the wiki is plan-gated; a human or an approved agent
  write fixes what's found". Dec 44 removed that gate.
- `src/cli/promote.ts:8-13`: "dated separator" and "The human approving IS the
  plan-gate (Decision 28)".
- `src/cli/notes.ts:12-13`: "plan-gated like every other wiki write".
- `src/wiki/federated-wiki-reader.ts:6-7,11,44-45`: points at `src/mcp/server.ts` for
  the graph-first machinery, which is now `search.ts`. `:48-49` "The project wins on
  a title collision" is true only for `readPage`.
- `src/knowledge/rerank.ts:9-12`: "invented … chunkIds falls back". Invented ids are
  dropped silently when every original id is present.
- `src/knowledge/extractors.ts:48-51`: "Used by the `golem ext` registry". It is not.
- `src/pkg/lsp/index.ts:2`, `bridge.ts:97`, `servers.ts:5`: `src/ext/…` paths. The
  directory is `src/pkg/`.
- `src/mcp/wiki-tools.ts:104-106` (tool description, which the model reads): "appended
  under a dated separator". It is undated.

Doc-side stale references, for Phase 2:

- Wiki-First `sources:` and l.27 cite `docs/plan/proposals/wiki-knowledge-pivot.md`,
  which no longer exists (Dec 28 says it was retired).
- Distillation `sources:` cites `docs/plan/next_batch.md` and `docs/plan/R3_BATCH.md`.
  Neither exists.
- ADR-0001 `sources:` cites `docs/plan/next_batch.md`, which does not exist.

## Contradictions for the human (not resolved here)

1. **ADR-0001 (accepted) vs `file-watcher.ts`.** The ADR decides on `fs.watch`; the code
   polls on every OS because of a libuv abort (verification-notes §68). ADRs are
   immutable except for their status, so this needs a superseding ADR. Rewording the
   old one is not an option. Which side is right: the code, on its own stated evidence.
2. **Federated title collision.** The Wiki-First page and the reader's comment say the
   project wins. Graph-first `search` lets the user page win. The doc looks right
   and the code wrong.
3. **Decision 29 "dated separator" vs the bare `---`.** The spec, the `wiki_upsert`
   description, promote's comment and the Distillation page all say "dated". Either
   the separator should carry a date, or four surfaces should stop claiming it.
4. **Decision 17 "Qdrant server fully supported via config URL" vs a config key with
   no reader.** Either implement it or retire the key and the claim.
5. **Web Cache page "green alternative declined" vs the shipped R9.12/R9.19 green
   path.** The page looks stale.
6. **Decision 33 "wiki/spec/root docs" vs `isProseSource` accepting any markdown
   outside `docs/plan/`.** The code is wider than the accepted safety posture.
7. **Wiki-First and Distillation pages teach the Dec 29 plan-gate that Dec 44 and
   Dec 54 removed.** The pages are stale. Promote's TTY consent prompt remains, and
   whether it should now be dropped is a separate question.
8. **Web Cache freshness.** The page says an explicit `max-age`/`Expires` makes an
   entry fresh. The code ignores it unless revalidation is on. Either side could be
   the intended one.
9. **Spec §3.1 still describes a Qdrant-based, chunks-primary design** with tools
   named `index_path`/`search_local`/`get_chunk`. Dec 28 says it "inverts §3.1", but
   §3.1 was never rebaselined.

## Unverifiable here

- §3.1 / KB page token effect ("~2–5K tokens instead of ~50–500K"). Needs live traffic.
- Auto-Index Cost timings (~5 s per file, 114 files in ~10 min). Hardware-specific;
  not re-measured.
- Repo Map "+21.4 accuracy points for +57 tokens" and "`code` ~262 forwarded tokens".
  Needs `golem bench map --score` with a local model.
- LSP "+333 full-definition tokens". Needs `golem bench tools --lsp`.
- The libuv `uv__relative_path` abort that justifies polling (`file-watcher.ts:8-18`),
  and ADR-0001's claim about Linux recursive-watch reliability.
- Dec 2's `--code-graph` evaluation: no record in code either way.
- The repo-map and LSP displacement claims. Both pages already mark these open.
- The green-path TLS and reach behaviour in real Claude Code sessions (§121/§125):
  environment-dependent.
