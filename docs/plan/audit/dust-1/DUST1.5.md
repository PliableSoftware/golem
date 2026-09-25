# DUST1.5 — MCP server, local tools, bench: audit findings

Read-only audit, 2026-09-25, against `development` at `fd3aedc` (the worktree adds only
this file). Nothing outside this file changed. Owned scope: `src/mcp/`, `src/tools/`,
`src/bench/`; wiki `concepts/Tool Search.md`, `concepts/Managed Tools.md`; spec §2.1 (MCP
half), §3.5; Decisions 27, 34, 35, 53; the registered MCP tool set against CLAUDE.md.

Two claims were checked by running code, not just reading it (scratch scripts outside the
repo, against the main checkout's `node_modules`, since the worktree has none):

- **`outputSchema` repro** — `McpServer` + SDK `Client` over `InMemoryTransport`, one tool
  whose `structuredContent` carries a key not in its Zod `outputSchema`. `callTool` before
  `listTools()`: OK. After `listTools()`: `MCP error -32602: Structured content does not
  match the tool's output schema: data must NOT have additional properties, data/refinement
  must NOT have additional properties`. The advertised schema carries
  `"additionalProperties":false` at every object level.
- **Live tool census** — `golemToolCensus()` + `SELECTION_CASES` via `npx tsx`:
  `tools 11 descTokens 1116 defTokens 4579`, `cases 27 unreachable [ 'level-1', 'level-2' ]`,
  `tools without a case [ 'code' ]`.

## Bucket counts

| class | count |
|---|--:|
| shipped-and-matches | 26 |
| shipped-but-drifted | 14 |
| partial | 3 |
| not-started | 4 |
| dead-or-superseded | 6 |
| **total classified** (table rows) | **53** |

The CLAUDE.md tool-list mismatch appears under the surface section and in Contradictions
(item 6), not as a table row.

No existing `docs/plan/tasks/` doc covers any partial / not-started / drifted item below.
The search covered `touches:` and body text for every finding's keywords and found only
unrelated hits (`R8.28.md:33` names `prompts.ts` as an extraction target, nothing more).

## Headline findings

1. **`coder` breaks its own `outputSchema` on the dispatched path, and on every
   `refine: true` call.** `structuredContent` adds `target`, `trust`, `route` and
   `redacted_count` whenever the dispatcher handled the call (`src/mcp/coder-tools.ts:509-518`).
   The dispatcher is wired whenever inference is available
   (`src/cli/commands/mcp-serve.ts:318-320`). The refine block adds `refinement.status`
   and `refinement.critiqued_by` (`:524-529`). None of those keys is declared in
   `outputSchema` (`:237-274`). The SDK advertises Zod objects with
   `additionalProperties: false`, so a client that has called `listTools()` rejects the
   result (reproduced above). Tests miss it because `connectInMemory`
   (`tests/integration/mcp-server.test.ts:58-63`) never calls `listTools()` before
   `callTool("coder")`, so the SDK has no cached validator. Whether Claude Code's client
   enforces this is listed under Unverifiable.
2. **Two of the 8 "frozen" prompts drive retired surfaces.** `slider` tells the model to
   call a `level` tool and the user to run `golem slider 0` (`src/mcp/prompts.ts:13-39`).
   `bypass` says the same (`:85-105`), and `stats` asks for the "current slider level"
   (`:57`). ADR-0004 / R11.1 removed the `level` tool. No `level` is registered anywhere
   (`src/plugins/loader.ts:43-55`, and the census above). The same test file asserts both
   facts: `level` is gone (`mcp-server.test.ts:196-197`) and the prompt points at it
   (`:366-373`).
3. **`golem bench tools` scores two cases that can no longer pass.** `level-1` and `level-2`
   expect `level` (`src/tools/cases.ts:84-85`), but the catalog is read from the live server
   (`src/tools/catalog.ts:1-13`) and has no `level`. So 2 of the 27 cases are guaranteed
   wrong in both arms, and every accuracy figure from this harness now has a ceiling of
   25/27 = 92.6%. `arg-level-1` (`cases.ts:192-195`) is silently skipped
   (`argument-harness.ts:87,103`). The `code` tool has no selection case at all. No test
   checks the case set against the catalog.
4. **The tool-name record in the spec is wrong both ways.** Spec line 331 lists the frozen
   names as `search, fetch, ingest, expand, stats, level, coder, golem_devices`. `level` is
   retired. `golem_devices` never existed as a registered name: B3 shipped `devices`
   directly (`git log -S'golem_devices'` shows only comments). Decision 27's line "golem_devices
   … keeps its current name" is dead for the same reason. And five registered tools
   (`code`, `snooze`, `devices`, `wiki_read`, `wiki_upsert`) are missing from spec line 331
   and from CLAUDE.md's list.
5. **R9.11's instrument fix is incomplete.** Spec §2.1 (line 144) says the
   uninstrumented-tool gap was fixed. `expand`, `stats` and `devices` now call
   `instrumented()` (`server.ts:122-142`, `:222`; `devices-snooze.ts:102`). `snooze` and
   `wiki_upsert` still record nothing: `registerSnoozeTool(server, deps)` receives no
   telemetry (`server.ts:240`, handler `devices-snooze.ts:185-252`), and `wiki_upsert`
   returns plain results (`wiki-tools.ts:151-161`). So the "never used" misreading that
   R9.11 was about can still happen for these two. `coder`'s `backendUnavailableMessage`
   path (`coder-tools.ts:560-561`) is also unrecorded.

## Registered MCP surface vs CLAUDE.md

Registered (11 tools, `src/plugins/loader.ts:43-55` = live census):
`code`, `coder`, `devices`, `expand`, `fetch`, `ingest`, `search`, `snooze`, `stats`,
`wiki_read`, `wiki_upsert`.

- **CLAUDE.md → code:** all six listed names (`search`, `fetch`, `expand`, `stats`,
  `ingest`, `coder`) are registered. No mismatch in this direction.
- **Code → CLAUDE.md:** `code`, `devices`, `snooze`, `wiki_read`, `wiki_upsert` are
  registered but not listed. `snooze` and `expand` are the park-exempt pair
  (`src/hooks/pre-tool-use.ts:127-131`), so leaving `snooze` out is the most consequential
  gap.
- **Conditional registration** (`server.ts:239-285`): only `expand`, `stats`, `devices` and
  `snooze` are unconditional. `search`/`fetch`/`ingest` need `deps.knowledge`, `coder` needs
  `deps.coder`, `code` needs `deps.codeRoot`, and `wiki_*` need `deps.wiki`. None of the
  docs say this, and it is why `mcp-server.test.ts:44,110-113` pins only 4 tools.
- **Prompts** (8, `prompts.ts`): `slider`, `stats`, `expand`, `bypass`, `index`, `search`,
  `devices`, `coder`. The `index` prompt drives the `ingest` tool (name mismatch,
  pre-Decision-27). No prompt exists for `code`, `snooze` or the wiki tools. `slider` is
  dead (headline 2).
- **Plugin tools** go last and cannot shadow a built-in (`server.ts:287-291`,
  `loader.ts:158`). The two-way drift test is `tests/unit/plugins/mcp-plugin-tools.test.ts`.

## Classification table

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Two doors: proxy + MCP in one service; MCP over stdio + streamable HTTP | spec §2.1 l.114, table l.125 | `src/mcp/serve.ts:2-26` (`StdioServerTransport`, `StreamableHTTPServerTransport`) | `mcp-server.test.ts` imports `serveHttp` (:38) | shipped-and-matches | | — |
| MCP tool names in §2.1 table: `search_local`, `summarize_local`, `cache_lookup`, `delegate_task`, `index_path` | spec §2.1 l.125 | none registered, see surface list | `catalog.test.ts:13-25` | dead-or-superseded | pre-Decision-27 names. `summarize_local` / `cache_lookup` never shipped under any name | none |
| "Claude can call `get_original(ref)` via MCP" | spec §2.1 l.119 | the tool is `expand` (`server.ts:91-144`) | `mcp-server.test.ts` expand cases | dead-or-superseded | name is v0.2-era | none |
| Layering rule: skills orchestrate, tools execute; contract test with a `layering-exception` marker | spec §2.1 l.131, l.142 | marker used in `.claude/skills/golem-bypass/SKILL.md` | `tests/contract/skills-tools-layering.contract.test.ts` exists | shipped-and-matches | | — |
| Hook enforcement keys on tool names (`PARK_EXEMPT_TOOLS`) | spec §2.1 l.136 | `src/hooks/pre-tool-use.ts:127-131` (`mcp__golem__snooze`, `ToolSearch`, `mcp__golem__expand`) | — | shipped-and-matches | | — |
| `wiki_upsert` as a tool carries its own allow/deny | spec §2.1 l.137 | registered `wiki-tools.ts:95` | `mcp-wiki.test.ts` | shipped-and-matches | | — |
| R9.11 fixed the uninstrumented tools, so demotion is answerable "next time, on numbers" | spec §2.1 l.144 | fixed: `expand`/`stats`/`devices`. Unfixed: `snooze` (`server.ts:240`), `wiki_upsert` (`wiki-tools.ts:151`) | none pins instrumentation per tool | partial | headline 5. `server.ts:79-80` comment implies `snooze` is covered | none |
| `/golem-research` climbs `wiki_read` → `search` → `fetch` | spec §2.1 l.140 | all three registered | — | shipped-and-matches | skill body not audited (not owned) | — |
| §3.5 media pre-processing (Whisper, OCR/vision captioning) | spec §3.5 l.192 | no `whisper` / `ocr` anywhere in `src/` | — | not-started | | none |
| §3.5 local code execution & test running → condensed failure digest | spec §3.5 l.193 | no test-running tool. The closest is the PostToolUse head/tail CCR swap, a generic excerpt rather than a failure digest | — | partial | missing: running tests and digesting failures | none |
| §3.5 git-aware context (diff summaries, commit-history summarisation) | spec §3.5 l.194 | git use only in checkpoint/skills (`src/checkpoint/ledger.ts`, `src/cli/skills/*`), no offload | — | not-started | | none |
| §3.5 speculative prefetch | spec §3.5 l.195 | no `prefetch` in `src/` | — | not-started | | none |
| §3.5 artifact/output storage by reference | spec §3.5 l.196 | CCR store + `expand` (`server.ts:91-144`) | `mcp-server.test.ts` `seedCcrRef` (:91) | shipped-and-matches | | — |
| §3.5 session memory via local vector DB | spec §3.5 l.197 | KB `search`/`ingest` + wiki exist (`search.ts:298,458`). There is no conversation-history recall: `src/interfaces/conversation-store.ts:4` stores hashes, not prompt text | `mcp-knowledge.test.ts` | partial | missing: history recall in place of resending | none |
| §3.5 Batch-API off-peak queueing | spec §3.5 l.198 | only an exclusion comment, `src/pipeline/pipeline.ts:311` | — | not-started | | none |
| D27: `golem_` prefix dropped, names shortened to bare verbs | D27 (l.400) | `search.ts:299,375,459`, `server.ts:92,147`, `coder-tools.ts:166` | `catalog.test.ts:13-25` | shipped-and-matches | | — |
| D27: "the 7 MCP tool registration names in `src/mcp/server.ts`" | D27 | registrations now split across 6 modules (R8.28). `server.ts` holds only `expand`/`stats` | — | shipped-but-drifted | location pointer is stale | none |
| D27: `golem_set_slider` → `level` | D27 | no `level` (ADR-0004 / R11.1, commit `76650b6`) | `mcp-server.test.ts:196` asserts absence | dead-or-superseded | D27 text carries no forward pointer to ADR-0004 | none |
| D27: `golem_devices` "keeps its current name" | D27 | the tool is `devices` (`devices-snooze.ts:49`). `golem_devices` was never registered (`git log -S'golem_devices' -- src/mcp` shows it in comments only: `8d1faeb`, `ea9b25a`) | — | dead-or-superseded | also wrong on spec l.331 | none |
| Spec l.331 frozen-names list | spec §9 l.331 | see surface list | `catalog.test.ts:13-25` | shipped-but-drifted | lists `level` and `golem_devices`. Omits `code`, `devices`, `snooze`, `wiki_read`, `wiki_upsert` | none |
| D34: chat-judge rerank over frozen `InferenceService.chat`, `rerankHits(inference, query, hits)` | D34 (l.452-456) | `src/mcp/search.ts:17,222` → `src/knowledge/rerank.ts` | `tests/unit/knowledge/rerank.test.ts`, `mcp-knowledge.test.ts` | shipped-and-matches | | — |
| D34: `knowledge.rerank_enabled`, default `false` | D34 | `src/config/schema.ts:599,1145`, wired `mcp-serve.ts:333-334`, `cli/task-grounding.ts:56` | `control-surface.test.ts` | shipped-and-matches | | — |
| D34: additive `GolemMcpServerDeps.rerank?` | D34 | `src/mcp/deps.ts:155-161` | — | shipped-and-matches | also reused by `coder` grounding (`coder-tools.ts:26,399`), which D34 does not mention | — |
| D34: rerank failure falls back to pre-rerank order | D34 | `deps.ts:158` doc. Behaviour lives in `knowledge/rerank.ts` (not owned) | `rerank.test.ts` | shipped-and-matches | | — |
| D34: "`boostWikiHits` (`src/mcp/server.ts`)" | D34 | defined in `src/mcp/search.ts`, re-exported `server.ts:33` | — | shipped-but-drifted | pointer only | none |
| D34 status "PROPOSED, implementing now behind the opt-in flag" | D34 l.457 | fully shipped (rows above) | — | shipped-but-drifted | status never moved to ACCEPTED | none |
| D35: `delegate` → `coder` rename | D35 (l.458) | `coder-tools.ts:166` | `catalog.test.ts` | shipped-and-matches | | — |
| D35: "No behavior change: same `inference.chat("drafter", …)` call" (local model) | D35 | R10.8 routes through `worker_targets.coder` → `inference.model` → harness upstream, with redaction (`coder-tools.ts:170-178,483-497`) | `mcp-server.test.ts` coder cases | dead-or-superseded | superseded by R10.8 / R13.11. The decision text is historical but has no forward pointer | none |
| `coder` structured result matches its `outputSchema` | implicit (MCP spec / registered schema) | `coder-tools.ts:237-274` vs `:505-537` | none (no `listTools` before `callTool`) | shipped-but-drifted | headline 1 | none |
| D53(a/b): tier-1 runtime deps "deliberately tiny — 5" | D53, Managed Tools l.38 | `package.json` `dependencies` has **6**: `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk`, `commander`, `env-paths`, `undici`, `zod` | — | shipped-but-drifted | `@agentclientprotocol/sdk` added later | none |
| D53 / Managed Tools invariant 3: "Exact pins" | D53(a), Managed Tools l.26 | `unpdf` `1.6.2` exact (optionalDependencies). `web-tree-sitter` `^0.26.10`, a caret range in **devDependencies** | — | shipped-but-drifted | the manifest row (`src/pkg/manifest.ts:261`) calls it tier-2. Out of owned `src/`, flagged for the `src/pkg` owner | none |
| D53(d): `caveman-shrink` follow-up = point `golem bench tools` at their implementation | D53(d) | `src/tools/ext-shrink.ts`, mode `ext-caveman-shrink` (`shrink.ts:55,72`), CLI `bench.ts:276-278,335` | `tests/unit/tools/ext-shrink.test.ts` | shipped-and-matches | P3b done | — |
| Managed Tools: `/caveman-compress` and `caveman-shrink` "are tracked as follow-ups" | Managed Tools l.70-71 | both shipped: P3a (`src/prompt/compact.ts`, tier-3b), P3b (above) | — | shipped-but-drifted | wiki still says follow-ups | none |
| D53(g): the surface is `golem ext`, not `golem tools`; `src/tools/` is the bench harness | D53(g) | `src/tools/` is the bench harness (`tools/index.ts`); command is now `golem pkg` (`cli/commands/pkg-models.ts:31-35`) | — | shipped-but-drifted | naming rule holds, name changed (see next row) | none |
| Managed Tools: "R10.1 renamed … to `golem pkg`, keeping `ext` as an alias" | Managed Tools l.75-76 | no `ext` alias anywhere in `src/cli`. The rename was **R9.23**, commit `6865594`, which deleted `.command("ext")` with no alias | — | shipped-but-drifted | wrong task id, and the alias claim is false | none |
| D53(j): `BUILTIN_MCP_TOOL_NAMES` with two-way drift test | D53(j) | `src/plugins/loader.ts:43-55` = live census | `tests/unit/plugins/mcp-plugin-tools.test.ts`, `loader.test.ts` | shipped-and-matches | | — |
| Managed Tools: spawn-free, `PATHEXT`-aware detection | Managed Tools l.89-93 | `src/pkg/detect.ts:10,21-22` | — | shipped-and-matches | | — |
| Managed Tools: rows carry a `gate` note instead of "running" | Managed Tools l.94-96 | `src/pkg/manifest.ts:156-159,197,220` | — | shipped-and-matches | | — |
| Managed Tools: `planPkgAction` pure; recipes only for `caveman` and `typescript-language-server` | Managed Tools l.168-176 | `src/pkg/install.ts:70`; `installer:` only at `manifest.ts:306,372` | — | shipped-and-matches | | — |
| Managed Tools: `upgrade: "reinstall"` / `playbook` rows refuse upgrade | Managed Tools l.188-193 | `manifest.ts:329` / `:190,212` | — | shipped-and-matches | refusal branch not re-read line by line | — |
| Managed Tools: `installed_plugins.json` is the authority | Managed Tools l.203-205 | `src/pkg/detect.ts:144,163` | — | shipped-and-matches | | — |
| Managed Tools: non-TTY install without `--yes` exits 3 | Managed Tools l.185-186 | `src/cli/commands/pkg-models.ts:82` | — | shipped-and-matches | | — |
| Managed Tools: headroom `config_ignored` / `supported_config` passthrough | Managed Tools l.112-130 | `src/compression/headroom-adapter.ts:400,518,680-683` | not re-run | shipped-and-matches | evidence outside owned src, spot-check only | — |
| Tool Search: `golem init` writes `ENABLE_TOOL_SEARCH=true` | Tool Search l.129 | `src/cli/proxy-wiring.ts:47`, `init.ts:5` | `tests/integration/proxy-tool-search.test.ts` exists | shipped-and-matches | | — |
| Tool Search: `golem bench tools` A/Bs against 27 labelled selection cases | Tool Search l.93-95 | `cases.ts` has 27 ids (census) | `tests/unit/tools/selection.test.ts` | shipped-but-drifted | count right, but 2 cases target the retired `level` and `code` is uncovered (headline 3) | none |
| Tool Search: transforms `whitespace`, `first-sentence`, `schema-meta`/`-validation`/`-descriptions` (cumulative) | Tool Search l.97-113 | `shrink.ts:50-63,108-135` | `selection.test.ts` | shipped-and-matches | `ext-caveman-shrink` is a sixth mode the page does not mention | — |
| Tool Search: argument gate grades against the **original** schemas | Tool Search l.105-107 | `src/tools/argument-harness.ts`, `compare-catalogs.ts` (`applyArgumentVeto`) | `arguments.test.ts` | shipped-and-matches | | — |
| Tool Search: "Golem's own 11 tools are ~902 description tokens and ~1,128 of input schemas" | Tool Search l.54-56 | live census: 11 tools, **1116** description tokens | `catalog.test.ts:40-43` band 700–1200 | shipped-but-drifted | the count matches by coincidence (`level` out; `code`, `snooze` in). Tokens are +24%, near the test's upper bound | none |
| `code` tool (repo map + LSP modes, ~1.4k default budget) | tool description / R8.5–R8.6 | `code-tool.ts:67-110`, `repo-map.ts:73` = 1400 | `tests/integration/mcp-code-tool.test.ts` | shipped-and-matches | not described in any owned doc (see Undocumented) | — |
| `wiki_upsert` description: "every write is committed to git" | tool description `wiki-tools.ts:101-102` | `src/wiki/file-wiki-store.ts` has no git/commit call | `mcp-wiki.test.ts` | shipped-but-drifted | writes land in the tree, and the user commits | none |
| `slider` / `bypass` / `stats` prompts | prompts registered as "frozen" (`prompts.ts:2`, `mcp-server.test.ts:120`) | `prompts.ts:13-39,57,85-105` | `mcp-server.test.ts:366-383` pins the stale text | dead-or-superseded | headline 2 | none |
| `P1_TOOL_FALLBACK`: "capability has not shipped or is not enabled yet" | `prompts.ts:9-10` | every target tool ships. Only conditional registration applies | — | shipped-but-drifted | "not shipped" wording is from P0 | none |
| `stats` tool reports compression level, not slider | `server.ts:150-237` | `compression_level` + name (`:163-166,202-203`) | `mcp-server.test.ts` stats cases | shipped-and-matches | the `stats` *prompt* still says slider (headline 2) | — |

Partial (3): R9.11 instrument, §3.5 test digest, §3.5 session memory. Not-started (4):
§3.5 media, git-aware, prefetch, batch. Dead (6): §2.1 tool names, `get_original`, D27
`level`, D27 `golem_devices`, D35 local-only framing, `slider`/`bypass` prompts.

## Undocumented

Exported behaviour with no mention in the owned docs:

- **`code` tool** (`src/mcp/code-tool.ts`): repo map + LSP modes (`definition`,
  `references`, `hover`, `diagnostics`). Neither spec §2.1 nor CLAUDE.md names it.
- **`snooze` tool** (`src/mcp/snooze.ts`, `devices-snooze.ts:126-254`,
  `snooze-note.ts` — also imported by `src/buzz/acp-turn.ts:41`): progress-heartbeat
  hold-open, `note` persisted as a local task. Documented by the guidance rule, not by
  §2.1 or CLAUDE.md.
- **`coder` surface beyond D35**: `previous_attempts`, `ground`, `refine`
  (`coder-refine.ts`), edit mode (`coder-edit.ts`, gated by `inference.local_editor_enabled`),
  `target` selection, `declined` result (R13.11), `delegate_to`/`delegate_model` (R13.12).
- **Conditional tool registration** (`server.ts:239-285`): see the surface section.
- **`InMemoryCompressionService`** (`src/mcp/in-memory-compression.ts`, used by
  `deps.ts:21` for standalone deps, exported `index.ts:15-16`): a stub CCR/compression
  service for MCP-only runs.
- **`golem bench edits`** (`src/tools/edit-bench.ts`, `edit-apply.ts`, `edit-format.ts`,
  `edit-diff.ts`, `edit-cases.ts`; CLI `bench.ts:203-269`): the edit-format benchmark.
  Neither owned wiki page mentions it.
- **`src/bench/stats.ts`**: shared `pct`/`signedPct`/`caseResolution`/`worstCaseRate`,
  used by `tools/report.ts:10`, `edit-bench.ts:42`, `compare-catalogs.ts:24`,
  `knowledge/repo-map-bench.ts:34`, `telemetry/cache-report.ts:21`.
- **`ext-caveman-shrink` mode**: the Tool Search page does not list it.
- **`src/mcp/shared.ts`**: `instrumented`, `textResult`, `errorResult`, `promptMessages`,
  server name/version constants. Infrastructure, no doc needed.

## Dead candidates

Every owned module has a live importer (checked by import-path grep over `src/`). No dead
files. Dead *content*:

- `slider` prompt (`prompts.ts:13-39`): its only action targets a tool that does not exist.
- `bypass` prompt's persistent-change branch (`prompts.ts:96-101`): `level` tool,
  `golem slider 0`.
- Bench cases `level-1`, `level-2` (`cases.ts:83-85`), `arg-level-1` (`cases.ts:192-195`).
- `P1_TOOL_FALLBACK` "not shipped" branch (`prompts.ts:9-10`).

## Stale comments (Phase 3 input)

- `src/mcp/server.ts:79-80` — "`expand`/`stats`/`level` (and `devices`/`snooze`)" were
  uninstrumented. `level` no longer exists, and `snooze` is *still* uninstrumented. The
  comment reads as though both were fixed.
- `src/mcp/server.ts:65` and `prompts.ts:2` — "all 8 frozen prompts". The set includes a
  retired one.
- `src/tools/ext-shrink.ts:14` — "the same tier-2 shape as `golem ext`". The command is
  `golem pkg`.
- `src/tools/cases.ts:83` — "// level — set the slider".
- `src/tools/catalog.ts:6-7` — cites `level`'s description size. Historical, but reads as
  current.
- `tests/unit/tools/catalog.test.ts:10` — "The 7 Decision 27/35 tools plus devices +
  snooze …". The list holds 6 of those 7 (`level` gone).
- `tests/unit/tools/catalog.test.ts:40-41` — "§88 measured ~902 … and this reproduces it".
  It measures 1116 now.
- `tests/integration/mcp-server.test.ts:366` — test title "points at the level tool"
  asserts retired behaviour as correct.

## Contradictions for the human

Not auto-resolved. Both sides are stated.

1. **`coder` schema vs result.** Either the `outputSchema` gains `target`/`trust`/`route`/
   `redacted_count` and `refinement.status`/`critiqued_by` (the code comments at
   `coder-tools.ts:513-515` say callers are meant to read `route`), or the result drops
   them. The code's intent points to widening the schema.
2. **Prompt set "frozen" vs retired surface.** `mcp-server.test.ts:120` pins 8 prompt names
   including `slider`. ADR-0004 retired the slider. Is the prompt set a contract to keep
   (and rewrite `slider` to drive `compression`?), or should the prompt go?
3. **`wiki_upsert` "committed to git".** The description promises a commit, but the store
   only writes files. Decision 44's reasoning ("git makes every write reviewable") holds
   either way, but the tool text overstates.
4. **Decision 34 status.** PROPOSED in the log, fully shipped and default-off in code.
5. **Tool Search figures.** ~902 description tokens on the page, 1116 live. The page's
   §89/§100 A/B tables were measured on a tool set that included `level` and lacked
   `code`/`snooze`. Whether to re-measure or date-stamp them is a call for the owner.
6. **CLAUDE.md tool list.** It is framed as "the MCP tools use short verb names: …" and
   reads as exhaustive. It is 6 of 11. Either expand it or mark it as examples.
7. **Managed Tools "5 runtime deps" and "exact pins"** vs `package.json` (6 deps,
   `web-tree-sitter` a caret range in devDependencies). This one also belongs to whoever
   owns `src/pkg/`.

## Unverifiable here

- **Whether Claude Code's MCP client enforces `outputSchema`.** If it does, every dispatched
  or refined `coder` call fails for users in real sessions. This needs a live
  `mcp__golem__coder` call with a routed target and was not made (read-only audit; it would
  dispatch to a model).
- Tool Search API facts: GA status, the model support list, the 5-match cap, and
  `cache_control` 400 on deferred tools (external docs, verification-notes §89).
- Claude Code's own deferral wire shape (`DeferredToolPlaceholder`, §100). This is client
  behaviour.
- The §89/§100 selection/argument percentages, which need a local Ollama chooser.
- The §100 context-ledger split (93.9% built-ins), a captured request not in this tree.
- The Headroom worker's Python behaviour (`config_ignored`, introspection). Spot-checked by
  symbol only.
