# DUST1.11 — cross-cutting audit: vision, roadmap, positioning, wiki index, unowned code

Branch `dust/DUST1.11`, base `fd3aedc` (development, 2026-09-25). Read-only: this file is
the only change. No test suite run. Evidence is `path:line` at base; "0 hits" means a
grep of non-test `src/**/*.ts` returned nothing. Classes: **M** shipped-and-matches ·
**D** shipped-but-drifted · **P** partial · **N** not-started · **X** dead-or-superseded.

## Bucket counts

| scope | M | D | P | N | X | total |
|---|---|---|---|---|---|---|
| Claims table (spec, Decisions, wiki, project prose) | 27 | 32 | 14 | 5 | 5 | 83 |
| Unowned code (`src/cli/commands/`, one row per file) | 20 | 7 | 1 | 0 | 0 | 28 |
| **All** | **47** | **39** | **15** | **5** | **5** | **111** |

Plan hygiene is reported separately: 25 non-DUST queued docs (1 already-shipped,
7 partially-shipped, 17 still-open), 52 done docs checked (10 gate mismatches), and
4 task docs missing from the generated ROADMAP.

## Claims table

### Spec header, §1 Vision & Goals, Non-goals, hardware profiles

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 1 | Spec version/date line | `docs/golem-spec.md:5-6` (v1.17, 2026-07-16) | Decisions run to v1.32 and Decision 64 dated 2026-09-07 (`docs/golem-spec.md:523`) | — | D | header is 15 minor versions and ~2 months behind the log it heads | none |
| 2 | Naming note | `docs/golem-spec.md:8` | the dead name was scrubbed as a string, so the note now reads "renamed from the working title 'Golem / Edge Offload Layer'" and "'Golem' survives only inside dated Decisions Log entries" | — | D | the sentence contradicts itself after the scrub; the real old name ("EOL / Edge Offload Layer") is at `docs/golem-spec.md:329` | none |
| 3 | Identity: "agentic developer assistant layer for Claude" | `docs/golem-spec.md:14` | Decision 32 (`docs/golem-spec.md:434`) says this framing is narrower than the decided scope and revised README/CLAUDE.md; `README.md:1` and `CLAUDE.md` say "universal pre-LLM processing layer" | — | D | spec §1 is the one identity surface Decision 32 did not revise. The README/Decision 32 side looks right | none |
| 4 | Lossy/semantic compression "at `compression.level: 3`" | `docs/golem-spec.md:14` | semantic engages at level 2 (`src/interfaces/policy.ts:157-162`, `stale_turns`) and 3 (`:172`, `aggressive`) | `pipeline.ts` gating is DUST1.3's | D | code: ≥2. Doc: 3 | none |
| 5 | Cross-platform hard requirement, "3-OS CI matrix" | `docs/golem-spec.md:18` | macOS is advisory: `.github/workflows/ci.yml:145-153` (`continue-on-error: true`) | — | D | also names `platformdirs`, "Python/uvx", "Qdrant embedded client". The code uses `env-paths` (`package.json`, dependencies) and a pure-TS JSONL vector driver (`src/knowledge/file-driver.ts:1-15`) | none |
| 6 | Slash commands `/golem/...` | `docs/golem-spec.md:19`, `:275` | shipped skills are flat `/golem-<cmd>` (see CLAUDE.md "What this project is") | `tests/integration/skill-provenance-clone.test.ts` (flat layout) | D | — | none |
| 7 | Headroom behind an adapter, version-pinned | `docs/golem-spec.md:40-44` | `src/compression/headroom-adapter.ts:1-20`, pin at `src/compression/pins.ts:18`, uv spawn `headroom-adapter.ts:607` | DUST1.3 | M | this is a Python worker per stage, not an in-process library. The adapter header states that (`:13-14`); §1.2's "as a library" reads as in-process | none |
| 8 | `search_local` federates memory and knowledge | `docs/golem-spec.md:48` | the tool is `search` (`src/mcp/search.ts:298`). `search_local` has 0 hits | — | D | renamed by Decisions 27/35. §1.2 kept the old name | none |
| 9 | P-cpu profile gets "exact caching" | `docs/golem-spec.md:64` (also `:149`, Tier 0 "exact-match caching") | no response cache: 0 hits for `exact[- ]match cach`, `responseCache`, `exactCache`. The caches that exist are WebFetch and CCR | — | N | DUST1.3 (§3.4) should confirm | none |
| 10 | Non-goals (no cloud-hosted deployment, and so on) | `docs/golem-spec.md:54-58` | a hosted team tier exists (`src/portal/team-layer.ts`, Decision 64 at `docs/golem-spec.md:523`) | — | D | "Cloud-hosted deployment (local/LAN only)" is now qualified by the paid hosted team layer. Needs a human call on whether that counts (see Contradictions) | none |

### §2 Architecture Overview (overall picture)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 11 | "Single process, two doors" | `docs/golem-spec.md:114`; also `docs/wiki/concepts/Architecture.md:28,42`, `README.md:23` | MCP is a per-session stdio child (`.mcp.json:4-7` → `golem mcp serve`, `src/cli/commands/mcp-serve.ts:141-143`). The proxy is a separate detached daemon (`src/cli/proxy-daemon.ts:451`) | `tests/integration/mcp-server.test.ts`, `tests/unit/cli/proxy-daemon.test.ts` | D | two processes that share on-disk state (KB, CCR, telemetry), not one engine in one process | none |
| 12 | SDK surface ("Python/TS SDK", "thin wrapper over Anthropic SDK") | `docs/golem-spec.md:86`, `:127` | `src/index.ts` exports only `./interfaces` and `VERSION` | — | N | — | none |
| 13 | LAN workers over "gRPC/HTTP" with a worker agent reporting GPU/VRAM/load | `docs/golem-spec.md:100-109`, `:147` | LAN inference is an Ollama URL (`inference.ollama_base_url`, `src/config/schema.ts:281`). `golem device` and the `devices` tool exist (`src/mcp/devices-snooze.ts:48`). 0 gRPC hits, and no worker-agent process. `src/inference/workers.ts` is an unrelated "worker" (persona lane) | DUST1.6 | P | name clash: "worker" means a persona lane in code and a LAN machine in the spec | none |
| 14 | `npx golem-run init`, later `brew install golem-run` | `docs/golem-spec.md:116` | the package is now `@pliable/golem` (`package.json:2`, renamed in `2fc7cd2`). There is no brew formula; `install/install.sh:102` uses brew only to install node | — | D | see Contradictions, item 1 | R7.5 |
| 15 | MCP tools `search_local`, `summarize_local`, `cache_lookup`, `delegate_task`, `index_path`, `get_original(ref)` | `docs/golem-spec.md:121`, `:126` | 0 hits for all six. The live set is 11 tools: `code`, `coder`, `devices`, `snooze`, `search`, `fetch`, `ingest`, `expand`, `stats`, `wiki_read`, `wiki_upsert` (`src/mcp/*.ts` `registerTool`) | — | X | superseded by Decisions 27/35; §2.1 was never updated | none |
| 16 | MCP over stdio plus streamable HTTP | `docs/golem-spec.md:126` | `src/mcp/serve.ts:17,68` | `tests/integration/mcp-server.test.ts` | M | — | — |
| 17 | Skills orchestrate, tools execute (R9.11), enforced by a contract test | `docs/golem-spec.md:131-144` | test exists | `tests/contract/skills-tools-layering.contract.test.ts` | M | `:133` and `:144` still name the retired `level` tool, but only as history | — |

### §7 Phased Roadmap

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 18 | P0: `/golem/*` commands, 3-OS CI | `docs/golem-spec.md:275` | see rows 5 and 6 | — | D | — | none |
| 19 | P1: Qdrant indexing, MCP `index_path` / `search_local` / `get_chunk`, guidance "prefer search_local" | `docs/golem-spec.md:276` | JSONL file driver (`src/knowledge/file-driver.ts:1-15`). The tools are `ingest`, `search`, `fetch`. `get_chunk` has 0 hits | DUST1.4 | D | shipped under other names and another store | none |
| 20 | P2: local test/lint execution → failure digests | `docs/golem-spec.md:277` | 0 hits for "failure digest" and no test-runner tool | — | N | — | none |
| 21 | P3: Whisper/OCR preprocessing, speculative prefetch | `docs/golem-spec.md:278` | 0 hits for whisper and prefetch. The only "ocr" hit is `autocrlf` (`src/checkpoint/ledger.ts:32`) | — | N | "git-aware context tools" was not checked (see Unverifiable) | none |
| 22 | P3: "level 5 (per-project opt-in)" | `docs/golem-spec.md:278` | four levels only (`src/interfaces/policy.ts:138-176`). ADR-0004 retired the slider | — | X | — | none |
| 23 | P4: fleet (device registry, scheduler, LAN workers, canary evals) | `docs/golem-spec.md:279` | device registry exists (`src/cli/commands/device.ts:51`). No cross-machine scheduler found | `tests/unit/security/device-auth.test.ts` | P | "device" in the code is a paired phone or companion (ADR-0006), not a GPU box | none |
| 24 | Decision 21 phase placement note | `docs/golem-spec.md:283` | superseded by Decision 36's renumbering (`:465`). R6 then shipped 2026-07-23 (`docs/plan/SHIPPED.md:28`) | — | X | — | none |

### §8 Risks & Mitigations

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 25 | Semantic cache: strict thresholds, TTL, never for tool use | `docs/golem-spec.md:292` | `semanticCache` is set per level (`src/interfaces/policy.ts:147,155,163,173`) and has **no consumer** in `src` | — | N | a dead field in a frozen interface. DUST1.3 owns the stage | none |
| 26 | mTLS between hub and workers | `docs/golem-spec.md:293` | mTLS exists for the device write surface (`src/proxy/loopback-cert.ts`) | `tests/integration/write-surface-mtls.test.ts` | P | there is no hub↔worker protocol to protect (row 13) | none |
| 27 | Credentials in OS keychain, never plaintext | `docs/golem-spec.md:302` | `src/credentials/store.ts`; keychain is the default for `gateway login` (`src/cli/commands/gateway.ts:87-95`) | DUST1.2 | M | there is a file fallback (see `src/cli/commands/team.ts:447` under Stale comments) | — |
| 28 | Autonomy gates for irreversible actions | `docs/golem-spec.md:295` | `src/autonomy/gate.ts`, ADR-0002 | `tests/unit/autonomy/gate.test.ts` | M | — | — |
| 29 | Remote approval = RCE, needs strong auth and default-deny | `docs/golem-spec.md:298` | ADR-0006 accepted (Decision 59). Device auth and mTLS (`src/cli/commands/device.ts`) | `tests/integration/write-surface-mtls.test.ts` | M | DUST1.10 owns the detail | — |
| 30 | Resumed durable task double-applies a side effect (idempotency keys) | `docs/golem-spec.md:296` | auto-resume was dropped (Decision 37). No idempotency-key code | — | X | the risk row outlived the feature | none |
| 31 | Decision 25 local-first row | `docs/golem-spec.md:299` | marked retired by Decision 31 | — | M | — | — |
| 32 | ToS and quota-arbitrage caution | `docs/golem-spec.md:300` | account switching is user-initiated (`golem gateway use`, `gateway.ts:58`). No rotation code found | — | M | — | — |

### §9 "To verify against live docs"

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 33 | PostToolUse replaces output via `updatedToolOutput` | `docs/golem-spec.md:527` | `src/hooks/post-tool-use.ts:5,18` | DUST1.7 | M | — | — |
| 34 | Init refuses under `headroom wrap` | `docs/golem-spec.md:528` | `src/cli/init.ts:364-369` | `tests/integration/cli-init-*.test.ts` | D | the behaviour matches, but the prose says "EOL-owned proxy" and "`eol init`", and `:529` says "the slider mapping target". Decision 36 scrubbed §1–§8 only | none |

### Decisions 20, 21, 32, 36 (and >64)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 35 | 20a durable task queue (auto-resume dropped) | `docs/golem-spec.md:337` | `src/cli/commands/tasks.ts:73-424`; store at `src/tasks/store.ts:28` (`.golem/tasks/`) | `tests/unit/cli/task.test.ts` | M | the CLI also carries `index`/`done`/`review`, which run over `docs/plan/tasks/` (`src/tasks/plan-task.ts:39`). That is a second store under the same verb (see Contradictions) | — |
| 36 | 20b task/question queue + concurrent-conversation multiplexing | `docs/golem-spec.md:338` | the local queue runs with concurrency 2 (`src/tasks/multiplex.ts:153`). No concurrent-conversation multiplexing | `tests/unit/tasks/*` (DUST1.7) | P | "ties to … the slider" is stale | none |
| 37 | 20c self-hosted remote session access | `docs/golem-spec.md:339` | hosted session (`src/cli/commands/session-host.ts:72`), device mTLS, ADR-0006/0007. The internet relay is not built (0 relay/tunnel hits outside Buzz) | `tests/integration/hosted-session.test.ts` | P | LAN only today | R13.10, R13.8 |
| 38 | 20d cruise-control autonomy | `docs/golem-spec.md:340` | `src/cli/commands/autonomy.ts:37-156`, `src/autonomy/` | `tests/unit/autonomy/gate.test.ts` | M | — | R13.9 (gate map) |
| 39 | 20e tiered user/workspace/org standards | `docs/golem-spec.md:341` | team layer (`src/cli/commands/team.ts:241`, `src/portal/team-layer.ts`), Decision 64 | `tests/unit/cli/team-status-solo.test.ts` | P | one team scope. No separate workspace-vs-org tiers | none |
| 40 | 20f note capture that shapes context (CLI + MCP tool + hook) | `docs/golem-spec.md:342` | CLI exists (`src/cli/commands/note-dashboard-watch.ts:24`), with distill (`:63`). No note MCP tool among the 11 | `tests/unit/cli/notes.test.ts` | P | "surfaced to shape later conversations" not checked | none |
| 41 | 20g writing-style adaptation and prompt translation | `docs/golem-spec.md:343` | spike only (`src/prompt/translate.ts:1-15`). Scored learning is not built | `tests/unit/prompt/translate.test.ts` | P | — | R5.5-scoring |
| 42 | 21a parallel conversations with model escalation | `docs/golem-spec.md:345` | `golem task escalate` (`tasks.ts:424`). No mid-thread handoff | — | P | — | none |
| 43 | 21b remote steering / permission-granting | `docs/golem-spec.md:346-351` | PermissionRequest half (`src/cli/init-hooks.ts:74`, R12.12). Device approval (Decisions 59/61) | DUST1.10 | P | `:347` "status/slider" is stale. Live confirmation is owner:user | R12.13, R12.14, R13.15 |
| 44 | 21c dashboard sidecar: statusline, watch, VS Code | `docs/golem-spec.md:352-357` | `src/cli/statusline.ts`, `golem watch` (`note-dashboard-watch.ts:166`), `vscode-extension/package.json:38-74` | `tests/unit/cli/watch.test.ts` | D | the text still has "slider", the `L1` example and "change slider". The extension command is now `golem.setCompression` (`vscode-extension/package.json:46`) | none |
| 45 | 21d account switching | `docs/golem-spec.md:358` | shipped as `golem gateway` (`src/cli/commands/gateway.ts:35-218`) | `tests/unit/cli/gateways.test.ts` | D | "account" survives in docs (see the Unowned code phantom list) and in the VS Code command `golem.setAccount` (`vscode-extension/package.json:50`) | none |
| 46 | 21e multi-provider routing / quota arbitrage | `docs/golem-spec.md:359` | `src/providers/*` (openai, gemini translation) and `routing.ts` | DUST1.2 | P | there is a per-target router. No cost/quota arbitrage, which is ToS-gated by design | none |
| 47 | 21f cost-governance benchmarks | `docs/golem-spec.md:360` | `golem bench cost` (`src/cli/commands/bench.ts:80-83`) | `tests/unit/telemetry/cost-benchmark.test.ts` | M | — | — |
| 48 | 32 positioning: universal pre-LLM processor | `docs/golem-spec.md:431-436` | `README.md:1`, `CLAUDE.md` intro, `src/providers/*` shipped (R6.1) | — | M | but see row 3. Also "R5.1" means provider adapters here, while Decision 20a (`:337`) uses R5.1 for the durable queue. Pre-renumber and post-renumber IDs collide | — |
| 49 | 36 roadmap refocus: R5/R6 ON HOLD; housekeeping | `docs/golem-spec.md:464-468` | housekeeping verified: `docs/edge-offload-spec.md`, `docs/DEVELOPMENT.md`, `docs/plan/R1_BATCH.md` and `docs/plan/workstream-briefs/` are absent, `docs/plan/verification-notes.md` exists, and `concepts/Dogfooding Golem.md` exists | — | D | R6 shipped 2026-07-23 (`docs/plan/SHIPPED.md:28`), 7 days after the hold. No Decision records the lift (grep of `:469-530` for R6 / hold) | none |
| 50 | Decisions above 64 / unclaimed | task brief | `docs/golem-spec.md:523` (64) is the last. 1–64 are all claimed by DUST1.1–DUST1.10 | — | M | nothing to classify | — |

### Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md`

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 51 | §1 topology: one process; MCP "search · fetch · expand · coder · ingest · stats" | `docs/wiki/concepts/Architecture.md:42-44` | see row 11. 11 tools registered, 6 drawn | — | D | missing: `code`, `devices`, `snooze`, `wiki_read`, `wiki_upsert` | none |
| 52 | §2 lifecycle: local answer "opt-in" | `Architecture.md:103`; `README.md:42` | `knowledge.local_answer_enabled: true` by default (`src/config/schema.ts:1137`), matching `.claude/rules/golem-local-answer.md` | — | D | semantic at ≥2 (`:108`) matches `policy.ts:157-162` | none |
| 53 | §3 routing; "switch with `golem account use <id>`" | `Architecture.md:164` | `golem gateway use` (`src/cli/commands/gateway.ts:58`) | `tests/unit/cli/gateways.test.ts` | D | the rest of §3 matches `src/inference/service.ts` and `src/providers/index.ts` | none |
| 54 | §4 observability, one `SessionStateReport` | `Architecture.md:169-186` | `src/cli/session-report.ts`; all cited paths exist | DUST1.9 | M | — | — |
| 55 | §5 PreToolUse stack = snooze, coder-first, autonomy | `Architecture.md:190-208` | init also installs a WebFetch PreToolUse matcher (`src/cli/init-hooks.ts:346`) and a PermissionRequest half (`:74`). Snooze is now advisory by default (`.claude/rules/golem-snooze-hold.md`) | DUST1.7 | P | the stack as drawn is incomplete | none |
| 56 | §6 task multiplexing and prompt translation | `Architecture.md:212-277` | `src/tasks/multiplex.ts:127,153` (concurrency 2); `src/prompt/translate.ts:46,69` (last 3 examples) | `tests/unit/prompt/translate.test.ts` | M | — | — |
| 57 | Dogfooding Golem (dev loop) | `docs/wiki/concepts/Dogfooding Golem.md` | proxy verbs match (`src/cli/commands/proxy.ts:511-653`). Headroom "compression ≥3" (`:50,:145-147`) is wrong: semantic runs at ≥2 and is gated off on caching upstreams (`pipeline.ts:647-651`). Dev port 4655 (`:41,:66-67`) equals `security.write_port` 4655 (`src/config/schema.ts:1152`). `proxy start --detach` (`:33,:83,:182`) has no such flag | — | D | following the page on the default upstream never engages Headroom | none |

### Wiki: `syntheses/`, `questions/`, `sources/`

| # | page | code evidence | class | note | existing task |
|---|---|---|---|---|---|
| 58 | `syntheses/r3.7-lancedb-scale-spike.md` | LanceDB not in deps, only in comments (`src/knowledge/driver.ts:5,137`). The flush fix shipped (`src/knowledge/file-driver.ts:218-247`) | M | — | — |
| 59 | `syntheses/r1.2-positioning-universal-preprocessor.md` | `README.md:1`, `src/providers/*` | M | the WIKI.md blurb (`:136`) says "not yet scheduled", which is stale | — |
| 60 | `syntheses/r1.1-net-of-cache-ab.md` | `isCachingUpstream` moved to `src/compression/effective-level.ts:45`. Level 3 also flips `toolResultCache`/`semanticCache` (`policy.ts:171-176`) | D | "slider level" wording | none |
| 61 | `syntheses/r2.1-avoidedupstream-spike.md` | avoidedUpstream shipped (`src/pipeline/pipeline.ts:95-105,709`). Tools are instrumented (`src/mcp/shared.ts:54-63`) | X | accurate as a 2026-07-11 record; overtaken since | — |
| 62 | `syntheses/r4.7-drafter-quality-baseline.md` | catalog is still qwen2.5-coder (`src/inference/catalog.ts:33,45`) | M | `clampSliderLevel` no longer exists | — |
| 63 | `syntheses/le2-grounded-refined-coder-quality.md` | `src/mcp/coder-refine.ts:37,156` | D | cites `clampSliderLevel`, `MAX_SLIDER_LEVEL`, `policy.ts:45`, `server.ts:670` (now `src/mcp/search.ts:256`). **Unlisted in WIKI.md** | none |
| 64 | `syntheses/r4-co-developer-core-batch.md` | `src/cli/commands/wiki.ts:171`, `src/mcp/search.ts:207,256` | D | "five local tools" (now 11). "R5/R6 ON HOLD" (both shipped) | none |
| 65 | `syntheses/r5-autonomy-orchestration-batch.md` | `tasks.ts:27-48`, `src/dashboard/server.ts:221`, `autonomy.ts:123` | P | follow-ups mostly done. No auto-resume loop (by design, Decision 37). "slider", "R6 ON HOLD" | none |
| 66 | `syntheses/r6-multi-provider-batch.md` | `src/providers/*`, `bench.ts:81` | D | `golem account` → `gateway`; `active_account`/`proxy.accounts` renamed (`src/config/migrations.ts:42-63`). "keychain future" is wrong (keychain is the default). Frontmatter cites a nonexistent `docs/wiki/decisions/ADR-0003…` | none |
| 67 | `syntheses/wiki-knowledge-loop-batch.md` | `policy.ts:139-148`, `schema.ts:1068` | D | "slider ≥1 … drop to level 0" (`:78-79`). Plan-gated promotion was reversed by Decision 44. `CLAUDE.local.md` guidance → `.claude/rules/` | none |
| 68 | `questions/r1.6-ollama-verification-blocked.md` | still open (`docs/plan/verification-notes.md:1164-1166`) | M | accurate | R1.6 |
| 69 | `questions/wiki-write-autonomy.md` | resolved by Decision 29, then Decision 44 (page `:10-16`). `wiki_read`/`wiki_upsert` exist | M | accurate. **Unlisted in WIKI.md** | — |
| 70 | `sources/agentic-token-saving-techniques.md` | Tool Search relayed (`src/cli/commands/proxy.ts:608`); `stats --cache` (`dials-stats.ts:115`) | D | the "honest gaps" are closed. "slider-gated" | none |
| 71 | `sources/kimi-k3.md` | settings keys exist (`schema.ts:132-164`) | D | `golem account login/add/use` at `:57-62` → `gateway`; `--model` vs `--models` | none |
| 72 | `sources/llm-wiki-second-brain-obsidian.md` | — | D | "plan-before-write" was reversed by Decision 44. `delegate` → `coder` | none |
| 73 | `sources/local-coder-models-2026.md` | `catalog.ts:33,45` | M | — | — |

### Project prose: CLAUDE.md, README.md

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 74 | CLAUDE.md "What this project is": npm **`golem-run`** | `CLAUDE.md` intro | `package.json:2` `@pliable/golem`. `golem-run` returns E404 on npm; `@pliable/golem` is at 0.54.2 (plan agent `npm view`) | — | D | see Contradictions, item 1 | R7.5 |
| 75 | CLAUDE.md MCP tool list `search`, `fetch`, `expand`, `stats`, `ingest`, `coder` | `CLAUDE.md` intro | 11 registered (row 15) | — | P | missing: `code`, `devices`, `snooze`, `wiki_read`, `wiki_upsert` | none |
| 76 | CLAUDE.md `level` retired; `/golem-<cmd>`, `GOLEM_*` | `CLAUDE.md` intro | no `level` tool; flat skill names | `tests/contract/skills-tools-layering.contract.test.ts` | M | — | — |
| 77 | CLAUDE.md "Source of truth" (task docs → ROADMAP generated) | `CLAUDE.md` | `src/tasks/plan-task.ts:176` silently skips docs that fail to parse | — | D | 4 docs never reach ROADMAP (see Plan hygiene) | none |
| 78 | README pillars and identity | `README.md:1-19` | matches Decision 32 | — | M | — | — |
| 79 | README "`/golem/*` skills", "one local process", "opt-in" local answer | `README.md:18,23,42` | rows 6, 11, 52 | — | D | — | none |
| 80 | README install / `npm i -g golem-run` / `golem update` | `README.md:3,53-62` | `install/install.sh:53`, `install/install.ps1:39`, `src/update/index.ts:22` (`PACKAGE_NAME = "golem-run"`) all target the 404 name | — | D | the npm installer rung and `golem update` would fail against npm | R7.5 |
| 81 | README panel flags `--dir` / `--no-pet` / `--advanced` | `README.md:91-92` | `src/cli/panel-args.ts:13,31,51`, `src/cli/program.ts:20` | DUST1.9 | M | the 170ms / 126ms timings are unverifiable here | — |
| 82 | README `npm run check` = lint + typecheck + tests | `README.md:115` | `package.json:47` (also runs `verify:deps`) | — | M | — | — |
| 83 | README non-interactive `golem config`, `guidance`, `compression`, `brevity`, `config schema --json` | `README.md:99-101` | `src/cli/commands/config.ts:108,255`; `dials-stats.ts:35`; `prompt-guidance.ts:231` | `tests/unit/cli/config.test.ts` | M | — | — |

## Unowned code

A path-prefix match of every `src/**` path named in DUST1.1–DUST1.10 against every
non-test `src/**/*.ts` leaves exactly **28 files, all in `src/cli/commands/`**. Nothing
else is unclaimed. Every file is registered from `src/cli/program.ts:23-75` except
`session-host.ts` (mounted under `session`, `src/cli/commands/session.ts:17,57`) and
`select-target.ts` (a helper imported at `gateway.ts:24` and `target.ts:13`). None is dead.
Two commands bypass commander: `hook` (`prompt-guidance.ts:389`, built in
`src/hooks/command.ts:48`) and `statusline` (only in `src/cli/fast-path.ts:64-67`).

| file | commands | documented? | test | class | note |
|---|---|---|---|---|---|
| autonomy.ts | `autonomy` show/enable/disable/set/wire/unwire/log (:37-156) | yes | `tests/unit/autonomy/gate.test.ts` | M | — |
| bench.ts | `bench` cost/map/edit/tools (:80-271) | yes | `tests/unit/telemetry/cost-benchmark.test.ts` | M | `--role` help (:137,:210,:280) lists 3 roles; the code accepts 5 (:164) |
| buzz.ts | `acp` (:17) | yes (`Buzz Integration.md:39`) | `tests/unit/buzz/acp-protocol.test.ts` | M | the file name and command name differ |
| checkpoint.ts | `checkpoint`/`cp` (:32) | yes | `tests/unit/cli/checkpoint.test.ts` | M | — |
| config.ts | `config` list/get/set/unset/migrate/schema (:108) | yes | `tests/unit/cli/config.test.ts` | M | default scope `local` (:162) matches Decision 58 |
| device.ts | `device` (:51) | yes | `tests/integration/write-surface-mtls.test.ts` | M | — |
| dials-stats.ts | `compression`, `brevity` (:35), `stats` (:109) | yes | `tests/integration/cli-stats.test.ts` | M | the dial writes have no direct test |
| gateway.ts | `gateway` list/use/login/logout/add/remove (:35-218) | **no** (only `.claude/skills/golem-upstream/SKILL.md:14-23`) | `tests/unit/cli/gateways.test.ts` | D | the docs still say `golem account` |
| init-uninit.ts | `init` (:107), `uninit` (:198) | yes | `tests/integration/cli-init-uninit.test.ts` | M | comment conflict (Stale comments) |
| local-ollama.ts | `local`, `coder`, `index`, `devices`, `ollama` (:43-257) | `local` and `coder` undocumented | `tests/integration/cli-ollama.test.ts` | M | `local enable/url` and `coder` default to `--scope project` (:75,:101,:125), while `config set` defaults to `local` |
| mcp-serve.ts | `mcp serve` (:141-143) | yes | `tests/integration/mcp-server.test.ts` | M | — |
| note-dashboard-watch.ts | `note`, `dashboard`, `watch` | yes | `tests/unit/cli/notes.test.ts` | M | — |
| personas.ts | `personas` list/eject | yes | `tests/unit/cli/personas.test.ts` | M | — |
| pkg-models.ts | `pkg`, `models` | yes | `tests/unit/cli/pkg.test.ts` | M | stale comment at :6 |
| plugin.ts | `plugin` list/status | yes | loader only | M | `collectPlugins` is untested |
| prompt-guidance.ts | `prompt`, `guidance`, `hook`, `hook session-start` | yes | `tests/integration/hooks/guidance.test.ts` | **D** | **Bug:** SessionStart auto-start (:377-383) calls `startDetached(…, {}, …)`. `startDetached` always sets the credentials-injected marker (`src/cli/proxy-daemon.ts:456`), so the daemon skips credential resolution (`proxy.ts:215`) and gateway keys never load. Confirmed by reading; not reproduced. The same pattern is at `src/config/control-surface-runtime.ts:184` (not traced) |
| proxy.ts | `on`, `off`, `proxy` status/start/stop/restart/wire/unwire | `on`/`off` undocumented | `tests/unit/cli/proxy-daemon.test.ts` | D | `:495-497` prints "Pipeline is active" without checking `proxy.bypass_all`, which breaks the header's R11.3 promise (:8-11) |
| ps.ts | `ps` (:766) | **no** | **none** | P | the `dashboard` kind is in the help (:768) but never collected (:798-804) |
| select-target.ts | helper | n/a | **none** | D | duplicates proxy.ts's `resolvePort` (:72) and `restartProxyDetached`. Its copy (:44) skips the port-free check and `writeProxyDesired("running")` (proxy.ts:99,:114), despite claiming the one-resolver rule (:23-26) |
| session-host.ts | `session host` start/serve/list/log/stop/forget/explain | yes | `tests/integration/hosted-session.test.ts` | M | :77 says "one or more messages"; the code sends one turn |
| session.ts | `session` (tree is the default action), pending/drop/forget | yes | `tests/unit/session-tree.test.ts` | D | `WIKI.md:128` says `golem session tree`, which is not a subcommand |
| status-update.ts | `status`, `update`/`upgrade` | yes | `tests/unit/update/update.test.ts` | M | `update` targets `golem-run` (row 80) |
| target.ts | `target` list/use/show/add/test | **no** | `tests/unit/cli/targets.test.ts` | D | user-facing strings say 'account login' (:110) and `proxy.accounts` (:80,:165), which was renamed to `proxy.gateways` (`src/config/migrations.ts:58-60`) |
| tasks.ts | `task` (10 verbs, :73-424) | yes | `tests/unit/cli/task.test.ts` | M | `review --waive` with no id and no `--all` waives every outstanding run (:346,:356). Check that this is intended |
| team.ts | `team` link/status/sync/unlink/logout/skills | yes | `tests/unit/cli/team-status-solo.test.ts` | **D** | **Bug:** `sync` calls `portalContext()` (:492) before the unlinked early return (:495-497). `resolvePortalConfig` throws `PortalAuthError` when no portal is configured (`src/portal/config.ts:49,57`), so solo users get exit 2. This is the regression `:405-411` records as fixed for `status` |
| verify.ts | `verify` | yes | `tests/unit/cli/verify-progress.test.ts` | M | `runVerify` is untested |
| vibe.ts | `vibe` (8 verbs) | yes | `tests/unit/vibe-store.test.ts` | M | — |
| wiki.ts | `wiki` init/check/distill/synthesize/promote | yes | `tests/unit/cli/wiki.test.ts` | M | — |

**Docs naming removed or nonexistent commands** (outside debriefs):
- `golem account …`: `docs/wiki/concepts/Architecture.md:164`; `docs/wiki/sources/kimi-k3.md:57,60,62`; `docs/wiki/syntheses/r6-multi-provider-batch.md:27,34`; `docs/wiki/WIKI.md:194-195`; `docs/golem-spec.md:487-494` (Decisions 46–49, historical)
- `golem slider`: `docs/golem-spec.md:420,482` (historical)
- `golem ui` / `golem settings`: `docs/golem-spec.md:496`, superseded at `:498`
- `golem ext` (now `pkg`): `docs/golem-spec.md:502`
- `golem replay-eval`: `docs/golem-spec.md:244`, in the current §5 feature list. Never implemented (DUST1.9)
- `golem buzz status` / `golem buzz provision`: `docs/wiki/concepts/Buzz Integration.md:284,380,470`. Planned; only `acp` exists (DUST1.10)
- `golem session tree`: `docs/wiki/WIKI.md:128`
- `golem proxy start --detach`: `docs/wiki/concepts/Dogfooding Golem.md:33,83,182`

## WIKI.md index integrity

- **Resolution rule:** a `[[wikilink]]` resolves against the frontmatter `title:`, exactly and case-sensitively (`src/wiki/frontmatter.ts:90-95`, `src/cli/wiki.ts:558-566`, `src/wiki/file-wiki-store.ts:96-109`). 13 non-debrief pages have a title that differs from the filename.
- **Listed → exists:** 225 bullets. 2 are not page entries (`:104` is a `questions/` heading-bullet, `:132` is the ADR note). Of the 223 page entries, 28 are wikilinks (all resolve) and 195 are paths (all exist). **0 dangling.**
- **Exists → listed:** 229 `.md` files besides WIKI.md; 223 listed. **6 unlisted:**
  `concepts/Context Ledger.md`, `concepts/Hosted-multi-turn-claude-CLI-spike.md`,
  `concepts/Plan Tasks.md`, `questions/wiki-write-autonomy.md`,
  `syntheses/le2-grounded-refined-coder-quality.md`,
  `[REDACTED:high-entropy:3].md`.
  `golem wiki check` flags only unlisted debriefs (`src/cli/wiki.ts:569-590`), so this passes lint. All 171 debriefs are listed.
- **Descriptions (66 checked):** 10 mismatches:
  - `:132`: lists ADR-0001–0003 only and calls ADR-0003 "PROPOSED". It is ACCEPTED/AMENDED (`docs/decisions/ADR-0003-…md:12`), and ADR-0004–0008 are missing.
  - `:266` Team Layer: "sits in the ladder twice". Superseded by ADR-0008, which leaves one `team` origin (`src/config/loader.ts:81`).
  - `:89` Distillation Pipeline: "(capture + distill built)". Promote shipped (`src/cli/commands/wiki.ts:171`), and "plan-gated" was reversed by Decision 44.
  - `:143` r2.1: "uninstrumented, no avoidedUpstream". Both exist now (row 61).
  - `:136` r1.2: "not yet scheduled". The adapters shipped.
  - `:153` r3.7: omits that the flush fix shipped (minor).
  - `:103` agentic-token-saving: its "honest gaps" are closed (row 70).
  - `:104` `questions/`: implies open questions and lists only r1.6.
  - `:72` Persona Registry: omits the retirement of `worker_targets` (`src/config/migrations.ts:98-103`).
  - `:73` Buzz Integration: "block.xyz" vs buzz.xyz (cosmetic).

## Plan hygiene

**Queued docs whose work already shipped (report only):**
- **R6.3**: already-shipped. ADR-0006 is ACCEPTED (`docs/decisions/ADR-0006-…md:12`, Decision 59, `docs/plan/SHIPPED.md:122`). The doc's own close rule (`R6.3.md:69-70`) is met, and its blocker is resolved.
- **R14.3**: Stage 1 shipped (`src/cli/commands/buzz.ts:17`, `src/buzz/acp-*.ts`, `tests/unit/buzz/acp-protocol.test.ts`). Stage 2 (live relay) is open.
- **R13.17**: mostly shipped. The `test:*` scripts are in `package.json:39-42`, and checkpoint-ledger and cli-init are already split. Only `tests/integration/cli-status.test.ts` is left. `SHIPPED.md:158-159` present it as landed, and the doc's "cli-init waits on R13.16" is stale.
- **R14.2**: partial. `mintIdentity`/`provisionBuzz` (`src/buzz/identity.ts:254`, `src/buzz/provision.ts:172`) have no CLI and no caller. The blocker (R14.3 `acp`) is resolved.
- **R13.8** (scrollback exists at `src/session/transport.ts:31`), **R7.3** (binaries are built and attached, never executed; "CI is Ubuntu-only" is stale, `ci.yml:145-153`), and **R7.6-infra**: partial.
- **R7.5**: the gate names `golem-run`, which is E404. The package is `@pliable/golem` 0.54.2, and live code still uses the old name (row 80).
- **R13.14**: `SHIPPED.md:154` says verification-notes §148 recorded the unblocking delegation. §148 (`docs/plan/verification-notes.md:8246`) is about R13.7 join-injection, and no delegation record exists. **The blocker-cleared claim is unverified.** The gate's migration error names `inference.default_coder`, which is itself retired (`src/config/migrations.ts:93`).
- **portal-success-body-replaced**: answerable now. The portal checkout (`D:/Personal/Projects/Golem` @ `2917da9`, `app/api/webhooks/golem-build/route.ts:264`) sends `reason: 'unchanged'`. This repo's `docs/wiki/concepts/Release Pipeline.md:364` is the wrong side. The deployed build was not checked.
- **R12.13**: the "needs R12.12 first" blocker is resolved (R12.12 is done).
- Still-open, with the gate unmet: R14.4, R14.5, R13.9, R13.10, R8.29, vibe-authored-history, portal-team-skills-path-drift (one residue at `src/config/schema.ts:930`), R12.14, R13.15, R1.6, R2.6, R5.5-scoring, R6.1-live, test-defender-exclusions.

**Done docs whose gate the code no longer meets** (52 checked):
1. **npm-token-set-but-broken**: `golem-run` is E404, and the v0.54.3 Release run `35854466422` is red (portal notify failed). The OIDC commit `d315b23` is not an ancestor of `v0.54.3`, yet the doc says "RESOLVED … (v0.54.3)".
2. **R8.33**: "`golem slider 0` still works". The slider was retired (R11.1 / ADR-0004), with no note in the doc.
3. **R13.12**: keyed on `inference.default_coder`, which is retired and raises (`src/config/migrations.ts:92-96`).
4. **R9.4**: `inference.worker_targets` is retired and raises (`migrations.ts:98-103`).
5. **R10.8**, 6. **R13.11**: keyed on `worker_targets` and on `default_target` (→ `inference.model`, `migrations.ts:53-55`).
7. **portal-release-webhook**: the webhook is paused (`PORTAL_WEBHOOK_URL` cleared in `d315b23`), and the v0.54.3 notify failed.
8. **main-branch-enforcement**: `enforce_admins: false` (admin bypass). The doc names `cloudcatalyst/golem`; the repo is `PliableSoftware/golem`.
9. **R11.4 / docs-slider-drift-remainder**: `src/config/control-surface-types.ts:205-210` `coerceLevel` still throws `invalid slider level … key: "slider.level"`. Its message says 0–3 while the check allows 0–5. It has no caller, so it is dead code.
10. **skill-provenance-on-clone**: the gate names the nested `.claude/skills/golem/<cmd>/`. The code is flat (`tests/integration/skill-provenance-clone.test.ts:5,92`). (skills-project-scope-reachability notes the same change; this doc does not.)

**ROADMAP.md vs task states:**
- **Silently dropped:** R8.23, R8.25, R8.26 (done) and **R8.29 (queued, an open bug)** use `size: XS`. `PLAN_TASK_SIZES = ["S","M","L"]` (`src/tasks/types.ts:50`), and `PlanTaskStore.list()` skips docs that fail to parse (`src/tasks/plan-task.ts:176`), so they never reach the index.
- Header count (`ROADMAP.md:89`) "137 done" vs 135 done + 5 cancelled in the docs.
- `ROADMAP.md:48-51` "Where we are (validated 2026-07-30)" still says CI is billing-blocked (cleared 2026-09-04). It also describes verification-notes as "§1–§100" (it runs past §164).
- **Task-ID reuse:** `SHIPPED.md:150,153,154` record different shipped work under R14.2/R14.3/R14.4 (2026-09-02). The current queued R14.2–R14.4 docs are Buzz tasks (2026-09-19). R14.1 has no task doc. `src/config/migrations.ts:102` and `src/config/schema.ts:72` cite the old IDs. Commit `1e84c45` "(R14.5)" is unrelated to the R14.5 doc.

## Stale comments

In owned (unowned-code) files:
- `src/cli/commands/proxy.ts:4-6` says "all other proxy subcommands are removed"; six are registered (:451-651).
- `proxy.ts:118-121`: SessionStart uses its own copy (`prompt-guidance.ts:355-383`), not `ensureProxyRunning`.
- `proxy.ts:214`: "`golem proxy run`" does not exist.
- `prompt-guidance.ts:355-356` ("restart it") is superseded by :368-376 (no restart when `stopped`).
- `init-uninit.ts:80-85` says the restart "is not optional"; the printed notice (:96-99) says it "takes effect right away".
- `target.ts:154` says "nothing routes on it yet"; routing has landed (`mcp-serve.ts:108-137`).
- `select-target.ts:23-26` claims one port resolver; `proxy.ts:72` has another.
- `ps.ts:5` cites a test that does not exist. `ps.ts:17` "never infer death from age" vs age-based pruning at :714-717. `ps.ts:334-343` calls a scan dead that `collectProxies` still uses (:290-304).
- `team.ts:4-7` "three subcommands and no more": there are six, and the file does binding and layer fetch. `team.ts:75-82`: the `BindOutcome` doc comment sits on `LinkOptions`. `team.ts:447` hardcodes "(OS keychain)" despite the file fallback.
- `pkg-models.ts:6` calls `golem plugin` "future" (it shipped, R8.11).
- `session.ts:1-7` describes only tree and forget.
- `gateway.ts:229` typo `KEPT'—`.

**For DUST1.1** (pipeline/proxy): `src/pipeline/pipeline.ts:20` says "slider ≥2" and `:209` says "slider ≥3" for the same stage (code: ≥2); `:287` says `slider.level`. `src/cli/proxy-daemon.ts:456` is the injection-marker half of the SessionStart credential bug.
**For DUST1.3** (compression): `src/compression/headroom-adapter.ts:8` "slider ≥3". `src/knowledge/driver.ts:137` "swap for LanceDB" contradicts `file-driver.ts:4-15`, which made the JSONL driver the default (also DUST1.4). `semanticCache` has no consumer (row 25).
**For DUST1.8** (config): `src/config/control-surface-types.ts:205-210` dead `coerceLevel`. `src/config/schema.ts:930` nested `golem-team/` path. `src/config/control-surface-runtime.ts:184` has the same `startDetached(…{}…)` pattern. `docs/wiki/concepts/Configuration Surfaces.md:52` says `proxy.active_account`. `src/update/index.ts:22` / `install/*` use `golem-run`.
**For DUST1.9** (status/UI): `src/cli/statusline.ts:7,236` "slider". `vscode-extension/package.json:50` `golem.setAccount`. `docs/golem-spec.md:244` `golem replay-eval`.
**For DUST1.10** (Buzz): `Buzz Integration.md:284,380,470` name `golem buzz …` commands that do not exist.

## Contradictions for the human (never auto-resolved)

1. **Package name.** `package.json:2` is `@pliable/golem` (changed inside `2fc7cd2`, a `fix:` commit about gateway model shapes). README, CLAUDE.md, both installers, `src/update/index.ts:22` and the R7.5 gate all say `golem-run`, which is E404 on npm. Either the rename or the docs and installers are wrong. As shipped, `golem update` and the installer's npm rung point at a missing package.
2. **Decision 36's hold vs R6 shipping** a week later with no recorded lift. Should a Decision record the lift, or was the hold simply overtaken?
3. **Spec §1 identity (`:14`) vs Decision 32.** The spec's own vision paragraph keeps the framing Decision 32 retired elsewhere.
4. **"One process" (spec §2.1, Architecture, README) vs two processes in code.** Is "one engine" meant logically (shared stores) or literally?
5. **Non-goal "cloud-hosted deployment" vs the paid hosted team tier (Decision 64).** Does the non-goal still stand as written?
6. **R-ID collisions.** R5.1 means the durable queue in Decision 20a but provider adapters in Decision 32. R14.2–R14.5 are reused between SHIPPED rows and the current Buzz docs. That makes cross-references ambiguous.
7. **Local answer default.** Code, and the distributed rule, say it is ON by default. Architecture and README say "opt-in".

## Unverifiable here

- Whether the SessionStart credential bug manifests at runtime. Read only; `buildSpawnEnv(process.env, …)` would pass through any credentials already in the hook's env.
- Deployed portal vs the portal checkout; live npm and GitHub state beyond the plan agent's `npm view` / `gh` reads.
- "Git-aware context tools" (spec `:278`), and whether 20f notes are surfaced into later conversations.
- README's 170ms / 126ms timings.
- Behaviour-level gates that need a phone or live session (R12.13, R12.14, R13.15, R9.17, R9.19).
- Level-3 `toolResultCache` gating (DUST1.3).
