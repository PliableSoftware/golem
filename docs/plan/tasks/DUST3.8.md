---
task: DUST3.8
title: "Wiki write path and KB lifecycle: redact and instrument wiki_upsert, normalise .md, key distill drafts by source, quote-aware frontmatter lists, close watchers, keep graph-first search when the KB build fails, reject invented rerank ids"
state: done
owner: agent
size: L
discipline: code
design: "SUMMARY.md S13; DUST1.4 D2, D9, D11, D12, D13, D14; DUST1.5 h5 (wiki_upsert uninstrumented); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/mcp/wiki-tools.ts, src/wiki/file-wiki-store.ts, src/wiki/frontmatter.ts, src/knowledge/distill-store.ts, src/knowledge/rerank.ts, src/cli/commands/mcp-serve.ts, tests]
created: 2026-10-08
updated: 2026-10-08T18:33:45.424Z
---

## What this is

`wiki_upsert` writes page bodies verbatim into a committed tree. The other items are
correctness gaps on the same write/read path. Work in your own worktree
(`git worktree add ../golem-dust3-8 -b dust3-8 development`), failing test first, commit as you go.

## The work

1. **S13 (HR): `wiki_upsert` writes unredacted** (`src/mcp/wiki-tools.ts:147`,
   `src/wiki/file-wiki-store.ts:125`). Run the standalone-text redactor, with plugin rules
   (`ensurePluginRedactionRules`), on body and frontmatter values before the write. Test: a
   secret-shaped body lands as a placeholder on disk.
2. **h5: `wiki_upsert` is uninstrumented** (`wiki-tools.ts:152`). Wrap it in `instrumented()` like
   the other tools.
3. **D2: `upsertPage` does not normalise `.md`** (`file-wiki-store.ts:125-131` vs `readPage` at
   `:97`). Writing `foo` and reading `foo` must hit the same file.
4. **D11: distill drafts are keyed by the model's slug** (`src/knowledge/distill-store.ts:~61`).
   Two sources whose slug collides overwrite each other. Key by a source hash.
5. **D12: frontmatter lists split on `,`** (`src/wiki/frontmatter.ts:25`). Make the parse
   quote-aware.
6. **D13: ingest watchers are never closed.** Call `GolemKnowledgeBase.closeWatchers`
   (`src/knowledge/knowledge-base.ts:226`; today test-only) on MCP server shutdown in
   `src/cli/commands/mcp-serve.ts`.
7. **D14: a failed KB build disables graph-first search** (`mcp-serve.ts:293-301`). `wikiDir` is
   set only inside the `knowledge !== undefined` spread. Set it independently.
8. **D9: rerank accepts invented ids** (`src/knowledge/rerank.ts:89-100`). Reject when
   `order.length !== hits.length` or an id is unknown, and make the comment at `:9-12` and
   `:96-97` match.

## Hard rules

- Redaction never weakened: the redactor runs before the write, never after.

## Out of scope

- Comment drift in `src/wiki/federated-wiki-reader.ts`, the tool-description "dated separator"
  (`wiki-tools.ts:106`), `cli/promote.ts`, `cli/notes.ts`: DUST3.18. DUST3.18 depends on this
  task for `wiki-tools.ts`.
- The store/indexing bugs (D3-D7): DUST3.7.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
