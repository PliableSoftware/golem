---
task: DUST2.15
title: KB lookup completeness: graph-first alias matching and full-text `fetch` for any hit
state: done
owner: agent
size: S
discipline: code
design: spec Decision 28; wiki Wiki-First Knowledge; SUMMARY.md Gaps 1.4/r018 (P), r039 (P)
gate: A query naming a page alias surfaces that page via graph-first lookup; `fetch` returns full text for every hit kind `search` can return (getChunk); tests for each. golem verify green by exit code.
depends_on: []
touches: [src/knowledge, src/mcp, tests]
created: 2026-10-08
updated: 2026-10-15T06:12:45.295Z
---

## What this is

Roadmap gap (DUST1.4 rows 18, 39): graph-first matches title and wikilink but not alias; `fetch`
cannot return full text for some hit kinds.

## The work

1. r018: extend the exact-match graph-first step to page aliases (frontmatter `aliases`).
2. r039: make `getChunk` (or its successor) resolve every hit kind `search` returns, including
   ingested trees and cached web pages.

## Out of scope

- K2 title-collision precedence (doc follows code, DUST2.5).

## Contract amendment

`src/interfaces/wiki.ts` gained optional `WikiFrontmatter.aliases?: readonly string[]`
(AMENDMENT 2026-10-14 in that file's header). Pinned by
`tests/contract/wiki-aliases.contract.test.ts`: optional readonly list, absent when a page
declares none, not part of `WikiUpsertInput`, never written by `upsertPage` (a hand-authored
line is kept verbatim on rewrite). `FileWikiStore.upsertPage` now builds its input
frontmatter from explicit fields instead of spreading, so a smuggled `aliases` is not echoed.

Consumers of `WikiFrontmatter` (grep of `src`, `vscode-extension`, `docs`, `scripts`, `tests`):

| Consumer | Use | Status |
|---|---|---|
| `src/interfaces/index.ts` | re-export | unaffected |
| `src/wiki/frontmatter.ts` | parses (now sets `aliases`), serializes, `lineHolds` | updated (parse); serialize keeps unknown `aliases` line verbatim |
| `src/wiki/file-wiki-store.ts` | builds literal on rewrite; spreads input on create | create path made explicit (no spread); rewrite literal unaffected (optional) |
| `src/wiki/federated-wiki-reader.ts` | spreads pages (`prefixPage`) | unaffected, carries `aliases` through |
| `src/knowledge/distill-store.ts` | three `WikiFrontmatter` literals, `owns` predicate | unaffected (optional field) |
| `src/mcp/wiki-tools.ts` | copies tags/sources into tool output | unaffected |
| `src/mcp/search.ts` | reads `aliases` for graph-first lookup | updated (new reader) |
| `vscode-extension`, `scripts` | no `WikiFrontmatter` use | unaffected |
| `docs/wiki/debriefs/2026-07-12-R3.5.md` | prose mention | unaffected |

## Outcome

shipped in #309
