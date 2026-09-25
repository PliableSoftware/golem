# DUST1.4 — knowledge base, wiki, web cache, repo map: docs vs code

Status: IN PROGRESS (early commit; sections below fill as the audit proceeds).

Audit of commit `fd3aedc` (development). Read-only; no code, wiki or spec edits.

## Findings so far (to be folded into the table)

- ADR-0001 says fs.watch (recursive on Win/mac, per-dir on Linux); code polls on every OS — `src/knowledge/file-watcher.ts:4-26`.
- `knowledge.vector_db_url` is never read by any caller — only `src/config/schema.ts:476`, `src/config/ui-model.ts:413`; `openKnowledgeBase` accepts `vectorDbUrl` (`src/knowledge/index.ts:177`) but `buildKnowledgeStack` never passes it (`src/cli/build-knowledge.ts:137-143`).
- Graph-first title collision: user-wiki page overwrites project page in `byTitle` (`src/mcp/search.ts:172-173` + `src/wiki/federated-wiki-reader.ts:39`), contradicting "project wins".
- `wiki_upsert` / `FileWikiStore.upsertPage` do no redaction (`src/mcp/wiki-tools.ts:134-150`, `src/wiki/file-wiki-store.ts:125-167`).
- `getChunk` never opens a collection (`src/knowledge/knowledge-base.ts:176-180`, `src/knowledge/file-driver.ts:279-283`).
