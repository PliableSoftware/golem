# DUST1.3 — Compression, CCR and brevity: documented claims vs code

Read-only audit, 2026-09-25, branch `dust/DUST1.3` (based on `development` @ `fd3aedc`).
Method and taxonomy: `docs/plan/tasks/DUST1.3.md`. Only a direct read of the code or a test counts as
evidence. Debriefs and task docs were not used as evidence. No tests were run. Every behaviour below
was checked by reading the code, and each test cited was found by grep and read in part.

Classes: **M** shipped-and-matches · **D** shipped-but-drifted · **P** partial · **N** not-started ·
**X** dead-or-superseded.

## Tally

| class | count |
| --- | --- |
| shipped-and-matches | 37 |
| shipped-but-drifted | 8 |
| partial | 4 |
| not-started | 4 |
| dead-or-superseded | 7 |
| **total** | **60** |

Rows 21 and 28 are recorded for completeness but not classified: one is outside owned src, the other is historical.

## Findings table

### Wiki — `concepts/Compression.md`

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 1 | Lossless stage runs from level 1 | Compression.md:16-18 | `src/interfaces/policy.ts:149-155` (`1` → `losslessCompression: true`); `src/pipeline/pipeline.ts:617` | `tests/contract/policy.contract.test.ts` | M | — | — |
| 2 | Lossless stage "is byte-faithful — the model sees the same content, just packed" | Compression.md:17-18 | `src/compression/native-lossless.ts:191-203`: at level 1, dedup REPLACES a repeated ≥256-char span with a `[Golem: duplicate content elided …]` marker. `compaction.ts:24-33` strips whitespace | `tests/unit/compression/native-lossless.test.ts` | D | Reversible (`expand`), but not byte-faithful: the model sees a marker in place of the content. The doc says "same content", and the code only guarantees *prefix-stable* bytes. See Contradictions §1 | none |
| 3 | "cache-alignment" as a lossless stage | Compression.md:16 | No stage by that name. `native-lossless.ts:13-34`: alignment is a *property* (every transform is a pure function of the prefix), not a transform | `native-lossless.test.ts` (determinism cases) | D | Doc names a stage, code has an invariant. The doc wording is what should change | none |
| 4 | Lossy semantic added at levels 2–3 | Compression.md:19-21 | `policy.ts:157-174`; `pipeline.ts:647-677` | `policy.contract.test.ts`; `tests/unit/compression/effective-level.test.ts` | M | — | — |
| 5 | Lossy stage net-negative on Anthropic, measured (§103 numbers) | Compression.md:23-39 | Enforced by the gate: `pipeline.ts:650`, `effective-level.ts:45-52,101-111` | `effective-level.test.ts` | M | The numbers themselves are a measurement record and can't be re-checked here. See Unverifiable | — |
| 6 | "The stages that pay are gated to engage only on non-caching upstreams" | Compression.md:43-44 | `pipeline.ts:650` (semantic), `:690` (context substitution) | `effective-level.test.ts` | M | — | — |
| 7 | Implementation files: `native-lossless.ts` always-on, `headroom-adapter.ts` semantic | Compression.md:50-52 | `src/compression/index.ts:26-34`; `headroom-adapter.ts:612` | `tests/integration/headroom-adapter.test.ts` | M | "always-on" is loose: the stage is off at `compression.level: off` (`policy.ts:143-147`) | — |
| 8 | CCR: oversized tool output stored under `.golem/ccr`, replaced by a digest with `hash=<id>`, expanded by the `expand` tool | Compression.md:54-79 | `src/hooks/post-tool-use.ts:264-325`; `post-tool-use/digest.ts:234-291`; `src/mcp/server.ts:91-144` | `tests/integration/hooks/post-tool-use.test.ts` | M | Note that the swap is **not gated by `compression.level`**. It fires at `off` too (the hook never reads the dial; `src/cli/fast-path.ts:331-346`). The page ties CCR to "from level 1" (line 16-18). See Contradictions §2 | none |
| 9 | `.golem/ccr` rooted per project, a worktree resolves to the main checkout | Compression.md:60-62 | `post-tool-use.ts:307-309`; `native-lossless.ts:358-368` | `tests/unit/shared/git-worktree.test.ts` | M | — | — |

### Wiki — `concepts/Compression Levels.md`

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 10 | Two dials only: `compression.level` off/1/2/3, `brevity.level` off/lite/full/ultra | Compression Levels.md:12-17 | `src/config/schema.ts:433,470`; `src/cli/dials.ts:42-45` | `policy.contract.test.ts` | M | — | — |
| 11 | CLI `golem compression 1` / `golem brevity full` | :19-22 | `src/cli/dials.ts:129-175` (`setDial`), registered from `src/cli/commands/dials-stats.ts` | **none found**: no test references `setDial` or `compressionEffectNote` | M | Code matches. Test gap only | none |
| 12 | Dials take effect live, no restart | :24-25 | `src/config/control-surface-runtime.ts:52` comment; the pipeline resolves policy per request (`resolvePolicy` in `src/cli/proxy-build/telemetry-hooks.ts:90`) | not located | M | The live-reload mechanism belongs to DUST1.1's pipeline/proxy scope. Only confirmed that policy is resolved per request | — |
| 13 | Level table (off = redaction only · 1 lossless · 2 stale-turn drop · 3 max) | :29-34 | `policy.ts:138-174`; worker presets `headroom-worker.py:242-252` | `policy.contract.test.ts` | M | — | — |
| 14 | Every level redacts; no row has `redaction: false` | :36-39 | `policy.ts:143,151,159,169` | `policy.contract.test.ts:10-33` | M | — | — |
| 15 | Brevity appends a marker-fenced directive to `system` | :43-47 | `src/pipeline/brevity.ts:99-107,165-231`; `pipeline.ts:722-729` | `tests/unit/pipeline/brevity.test.ts`, `brevity-stage.test.ts` | M | — | — |
| 16 | Brevity profile descriptions (lite/full/ultra) | :49-54 | `brevity.ts:79-96` | `brevity.test.ts` | M | — | — |
| 17 | One shared safety tail: verbatim payloads, prose-only, progress-line carve-out | :56-77 | `brevity.ts:62-76` | `brevity.test.ts` | M | — | — |
| 18 | Directive-text change needs a rebuild and invalidates the cached prefix once | :79-85 | `brevity.ts:16-27` (const per level, no interpolation) | `brevity.test.ts` | M | — | — |
| 19 | Set vs ran: a caching upstream degrades 2/3 to 1, and the surfaces say so | :102-113 | `effective-level.ts:88-127,151-163` | `effective-level.test.ts` | M | Rendered wording lives in status files (DUST1.1/other scope), not checked | — |
| 20 | Retired: `level` MCP tool, `golem slider`, `auto` state | :129-132 | MCP tool list = `code, coder, devices, expand, fetch, ingest, search, snooze, stats, wiki_read, wiki_upsert` (grep `registerTool(` across `src/`); `dials.ts:42-45,147-149` rejects `auto` | — | M | Leftovers: see Stale comments and Dead candidates | — |
| 21 | Slider-drift remainder: `src/dashboard/server.ts` still has `slider-level`/`slider-name` DOM ids | :142-145 | outside owned src (not checked) | — | — | Listed only because the page states it; not classified here | R12.6 per page |

### Wiki — `concepts/CCR Ref Scope.md`

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 22 | Hook write and `expand` read share one root via `resolveWorktreeRoot` | CCR Ref Scope.md:22-46 | `post-tool-use.ts:59,307`; `native-lossless.ts:57,362` | `tests/unit/shared/git-worktree.test.ts`; `tests/unit/knowledge/file-driver.test.ts` | M | — | — |
| 23 | `UnknownRefError` carries `location` + `reason: not-found \| corrupt` | :61-81 | `ccr-store.ts:78-112` | `tests/unit/compression/ccr-store.test.ts` | M | — | — |
| 24 | No eviction/TTL anywhere in `CcrStore`/`LocalDirBlobStore` | :63-67, :83-88 | `ccr-store.ts` and `local-blob-store.ts` read in full: no prune/evict/ttl. `LocalDirBlobStore.delete` exists (`local-blob-store.ts:115-117`) but `CcrStore` never calls it | — | M | Unbounded disk growth is the accepted consequence | none (page calls it "unopened") |
| 25 | Marker format `hash=<64-hex>` unchanged | :87 | `native-lossless.ts:80,119-125`; `digest.ts:291` | `native-lossless.test.ts` | M | Headroom-backfilled refs are 8–64 hex (`headroom-ccr-bridge.ts:40`), so "64-hex" holds for Golem's own markers only | — |

### Wiki — `concepts/Cache Observability.md`

The cache-prefix observer (`src/proxy/cache-prefix.ts`) and `src/telemetry/cache-report.ts` are outside owned src, so only the claims that touch compression are classified here.

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 26 | Observation happens after every compression stage, on the bytes forwarded | Cache Observability.md:18-19 | `pipeline.ts:731-741` (`cacheObserver.observe(body)` after stages 2–5) | not located (DUST1.1 scope) | M | — | — |
| 27 | "level 0 is a full bypass" and so never observed | :101-104, :126 | Level 0 no longer exists (`policy.ts:37`, `CompressionLevel = "off" \| 1 \| 2 \| 3`). The full bypass is `proxy.bypass_all` | — | D | Slider-era wording on a live page. The code side is right | none |
| 28 | "compression 3" as this repo's setup for the 98.4% figure | :118-119 | historical measurement | — | — | Historical, not classified | — |
| 29 | Related-link blurb: "Compression — why input-side compression pays ~0% on cached traffic" | :125 | consistent with gate `pipeline.ts:650` | — | M | — | — |

### Spec §1.1 / §1.2

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 30 | Golem depends on `headroom-ai` as its compression stage | spec:25 | `package.json` has **no** `headroom` entry at all. Headroom is reached only by spawning `uv run --with headroom-ai==0.30.0` (`headroom-adapter.ts:601-610`), opt-in (`schema.ts:1118` `headroom_sidecar: false`) | `tests/contract/headroom-isolation.contract.test.ts` | X | Superseded by Decision 18. §1.1's framing no longer describes the code: the default compression stage is Golem-native TS | none |
| 31 | Library mode: `redaction → headroom.compress() → forward` inside Golem's pipeline | spec:42 | Semantic call is HTTP to a Python worker (`headroom-adapter.ts:666-692`, `headroom-worker.py`), after the native lossless stage (`pipeline.ts:617-677`) | `headroom-adapter.test.ts` | D | Library mode as specced is impossible (Decision 18). A sidecar worker is what shipped | none |
| 32 | `CompressionService` interface isolates Headroom: `compress / retrieve / stats` | spec:44 | `src/interfaces/compression.ts`; `NativeLosslessCompression implements CompressionService` (`native-lossless.ts:334`). Headroom sits behind a *different* seam, `SemanticCompressor` (`semantic.ts:31-41`) | `compression.native.contract.test.ts`; `headroom-isolation.contract.test.ts` | D | The isolation is real, but through `SemanticCompressor`, not `CompressionService`. Decision 23 says "the sidecar already lives behind [CompressionService]", and it doesn't | none |
| 33 | Level 3 may route text compression to Golem's local LLM | spec:50 | Only `HeadroomSidecar implements SemanticCompressor` (grep). No Ollama semantic path | — | X | Superseded by Decision 31 (local model only via explicit `coder`) | — |
| 34 | Unified MCP surface re-exports Headroom retrieve/stats/memory | spec:51 | MCP tools are all Golem's own (row 20). Headroom-emitted markers resolve through Golem's `expand` via the backfill bridge (`headroom-ccr-bridge.ts:120-134`, `pipeline.ts:663-668`) | `tests/unit/compression/headroom-ccr-bridge.test.ts` | P | retrieve: done by backfill. stats/memory: no Headroom-backed MCP tool (memory reaches `search` via `MemorySearchProvider`, DUST scope of KB) | none |
| 35 | Headroom pin (v0.28.0 codebase evidence) | spec:40 | `src/compression/pins.ts:24` = `0.30.0` | `tests/contract/pins.contract.test.ts` | D | §1.2 still cites 0.28.0. Code is authoritative, spec text is stale | none |

### Spec §3.2 / §3.4

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 36 | Redaction pre-stage before compression | §3.2.1 (spec:171) | `pipeline.ts:478` (stage 1) before `:617` | DUST1.1 owns redaction tests | M | — | — |
| 37 | `compression.level` gating maps to Headroom config per content type | §3.2.2 (spec:172) | Mode string only: `pipeline.ts:657-660` → `headroom-worker.py:242-252` (`protect_recent`, `compress_user_messages`). No per-content-type mapping | `headroom-config-reach.test.ts` | P | Per-level presets exist, per-content-type does not | none |
| 38 | Semantic compression at `compression.level: 3` via Golem's tiered local LLM | §3.2.3 (spec:173) | Runs at level **≥2** (`pipeline.ts:648`), via **Headroom**, never Ollama | `effective-level.test.ts` | X | Superseded by Decisions 18/31. Also says "level 3" where code says ≥2 | — |
| 39 | Originals reversible via `headroom_retrieve` / `get_original(ref)` | §3.2.3 | The tool is `expand` (`mcp/server.ts:92`). Neither `headroom_retrieve` nor `get_original` exists (grep) | `headroom-ccr-bridge.test.ts` | D | Behaviour ships, names are stale | none |
| 40 | Savings telemetry per stage | §3.2.4 | `pipeline.ts:622-624,671-674,705-708` `stageSavings`; `native-lossless.ts:415-418` | `native-lossless.test.ts` | M | Minor: `pipeline.ts:710` adds `substitutions` to `ccrRefsStored` whether or not `putIfAbsent` stored anything new (`context-substitution.ts:183-194` discards the boolean) | none |
| 41 | Exact response cache (hash(request) → response, TTL) | §3.4 (spec:187) | No implementation. grep `responseCache\|response_cache` finds nothing in `src/` | — | N | — | none |
| 42 | Semantic cache (`strict`/`loose` by level) | §3.4 (spec:188); §4 table rows 2–3; `dials.ts:213` | `StageConfig.semanticCache` is set (`policy.ts:147-173`) and **read by nothing** (grep `semanticCache` hits only `policy.ts`) | — | N | A config field with no consumer. `compressionEffectNote("2")` tells users a semantic cache is added (`dials.ts:213`), and it isn't | none |
| 43 | Tool-result cache with mtime invalidation | §3.4 (spec:189) | `stages.toolResultCache` is read only by `src/mcp/in-memory-compression.ts:80,90` (the standalone/stub service), never by the proxy's `NativeLosslessCompression` | `tests/contract/mcp-in-memory-compression.contract.test.ts` | P | Decision 30 recorded that it was "specced but never wired into NativeLosslessCompression". Still true. No mtime invalidation anywhere | none |

### Spec §4 (incl. Quality guardrails)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 44 | Level table + "no level disables redaction" + bypass is `proxy.bypass_all` | §4 spec:211-223 | rows 13-14. `bypass_all` itself is DUST1.1's | `policy.contract.test.ts` | M | Level-1 row repeats "byte-faithful" (see row 2). Level-2 row claims tool-result caching and a semantic cache (rows 42-43) | — |
| 45 | "Every lossy operation declares its gate", everything lossy is reversible | §4 spec:211,233 | Semantic gate `pipeline.ts:647-651` + backfill `:663-668`. Context substitution gate `:687-692` + CCR store `context-substitution.ts:183-194` | `context-substitution.test.ts`, `headroom-ccr-bridge.test.ts` | P | Reversibility of the semantic stage covers only markers Headroom emits in `tool_result`/`role:"tool"` shapes (`headroom-ccr-bridge.ts:24-28`). Content Headroom *drops* (stale-turn drop) leaves no marker and is not recoverable. Bridge also pairs messages by index (`:126-131`), so a dropped message misaligns every later pair (fails open, backfills nothing) | none |
| 46 | Eval harness (replay per level, LLM judge, quality curves) | §4 Quality guardrails spec:236 | No harness. `src/bench/` holds only `stats.ts` | — | N | — | none (R2.6 is a live A/B on cost, not quality) |
| 47 | Canary mode | spec:237 | grep `canary` in `src/`: nothing | — | N | — | none |
| 48 | Per-request escape hatch `x-golem-bypass: true` | spec:238 | `src/proxy/headers.ts:46,83` | DUST1.1 scope | M | Implementation is DUST1.1's proxy scope. Only its presence was confirmed | — |

### Decisions

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| D1 | Build on headroom-ai, library mode behind `CompressionService` | Decision 1 (spec:307) | see rows 30-32 | — | X | Narrowed by Decision 18. The Decision 1 text itself is historical | — |
| D8 | MCP exposes the slider (`eol_set_slider`) | Decision 8 (spec:314) | No such tool (row 20) | — | X | Superseded by ADR-0004. Also carries pre-rename `eol_` names | — |
| D15 | Headroom pin `headroom-ai[code]==0.28.0` | Decision 15 (spec:321) | `pins.ts:24` `0.30.0`, bare `headroom-ai` (no `[code]`), `headroom-adapter.ts:607` | `pins.contract.test.ts` | X | The entry says it documents the pre-pivot state, and it does. Current pin is 0.30.0 | — |
| D18 | TS-native lossless P0 + optional Python sidecar; npm client becomes typed transport; fallback to Ollama with no Python | Decision 18 (spec:324-328) | TS lossless ✅ `native-lossless.ts`. Sidecar ✅ `headroom-adapter.ts:612`. npm client **unused** (`pins.ts:26-31`: "Golem does NOT use it"). Ollama fallback **absent** (only one `SemanticCompressor`). CCR store is content-addressed blobs, **not SQLite** (`local-blob-store.ts`) | `headroom-adapter.test.ts`, `pins.contract.test.ts` | D | Three sub-claims drifted: npm transport, Ollama fallback, SQLite CCR. Also still says "slider levels 0–2" / "slider ≥3" | none |
| D23 | Compression is situational. Lossless stays, CCR stays, lossy gated | Decision 23 (spec:366-371) | `pipeline.ts:617-677`; `effective-level.ts` | `effective-level.test.ts` | M | Wording says "lossless stage stays (level ≤2)" and "lossy at slider ≥3". Code: lossless at ≥1, lossy at ≥2. Historical entry, so no reclassification | — |
| D30 | Four-level slider + level-0 full bypass | Decision 30 (spec:419-424) | Scale is now `off/1/2/3` (`policy.ts:37`). Level 0 is gone, and `migrateSliderLevel` survives only as migration (DUST1.1/config) | `policy.contract.test.ts` | X | Superseded by ADR-0004 (the spec banner at §4 says so) | — |
| D31 | Pure compression dial; semantic gated off caching upstreams; `isCachingUpstream` | Decision 31 (spec:425-430) | `effective-level.ts:45-52` (moved from `pipeline.ts`, which Decision 31 names as its home); gate `pipeline.ts:650,690` | `effective-level.test.ts` | M | Location drift only: Decision 31 says `isCachingUpstream` is "in `pipeline.ts`". Deferred cache-safe structural tier: still not started | R2.6 (adjacent) |
| D52 | Brevity dial: system-only, marker-fenced, appended into last text block, stands down on Caveman, defaults `off`, `UsageByBrevity` rollup | Decision 52 (spec:500) | `brevity.ts:123-125,165-231`; `schema.ts:1130` `brevity.level: "off"`; `golem stats --brevity` → `aggregateUsageByBrevity` (`src/cli/commands/dials-stats.ts:114-132`) | `brevity.test.ts`, `brevity-stage.test.ts`, `tests/unit/telemetry/brevity-rollup.test.ts` | M | The slider-preset half is superseded by ADR-0004. The brevity half matches | — |
| D57 | Marker-free router default wherever semantic runs; router namespace; `lossless_only` alias → `lossless`; router restored each request; `/health.supported_router_config` | Decision 57 (spec:512) | `headroom-worker.py:99-106,174-231,255-305,382` | `tests/unit/compression/headroom-config-reach.test.ts` | M | Static fallback `KNOWN_HEADROOM_CONFIG_FIELDS` (`headroom-adapter.ts:529-539`) lacks `router`, so `unreachableHeadroomConfigKeys` flags a documented `router: {...}` key as unreachable when no worker is up. See Contradictions §4 | none |

### ADR-0004 (excluding the `proxy.bypass_all` claim)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| A1 | `slider.level` deleted; two dials, no `auto` | ADR-0004:44-56 | `schema.ts:433,470`; `dials.ts:35-45` | `policy.contract.test.ts` | M | — | — |
| A2 | `compression.level: off` = redaction only | ADR-0004:54-56 | `policy.ts:143-147`; `native-lossless.ts:377-381` | `policy.contract.test.ts` | M | — | — |
| A3 | No dial value can disable redaction; `MIN_ACTIVE_COMPRESSION_LEVEL` clamp removed | ADR-0004:78-89 | `policy.ts:25-29` (doc), all rows `redaction: true`. grep `MIN_ACTIVE_COMPRESSION_LEVEL` in code: comment-only | `policy.contract.test.ts:10-33` | M | — | — |
| A4 | Surfaces lost `golem slider`, `level` MCP tool, `level` in telemetry | ADR-0004:101-103 | row 20 | — | M | VS Code `golem.setSlider` and `status --json` not checked (not owned) | — |
| A5 | "Set vs ran" survives via `resolveEffectiveCompression` | ADR-0004:104-107 | `effective-level.ts:88-127` | `effective-level.test.ts` | M | — | — |
| A6 | Verify: no tool call can change pipeline depth | task brief; CLAUDE.md | No MCP tool writes `compression.level`/`brevity.level` (grep `writeSetting\|setDial` in `src/mcp`: nothing). `setDial` callers: `cli/commands/dials-stats.ts`, `config/control-surface-runtime.ts:138-150`, `cli/status-*`, `note-dashboard-watch.ts` | — | M | The control surface (`control-surface-runtime.ts:144-146`) *can* set `compression.level` from the dashboard/panel. That is a UI, not a tool call, and it cannot reach redaction. Flagged under Contradictions §5 in case "tool call" was meant to include remote panels | — |

## Undocumented

Exported behaviour in owned src that no owned doc describes:

- `DEDUP_EXEMPT_TOOLS = ["ToolSearch"]` (`native-lossless.ts:83-111,250-289`): unconditional dedup exemption, R9.23. Load-bearing for snooze, and absent from Compression.md.
- Context substitution stage (`src/compression/context-substitution.ts`, pipeline stage 4). It is one of the two stages the level table's "2/3" cells depend on, and `effective-level.ts:107` names it in user-facing text, yet the owned wiki pages never describe it (Compression Levels.md:111 only mentions it inside a quoted status line). Spec Decision 24 is its source and is not owned here.
- Headroom→Golem CCR backfill (`headroom-ccr-bridge.ts`), accepting 8–64 hex refs and verifying SHA-256/MD5 derivation. Unmentioned in CCR Ref Scope.md, whose "`hash=<64-hex>`" statement it widens.
- `HeadroomMemorySidecar` and `MemorySearchProvider` (`headroom-adapter.ts:736-851`, `memory-search.ts`). KB scope, likely DUST KB partition.
- Orphan-worker reaping and parent-pipe EOF shutdown (`headroom-adapter.ts:47-65,853-1064`, R10.3).
- `LocalDirBlobStore` sharded layout `<root>/<2-char>/<key>` with the concurrent-put convergence contract (`local-blob-store.ts:5-19`).
- PostToolUse extras: the `Read` symbol skeleton (`digest.ts:194-216`, R8.5), the served-WebFetch receipt (`post-tool-use/served-fetch-label.ts`, `post-tool-use.ts:235-262`), vibe capture on every call (`post-tool-use.ts:221-231`), the nested `file.content` slot (`:162`). The 12,000-char default threshold (`:82`) is not in any owned page.
- `src/prompt/` in full: `golem prompt translate|accept` (R5.5 spike) and `golem prompt compact [--apply]` (P3a CLAUDE.md compaction actuator). Documented only in non-owned pages (`Architecture.md`, `Guidance Rules.md`, debriefs).
- `mcpCompressionService` (`src/cli/mcp-compression.ts:47-66`): `stats()` prefers durable telemetry, and `retrieve()` records a durable retrieval event.
- `compressionEffectNote` / `brevityEffectNote` user-facing prose (`dials.ts:181-222`).

## Dead candidates

- `SemanticCompression = "low_relevance"` (`policy.ts:117`) and its worker preset `headroom-worker.py:244`: no `LEVEL_TABLE` row produces it (`policy.ts:138-174` uses only `off`/`stale_turns`/`aggressive`), and no caller passes it.
- `StageConfig.semanticCache` and `SemanticCache` values `strict`/`normal`/`loose` (`policy.ts:120,135`): written, never read (row 42). `normal` is not even used by the table.
- `StageConfig.toolResultCache` on the proxy path: only `src/mcp/in-memory-compression.ts` reads it (row 43).
- `HEADROOM_CLIENT_NPM_PIN` (`pins.ts:32`): its own doc says "Golem does NOT use it". Grep shows consumers only in the barrel re-export and tests.
- `HeadroomSidecar.health()` (`headroom-adapter.ts:723-728`): no `src/` caller found by grep of `.health(` on a `HeadroomSidecar`. The static list is used instead (`status-collect.ts:18`). Verify before removing, since it may be test-only by design.
- `LocalDirBlobStore.stream()` / `.delete()` (`local-blob-store.ts:115-136`): required by the frozen `BlobStore` contract, but no CCR caller. Contract-mandated, so keep. Listed for completeness.
- Duplicated chars/4 estimators: `src/prompt/compact.ts:70-72` and `brevity.ts:153-155` reimplement `compression/tokens.ts:17-22` (minus the `max(1)`). Not dead, but redundant.

## Stale comments

(Phase 3 input. Each one contradicts the code beside it.)

- `src/compression/native-lossless.ts:378`: "Level 0 — byte-faithful passthrough". The branch now serves `compression.level: off`, which is redaction-only, not level 0.
- `src/compression/semantic.ts:2,12,19`: "slider ≥3" / "(level ≥3)". Semantic runs at level ≥2 (`pipeline.ts:648`), and the slider is retired. `:10` "CompressionService (… levels ≤2)" is likewise wrong: lossless runs at every level ≥1.
- `src/compression/index.ts:41`: "semantic-compression seam (slider ≥3)".
- `src/compression/headroom-adapter.ts:8`: "slider ≥3 semantic compression". `:31`: "The exact PyPI pin lives in ./index.ts", but it lives in `pins.ts` (index only re-exports). `:582`: "the slider's behaviour".
- `src/compression/headroom-ccr-bridge.ts:5`: "slider ≥2". Level is right, name retired.
- `src/compression/headroom-worker.py:24,236`: "the Golem slider". `:245`: `"stale_turns" (level 3)`, but `stale_turns` is level **2** (`policy.ts:162`).
- `src/compression/context-substitution.ts:28-29`: "See pipeline.ts's `isCachingUpstream`". It moved to `effective-level.ts:45`.
- `src/prompt/compact.ts:22`: "Tier 2 depends on `golem ext install` (R8.14), which is not built". Decision 53(i) records R8.14 shipping as `golem pkg install`.
- `src/cli/fast-path.ts:332-336` (not owned, but it is the CCR-swap entry point): "program.ts passes no PostToolUseOptions field … into buildHookCommand". False: `src/cli/commands/prompt-guidance.ts:326-332` passes `skeletonEnabled`. See Contradictions §3.
- `src/pipeline/pipeline.ts:720` (DUST1.1's file): "'off' at slider 0".
- `src/mcp/prompts.ts:95` (not owned): prompt text still says "persistent slider".

## Contradictions for the human

Not resolved here. Each needs a decision.

1. **Is level 1 "byte-faithful"?** Compression.md:17-18, Compression Levels.md:32, spec §4 row 1, `dials.ts:210` and CLAUDE.md ("Proxy byte-faithful at compression ≤ 1") all say yes. `native-lossless.ts:191-203` replaces duplicate spans with markers at level 1, and `compaction.ts` strips trailing whitespace from tool results. The code guarantees *reversibility and prefix stability*, not byte-faithfulness. Either the docs mean "prefix-stable/lossless", or dedup/compaction belong above level 1.
2. **CCR swap ignores `compression.level`.** Compression.md bundles "content-reference swaps" into the level-≥1 lossless set, but the PostToolUse hook swaps at every level including `off` (it never loads the dial). Is the hook meant to be dial-independent (it acts on Claude Code's context, not the request), or should `off` stop it?
3. **`knowledge.read_skeleton_enabled: false` is inert for the default hook invocation.** `golem hook post-tool-use` (with no args, or with `--max-inline-chars`) takes the fast path (`src/cli/fast-path.ts:69-75,331-346`), which calls `runPostToolUseHook` without `skeletonEnabled`. The option then defaults to enabled (`post-tool-use.ts:278-285`). Only the commander path (`prompt-guidance.ts:326`) honours the setting. The guard test `tests/unit/cli-fast-path.test.ts:119-135` checks only `redact:`, `maxInlineChars:` and `projectDir:`, so this drift passed CI. This is a real defect (DUST1.1/CLI owners), not doc drift.
4. **Static Headroom-config check contradicts Decision 57.** Decision 57 documents a `router` namespace in `compression.headroom_config`, but `KNOWN_HEADROOM_CONFIG_FIELDS` (`headroom-adapter.ts:529-539`) omits `router`. So `golem status` (via `unreachableHeadroomConfigKeys`, `status-collect.ts:18`) would report a correct `router: {…}` override as unreachable whenever no worker is up. That is the "warned wrongly" direction the list's own doc (`:525-527`) says must not happen.
5. **What counts as a "tool call" for "no tool call can change pipeline depth"?** No MCP tool can. The control-surface runtime (`control-surface-runtime.ts:138-150`) sets `compression.level` from the dashboard/panel, and if that panel is reachable from the remote companion (ADR-0006/0007), a remote actor can change depth. Redaction stays unreachable either way. Confirm this is intended.
6. **Semantic-stage reversibility.** Spec §4 says "everything lossy is reversible". Stale-turn drops by Headroom leave no marker, so they are unrecoverable. The bridge covers only marker-bearing replacements (row 45).
7. **Level-2 sidecar requirement.** `compressionEffectNote("3")` says it "needs `compression.headroom_sidecar`", while the level-2 note (`dials.ts:211-215`) doesn't, even though `resolveEffectiveCompression` degrades both 2 and 3 identically without the sidecar (`effective-level.ts:115-124`).

## Unverifiable here

- All measured numbers (§103: 7.08%/21.69% gross, first divergence at message 6 of 4,631, 8.7×–11.3×; §93/§99/§104 cache-hit figures; Decision 57's 19,181 vs 15,740 tokens). These need the recorded sessions and a live Headroom 0.30.0. The code only enforces the conclusions.
- Headroom-internal claims: `read_lifecycle` behaviour, `ContentRouterConfig.lossless` disabling marker injection, `DEFAULT_EXCLUDE_TOOLS` contents, and the hash algorithms used by Headroom transforms (`headroom-ccr-bridge.ts:14-17`). These need the pinned PyPI source. Python tests are skipped without `python` on PATH (Decision 53(h)).
- The live-reload latency ("within a second", Compression Levels.md:24). Needs a running proxy.
- Claude Code honouring `updatedToolOutput` for each tool (verification-notes §20). External runtime behaviour.
