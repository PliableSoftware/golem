# DUST1.6 — inference, personas and local models: audit findings

Read-only audit, 2026-09-25, branch `dust/DUST1.6` at `fd3aedc`. Evidence is `path:line` at that
commit. Docs, debriefs and task docs are treated as claims, not evidence.

**Verification run:** targeted vitest over `tests/unit/inference/` (14 files),
`tests/unit/cli/{personas,persona-sync,persona-watcher,local-model}.test.ts`,
`tests/unit/config-personas.test.ts`, `tests/integration/cli-init-persona-{agents,preference-rule}.test.ts`,
`tests/integration/cli-ollama.test.ts` came back **22 files, 292 tests passed, exit 0**. I also ran three
probes against the built `dist/` (built 2026-09-23; `git log` shows no owned source file changed since then).
Every probe was a pure function call or a dry-run, so nothing was written:

- P1: `syncPersonaArtifacts(<worktree>, dryRun=true)` → all 4 `.claude/agents/golem-*.md` and
  `.claude/rules/golem-prefer-persona-agents.md` report `skip / up to date`
- P2: `selectTarget({personas:{coder:{model:"claude-sonnet-5",owner:"user"}}}, {worker:"coder"})` →
  `{"id":"claude-sonnet-5","route":"worker"}`. `resolvePersonaLane` gives `unstaffed/owner-user` for the same input
- P3: `loadConfig` on a project with `{"inference":{"worker_targets":{"coder":"x"}}}` → **accepted**:
  `worker_targets={"coder":"x"}`, `warnings=[]`, no raise

## Summary counts

| class | n |
|---|---|
| shipped-and-matches | 24 |
| shipped-but-drifted | 15 |
| partial | 5 |
| not-started | 4 |
| dead-or-superseded | 5 |
| **total classified** | **53** |

## Findings table

Class key: **M** shipped-and-matches · **D** shipped-but-drifted · **P** partial · **N** not-started · **X** dead-or-superseded

### Wiki — `concepts/Persona Registry.md`

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| W1 | Personas are a record leaf `inference.personas`. A persona holds no credential or `base_url` | PR.md:12,34,81 | `src/config/schema.ts:70-86` (fields: discipline, description, model, prompt, prompt_file, tools, owner), `:339` | `tests/unit/config-personas.test.ts` | M | — | — |
| W2 | Leaf under `inference`, not a top-level section | PR.md:36-40 | `src/config/schema.ts:315-339` | config-personas.test.ts | M | — | — |
| W3 | Merges per id, then per field. Only this leaf merges that way | PR.md:44-51 | `src/config/loader.ts:372` (`MERGE_PER_KEY_LEAVES` = {`inference.personas`}), `:402-435`, `:635` | config-personas.test.ts | M | — | — |
| W4 | `tools` replaces rather than merges | PR.md:53 | `src/config/loader.ts:419`: shallow `{...prior,...value}`, so an array replaces | config-personas.test.ts | M | — | — |
| W5 | Provenance is recorded per `inference.personas.<id>.<field>` and shown by `golem personas` | PR.md:55 | `src/config/loader.ts:420-426`; `src/cli/personas.ts:78-81,149-152` | `tests/unit/cli/personas.test.ts` | M | — | — |
| W6 | No per-layer defaults. Defaults are applied on read (`owner` → agent) | PR.md:57-63 | `src/config/schema.ts:70-86` (all `.optional()`, no `.default`); `src/inference/personas.ts:126-139` | `tests/unit/inference/personas.test.ts` | M | — | — |
| W7 | staffed / dispatchable semantics. `personaModel` returns undefined for undeclared, unstaffed or owner:user | PR.md:65-77 | `src/inference/personas.ts:136-137,172-180` | personas.test.ts | M | Holds for `personaModel`. The worker lane does not honour it: see W8 | — |
| W8 | "A `user`-owned persona is a role only a human fills; **nothing may dispatch it**" | PR.md:75 | `src/inference/personas.ts:183-197` (`workerTargetFromPersona`: "no owner check — worker lane ignores the permission axis"); `src/inference/workers.ts:95-96`; `src/inference/target-dispatcher.ts:724-729`; `src/inference/coder-route.ts:105-110` | **none**. No target-dispatcher/workers test uses `owner:"user"`; P2 shows the bypass | D | The code contradicts the doc. `persona-lane.ts:111` and `personaModel` refuse owner:user, but `selectTarget` and `resolveCoderRoute` return the persona's model as the dispatch target anyway. If `model` names a registry target, the `coder` MCP tool would dispatch a human-owned role; this is from reading the code, not executed. The doc looks right: permission axis. | none |
| W9 | Persona id is path-safe (`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`) | PR.md:82 | `src/config/schema.ts:50-55` | config-personas.test.ts | M | — | — |
| W10 | Each layer is `.strict()` | PR.md:83 | `src/config/schema.ts:86` | config-personas.test.ts | M | — | — |
| W11 | Starter bench: 4 personas, all unstaffed by default | PR.md:87-94 | `src/config/schema.ts:1083-1112` (planner/coder/reviewer/scribe, no `model`) | config-personas.test.ts | M | — | — |
| W12 | No `manager` persona | PR.md:96 | `src/config/schema.ts:1089-1091` | — | M | — | — |
| W13 | "This repo's own `.golem/settings.local.json` (personal, gitignored) staffs … `claude-opus-5` for `planner` and `reviewer`" | PR.md:98 | Staffing actually lives in **committed** `.golem/settings.json:3-8` (`git ls-files` lists it; `.gitignore:31` un-ignores it) with `claude-opus-5-5` for planner/reviewer. `settings.local.json` in the main checkout has no `personas` key | P1 | D | The file and the model id are both wrong in the doc. Commit `fd3aedc` ("persona model bump") moved the models; the doc was not updated | none |
| W14 | `DEFAULT_PERSONA_PROMPTS` has built-ins for all four. Precedence: prompt > prompt_file > `.golem/personas/<id>.md` > built-in | PR.md:98-100 | `src/inference/personas.ts:75-105,226-256` | personas.test.ts | M | There is also a 5th tier, `GENERIC_PERSONA_PROMPT` (`:108-112`), that the doc does not mention | — |
| W15 | `golem personas eject <id>` writes `.golem/personas/<id>.md` and never overwrites | PR.md:100-110 | `src/cli/personas.ts:231-259` | personas.test.ts | M | — | — |
| W16 | Ejected files are tracked by git by default | PR.md:102-114 | This repo: `.gitignore:27,33` (`!.golem/personas`). `.golem/personas/scribe.md` is tracked | — | M | True for this repo. Whether `golem init` writes the same allowlist into other projects is outside this partition (Unverifiable) | — |
| W17 | A team-wide prompt comes through the `team` origin, merges per field, and the project layer outranks team | PR.md:116-125 | `src/config/loader.ts:635` (merge is origin-agnostic) | — | P | The merge mechanism exists. Where `team` sits in the order and how portal delivery works belong to another partition's loader/team audit. No persona-specific test | none |
| W18 | `inference.default_coder` is retired and **raises** | PR.md:127-139 | `src/config/migrations.ts:91-97`; `src/config/loader.ts:575-585` (only reached when `leaf === undefined`, and `default_coder` is not a leaf) | — (this partition ran no loader test) | M | The message text matches `migrations.ts:112-118` | — |
| W19 | "What is not here yet": staffing lane — R14.2; agent definitions — R14.3; `discipline` on a task — R14.4 | PR.md:141-145 | Lane: `src/inference/persona-lane.ts:88-142`. Definitions: `src/cli/init-personas.ts:198-210`, `src/cli/agents.ts:70-132`. Discipline matching: `src/inference/personas.ts:155-161` | persona-lane.test.ts, cli-init-persona-agents.test.ts | D | All three have shipped, so the section is stale. The ids also **collide**: open tasks `R14.2`/`R14.3`/`R14.4` in `docs/plan/tasks/` are now Buzz work (agent identities, `golem acp`, orchestrator). See Contradictions C3 | — |
| W20 | Sibling rule `golem-prefer-persona-agents.md` lists each dispatchable persona with model + discipline | PR.md:147-151 | `src/cli/persona-preference-rule.ts:55-61,77-122,221-228`; `src/cli/persona-sync.ts:141-156` | cli-init-persona-preference-rule.test.ts; P1 | M | "Dispatchable" in practice means **agent lane** only. A worker-lane persona that is dispatchable is left out (`persona-sync.ts:92`). The doc says "currently dispatchable" | — |

### Wiki — `concepts/Hosted-multi-turn-claude-CLI-spike.md`

The page records R13.1's measurements. Its implementation (`src/session/host.ts`) is not in this partition, so I only checked that the page and that consumer agree.

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| S1 | `-p --input-format stream-json --output-format stream-json`, one `session_id` across turns | Spike.md:18 | `src/session/host.ts:6-8,43-46,288-289` | (not owned) | D | host.ts:35 says `--verbose` is **required** with stream-json output. The spike row leaves it out, so a reader reproducing the spike from the page would fail | none |
| S2 | SIGINT does not interrupt on Windows; process-kill only | Spike.md:20 | `src/session/host.ts:312-318` (`kill()`, with the §142 note) | (not owned) | M | — | — |
| S3 | Verdict: the `claude` CLI qualifies as the ADR-0007 §3a runner | Spike.md:27-29 | `src/session/host.ts` exists and uses it | (not owned) | M | Other items (hooks by cwd, headless `ask` refusal, cost) are observations with nothing to check in owned code: Unverifiable | — |

### Spec §1 — Target hardware profiles (`docs/golem-spec.md:60-69`)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| H1 | Four profiles P-cpu/P-min/P-mid/P-max, detected by probe | spec:62-67 | `src/interfaces/inference.ts` (HardwareTier); `src/inference/capability.ts:138-149` | `tests/unit/inference/capability.test.ts` | M | — | — |
| H2 | Profile boundaries: P-min 8 GB (3060/4060), P-mid 12–16 GB, P-max 24 GB | spec:65-67 | `src/inference/capability.ts:53-58`: `<8192`→PMin, `8192..16384`→PMid, `>16384`→PMax. The header at `:10-15` says "P_MID ~8–16 GB, P_MAX > ~16 GB" | capability.test.ts pins the code's thresholds | D | An 8 GB card reporting exactly 8192 MiB lands in **P-mid**; the spec says P-min. 4060 cards report ~8188 MiB and land in P-min, so the result depends on firmware rounding. A 20 GB card lands in P-max; the spec requires 24 GB. The spec's P-min floor (Tier 1 "≥6GB") has no floor in code: any GPU with >0 MiB is P-min. Apple Silicon is scaled by 0.7 (`:123`), so a 24 GB Mac becomes ~16.8 GB usable → P-max, while the spec puts 24–36 GB Apple in P-mid. Which side is right is for the human to decide | none |
| H3 | Graceful degradation: a missing capability downgrades and never breaks | spec:69 | `capability.ts:138-149` (any error → CPU); `probe.ts` never rejects; `service.ts:105-144` | capability.test.ts, probe.test.ts, service.test.ts | M | — | — |
| H4 | Meaningful savings (`compression.level` off–2) need no GPU | spec:69 | Not in inference code (compression partition) | — | — | Unverifiable here | — |

### Spec §2.2 — Device registry & job scheduler (`docs/golem-spec.md:146-155`)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| R1 | Workers run a lightweight agent reporting GPU, VRAM, load, installed models, disk | spec:147 | Local-only: `capability.ts` (GPU name + memory), `availability.ts:100-132` (installed models). There is no agent process, no load or disk reporting, no remote worker | availability.test.ts | P | Only the single-machine half exists | none |
| R2 | The hub keeps a capability table and routes jobs by task → minimum tier (Tier 0–3 lists) | spec:148-152 | There is no task→tier table. `catalog.ts:28-95` maps role→model *per tier*, which is a different thing | catalog-embed-widths.test.ts | N | No hub and no job scheduler. Nothing in `src/inference/` routes by a minimum tier | none |
| R3 | Tier thresholds: Tier1 ≥6 GB, Tier2 ≥12 GB, Tier3 ≥24 GB | spec:150-152 | `capability.ts:53-58` (8192 / 16384) | capability.test.ts | D | Inconsistent with the code, and §1 and §2.2 already disagree with each other (see H2) | none |
| R4 | Fallback: drop **one** tier *with a quality note*, or Haiku via API if allowed, or skip the stage | spec:153 | `service.ts:105-139`: the loop steps down **every** tier to P_CPU, and the returned `ChatResult` carries no quality note (only `model`) | service.test.ts | D | It steps down all the way, not one tier, and adds no note. Haiku: see X1 | none |
| R5 | Single-machine is the default and primary deployment | spec:154 | `schema.ts:1080` (`ollama_base_url: http://localhost:11434`) | — | M | — | — |
| R6 | Every backing service is URL-addressable (the inference half) | spec:155 | `schema.ts` `inference.ollama_base_url`; `ollama-client.ts:132-136`; `cli/ollama.ts:65,158,210` | ollama-client.test.ts | M | Qdrant and blob store belong to other partitions | — |
| R7 | mTLS + token auth on LAN-exposed services; P4 fleet discovery/health/scheduling | spec:155 | None in inference: `ollama-client.ts` is a plain undici `Pool` with no auth or TLS options | — | N | — | none |

### Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| L1 | Summarizer role (compaction, digests) | spec:178 | `src/knowledge/distill.ts:309,332,357` call `chat("summarizer")` | distill.test.ts | M | Used for distill digests. Conversation compaction uses `drafter` (`src/prompt/compact.ts:123`) | — |
| L2 | Classifier/Router ("does this need Claude?" triage, intent tagging) | spec:179 | `grep '"classifier"'`: only `src/cli/commands/bench.ts:137,164,229,280,320` and `prompt-guidance.ts:182` (role pickers). No production caller | — | N | The role exists in the catalog (`catalog.ts:32,44,…`) but nothing uses it for triage. Decision 33's local answer is extractive KB retrieval, not a classifier | none |
| L3 | Extractor (structured JSON from logs/HTML/PDF) | spec:180 | Same grep for `"extractor"`: only bench/prompt-guidance. `jsonSchema` plumbing exists (`service.ts:117`, `ollama-client.ts:183-185`) | — | N | The plumbing exists but there is no feature using it | none |
| L4 | Draft/Critic via the `coder` MCP tool only, never auto-triggered | spec:181 | `src/mcp/coder-refine.ts:165-207` (judge critique + drafter revise). `target-dispatcher.ts` is the dispatch path | target-dispatcher.test.ts | M | — | — |
| L5 | Reranker: cross-encoder rerank of RAG hits | spec:182 | `src/knowledge/rerank.ts:79` reranks by `chat("judge")`, an LLM listwise judge. There is no cross-encoder model in `catalog.ts` and no `reranker` Role (`src/interfaces/inference.ts:11`) | (not owned) | D | Reranking ships with a different mechanism from the one the spec names | none |
| L6 | Runtime: Ollama-first, OpenAI-compatible, any compatible server is a drop-in via config | spec:184 | `ollama-client.ts:2-5,175-201` (`/v1/chat/completions`, `/v1/embeddings`); `providers.ts:27-104` (R8.15 provider table: openai-*, ollama, anthropic) | ollama-client.test.ts | M | — | — |
| L7 | Bundled llama.cpp as a v2 fallback; vLLM opt-in | spec:184 | None | — | N | Documented as future (v2). Counted here, not in the summary as a gap | none |
| L8 | Model catalog auto-selected per node: ~3–4B P-min, 7–8B P-mid, 14B P-max, Q4–Q5 | spec:184 | `catalog.ts:40-88`: P-min 3b, P-mid 7b, P-max 14b; judge one size up (7b/14b/**32b**) | catalog-embed-widths.test.ts | M | The judge at P-max is 32b, above the spec's "14B-class" ceiling | — |

### Decisions

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| D5 | Ollama-first behind an OpenAI-compatible interface | spec:311 | as L6 | ollama-client.test.ts | M | — | — |
| D6 | Models per tier (advisory): ~4B/8B/14B instruct, bge-m3-class embed, **bge-reranker-v2-class cross-encoder** | spec:312 | `catalog.ts:26-88` (qwen2.5 3b/7b/14b; bge-m3 at P-min and above; nomic-embed-text at P-cpu). No reranker model | catalog-embed-widths.test.ts | P | Chat and embed tiers match (advisory sizing). The reranker half is missing (see L5) | none |
| D7 | Level-5 local-only answers are a per-project opt-in, never a global default | spec:313 | Slider retired (ADR-0004; `schema.ts:93-98`). Auto intercept removed (Decision 31, spec:392). Its replacement, `knowledge.local_answer_enabled`, is **on by default** (`.claude/rules/golem-local-answer.md`) | — | X | Superseded. The replacement drops the "never global default" property; see C4 | — |
| D12 | LAN lab offload: every backing service URL-addressable from P0 (inference half) | spec:318 | as R6 | ollama-client.test.ts | M | Qdrant, blob store and S3 belong to other partitions | — |
| D25a | `coder` (ex-`delegate`) is the explicit local-model path | spec:379,392 | `src/mcp/coder-tools.ts:426`; `target-dispatcher.ts:745+` | target-dispatcher.test.ts | M | — | — |
| D25b | Mode A draft / Mode B local_first proxy intercept, `ProxyRequest.localResponse`, live slider reload | spec:380-391 | Removed by Decision 31 (spec:392). `src/pipeline/local-intercept.ts` no longer exists (Decision 26's text still names it, spec:393) | — | X | The decision body still reads as the live design; only the Status line says it was removed | — |
| D26a | New modules `ollama-native.ts`, `install-runner.ts`, `ollama-bootstrap.ts`, reusing `chatModelFor(tier,"drafter")` | spec:394 | `src/inference/ollama-native.ts`, `install-runner.ts`, `ollama-bootstrap.ts:34,244` | ollama-native.test.ts, ollama-bootstrap.test.ts | M | — | — |
| D26b | Per-OS plans: winget arg array / brew / Linux script to tmpdir + `sh <file>`, temp file removed in `finally` | spec:395 | `ollama-bootstrap.ts:83-118,201-215` | ollama-bootstrap.test.ts | M | The script lands in a `mkdtemp` directory and the whole directory is removed. That is stricter than the spec, not drift | — |
| D26c | `golem ollama status` / `setup`; consent gate (`--yes`, TTY prompt, non-TTY refuses immediately, decline → `{kind:"cancelled"}`) | spec:396 | `src/cli/ollama.ts:56-85,149-186` (`SetupRefusedError` `:106,175`) | cli-ollama.test.ts | M | — | — |
| D26d | `golem ollama setup` is the only call site that installs or pulls; `golem init` and proxy never import `ollama-bootstrap.ts` | spec:396; `ollama-bootstrap.ts:4-6` | `grep installOllama\|pullDrafterModel` finds only `cli/ollama.ts`. **But** `src/cli/commands/init-uninit.ts:8` imports `../../inference/index.js`, which re-exports `ollama-bootstrap.js` (`index.ts:34-45`), so ESM loads the module during init | — | D | Nothing is invoked from init, so the only-call-site property holds. The literal "never import" claim is false through the barrel | none |
| D26e | "`drafter` is the only role any call site ever invokes", so one model covers all projects | spec:393; `ollama-bootstrap.ts:11-12` | **False now.** `summarizer` is called at `knowledge/distill.ts:309,332,357`, `judge` at `knowledge/rerank.ts:79` and `mcp/coder-refine.ts:165` | — | D | Consequence: `golem ollama setup` pulls only the drafter model (`ollama-bootstrap.ts:244`). Distill, rerank and `coder --refine` then hit `ModelNotAvailableError` → step down → `CapabilityUnavailableError` on a machine that setup reported as ready. `availability.ts:10-13` records this happening once already (the 2026-07-17 judge bug) | none |
| D26f | No settings-schema change; target model derived, not configured | spec:397 | `cli/ollama.ts:72,165` | cli-ollama.test.ts | M | Later R8.15 `inference.providers` can route `drafter` elsewhere, and `setup` ignores providers (it always pulls the catalog model). Minor, not drift in D26 itself | — |
| D26g | Status "ACCEPTED, implementing now" | spec:399 | Implementation complete (D26a–c) | — | D | The status line is stale: shipped | — |
| D26h | Real spawn/download and multi-GB pull are manual-verification checklist items only | spec:398 | `install-runner.ts:8-11` (no deep unit test, as stated) | — | P | The macOS/Linux manual checklist is still open | R1.6 |

### Also verify — generated agent definitions and preference rule (R13.12, R14.1)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| G1 | `.claude/agents/golem-<id>.md` matches what `inference.personas` produces | task brief | P1: all four `skip / up to date`. The sha256 of each file equals its `.golem/managed-files.json:2-5` entry | cli-init-persona-agents.test.ts | M | coder = sonnet-5, planner and reviewer = opus-5-5, scribe = haiku-4-5, matching `.golem/settings.json:3-8` | — |
| G2 | `golem-prefer-persona-agents.md` matches the roster | task brief | P1 `skip`; hash equals `managed-files.json:11` | cli-init-persona-preference-rule.test.ts | M | — | — |
| G3 | Generation is deterministic, the ledger decides deletion, edits are kept as conflicts | `init-personas.ts:4-30`; `agents.ts:62-69` | `init-personas.ts:76-179`; `agents.ts:70-132` | cli-init-persona-agents.test.ts (ledger/prune cases) | M | — | — |
| G4 | Coder definition uses `inference.coder_prompt` when set (same prompt as the MCP tool) | `persona-sync.ts:94-104` | `persona-sync.ts:98-104`; `coder-prompt.ts` | persona-sync.test.ts | M | — | — |
| G5 | Live resync on settings edit (polling watcher) plus a session-start sync | `persona-watcher.ts:1-40` | `src/cli/commands/proxy.ts:378`; `src/cli/version-sync.ts:113`; `src/cli/init.ts:446` | persona-watcher.test.ts, `tests/e2e/persona-watcher-smoke.test.ts` | M | — | — |

### Owned-code claims not in the owned docs, where the comment contradicts the code

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| C-a | `inference.worker_targets` is "retired" in R14.3 and raises | `src/config/migrations.ts:98-103` (RETIRED_SETTINGS); `workers.ts:22-28`; `ui-model.ts:312` | Still a **live schema leaf**: `schema.ts:293-303`, default `{}` `:1082`. The retirement check only runs when `leaf === undefined` (`loader.ts:575-585`), so it **never fires**. The map still **wins** routing: `workers.ts:90-93`, `persona-lane.ts:102-105`, `coder-route.ts:99-102`, `target-dispatcher.ts:724-729` | P3 (accepted, zero warnings). `tests/unit/inference/workers.test.ts:13` asserts the "retired" story | D | Three answers to one question: raise (migrations), deprecated leaf with a warning (`migrations.ts:156-161` comment), and highest-precedence route (code). The code shows the third. See C1 | none |
| C-b | `persona-lane.ts` is "the ONE implementation"; `coder-route.ts` "now delegates to it" | `persona-lane.ts:37-39` | `coder-route.ts:97-145` is a separate, divergent chain with its own copy of `looksLikeModelId` (`:89-91` vs `persona-lane.ts:83-85`). It has no undeclared-worker guard and no owner check on the `persona_worker` branch | coder-route.test.ts, persona-lane.test.ts (separate suites) | D | This is exactly the duplicate the comment says was removed | none |
| C-c | Dispatch route label | `target-dispatcher.ts:214-217,229-230` | `selectTarget` returns `route:"worker"` for a value that came from `personas[worker].model` (`workers.ts:96` → `target-dispatcher.ts:729`). `describeRoute("worker")` then reports `inference.worker_targets.<w>` | P2 | D | Audit and user-facing notes name a setting the user never set | none |

## Undocumented

Exported behaviour in owned files that no owned doc mentions:

- `src/inference/providers.ts:27-142`: the R8.15 `inference.providers` table (`resolveChatModel`, `probeInferenceEndpoint`), first-match-wins provider routing per role. Not in spec §3.3 or the Decisions, beyond "drop-in via config"
- `src/inference/availability.ts`: pulled / not-pulled / unknown per tier slot, `availabilityWarning`, `roleWarning`
- `src/inference/claude-cli.ts`: R9.15 drafting through a headless `claude --print` spawn, with env scrub and stdin-only prompt (`:103-115`)
- `src/inference/service.ts:63-77,147-153`: R10.4 embed-model pinning (`embedModels`) that overrides the tier
- `src/inference/catalog.ts:113-140`: `embedDimFor` / `EMBED_DIMS` vector-width table
- `src/inference/ollama-client.ts:84,93`: `MAX_EMBED_INPUT_CHARS=6000`, `EMBED_BATCH_SIZE=64`, and `InferenceTimeoutError` (`:42-51`)
- `src/inference/reply-parsing.ts`: `stripFence`, `readReplyField`, `recoverKnownValue`
- `src/inference/coder-prompt.ts`: one coder prompt shared by the MCP tool and the generated subagent (R13.12)
- `src/inference/target-dispatcher.ts`: the whole R9.3/R10.8/R13.11 dispatch chain, the redaction floor for non-local targets, `agent_selectable`, and `NoDrafterConfiguredError`. The Persona Registry page does not describe the worker lane at all
- `src/cli/local-model.ts`: local-model reachability cache (`.golem/state/local-model.json`, 60 s TTL) for statusline/status
- `src/cli/persona-watcher.ts`: the proxy-hosted polling watcher (G5). Persona Registry never mentions the live resync
- `src/inference/personas.ts:108-112`: `GENERIC_PERSONA_PROMPT` fallback tier

## Dead candidates

- **`HaikuFallbackRequired` / `FallbackPolicy.allowHaiku`** (`service.ts:37-59,141-143`): `grep new OllamaInferenceService(` shows every construction site passes no `fallback` (`cli/build-knowledge.ts:99,121`, `cli/commands/tasks.ts:65`, `cli/commands/mcp-serve.ts:198`, …), so `allowHaiku` is always false. `grep HaikuFallbackRequired` finds no catch site outside `service.ts` and `index.ts:74`. This implements spec §2.2:153 "Claude Haiku via API if the user allows", with no config key and no caller. **X** (X1)
- **`selectTarget`'s `persona_worker` branch** (`target-dispatcher.ts:731-736`): unreachable. `workerTarget()` (`workers.ts:84-97`) already returns `workerTargetFromPersona(...)` whenever the persona is known. When `personas` is defined and the worker is undeclared, both return undefined; when `personas` is undefined, `workerTargetFromPersona({}, …)` is undefined. So `route:"persona_worker"` can never come out of `selectTarget`. The `describeRoute` `"persona_worker"` case (`:231`) is reachable only by construction. **X**
- **`coderRouteConflict` second branch** (`coder-route.ts:171-180`): its only caller (`mcp-serve.ts:214-219`) sets `defaultCoder = personaModel(personas,"coder")`, which is the same string `workerTargetFromPersona(personas,"coder")` returns, or undefined. `fromPersonaWorker !== configured` therefore never holds while both are defined. The message also compares a key against itself ("`personas.coder.model` … and `personas.coder.model`"). **X**
- **`RETIRED_SETTINGS` entry for `inference.worker_targets`** (`migrations.ts:98-103`): unreachable while the leaf exists (C-a). **X**
- **`DesiredAgent.discipline`**: set in `persona-sync.ts:111`, read only by `persona-preference-rule.ts:57`. `personaAgentDefinition` (`agents.ts:49-60`) ignores it. It is used, so not dead; listed for completeness only
- `unknownWorkerWarnings` (`workers.ts:108-125`), called at `status-collect.ts:440`: live, but it only ever sees `worker_targets` keys. Live while C-a stands

## Stale comments (Phase 3 input)

1. `src/inference/persona-lane.ts:37-39`: "`coder-route.ts` now delegates to it rather than keeping a second copy". It does not (C-b)
2. `src/inference/workers.ts:22-28`: "The `inference.worker_targets` map is retired". It is live and outranks personas (C-a). `:76` then says "The deprecated `workerTargets` map is checked first for backward compat", which contradicts the header in the same file
3. `src/config/migrations.ts:156-159`: "kept as a deprecated leaf with a warning". No warning is emitted (P3)
4. `src/inference/ollama-bootstrap.ts:4-5,11-12`: "`golem init` … never import this file" (it does, via the barrel) and "`drafter` is the only role any call site … ever invokes" (false; D26d/e)
5. `src/cli/local-model.ts:4-5`: "level 3 auto-drafts / can answer locally". Auto-drafting was removed by Decision 31, and local answers are now Decision 33's extractive KB path, not level 3
6. `src/inference/capability.ts:10-15`: tier comment ("P_MID ~8–16 GB") disagrees with spec §1/§2.2 (H2/R3). It is consistent with the code
7. `src/inference/coder-route.ts:1-14,40-48,63`: framed around `inference.default_coder`, which was retired in R14.1. `CoderRouteError` messages already say `personas.coder.model`
8. `src/cli/agents.ts:1-6`: "what the generated `golem-coder` subagent definition SAYS … Split from `init-agents.ts`". `init-agents.ts` no longer exists, and the module now renders every persona
9. `src/cli/init-personas.ts:24-26`: "`.claude/agents/golem-scribe.md` was hand-authored … with no managed record" as a live fixture. It now **has** a ledger record (`managed-files.json:5`) and is generated (P1 `skip`), so the fixture no longer exists
10. `src/inference/target-dispatcher.ts:22-27`: the four-step chain lists step 2 as `worker_targets[worker]` only. `personas[worker].model` also feeds step 2 now
11. `src/inference/personas.ts:17-23`: "Which lane … is R14.2 … Guessing the lane before the resolution chain exists …". The chain exists (`persona-lane.ts`)
12. `src/mcp/coder-tools.ts:156,173,492` (not owned, context): tool description still tells the model routing goes through `inference.worker_targets.coder`

## Contradictions for the human (not auto-resolved)

- **C1 — Is `inference.worker_targets` retired?** The docs and the retirement table say it is retired and raises. The schema keeps it as a live leaf, and every routing function gives it the **highest** precedence. Choose one: (a) remove the leaf so `RETIRED_SETTINGS` fires, which breaks any config still using it, or (b) un-retire it and fix the comments. Today it is silently honoured.
- **C2 — Does `owner: user` bind the worker lane?** The wiki (PR.md:75) says nothing may dispatch it. `persona-lane.ts:111` and `personaModel` agree. `workerTargetFromPersona` (`personas.ts:183-186`) says on purpose that the worker lane "ignores the permission axis", and `selectTarget` / `resolveCoderRoute` act on that. The code contradicts itself, and nothing tests the worker-lane case.
- **C3 — Task-id reuse.** The Persona Registry page cites R14.2/R14.3/R14.4 as persona work still to come. Code comments cite the same ids as shipped persona work (`persona-lane.ts:2`, `init-personas.ts:2`, `workers.ts:22`). The committed task docs `R14.2.md`/`R14.3.md`/`R14.4.md` are now open Buzz tasks. Any wikilink or `golem task show R14.3` resolves to different work.
- **C4 — Decision 7's "never global default"** was superseded twice: by ADR-0004 and Decision 31, then by Decision 33's `local_answer_enabled`, which defaults to **on**. Is the property meant to survive in the successor, or is Decision 7 simply dead?
- **C5 — Tier thresholds.** Spec §1 (8 / 12–16 / 24 GB), spec §2.2 (6 / 12 / 24 GB) and code (`<8 / 8–16 / >16` GiB) all differ. Tests pin the code.
- **C6 — `golem ollama setup` readiness.** It pulls only the drafter, but summarizer and judge are live roles. Should setup pull every role any call site uses, or should the spec narrow the "single live model" promise?

## Unverifiable here

- Real `winget` / `brew` / `install.sh` runs and a multi-GB `/api/pull`. By design these are manual-only (Decision 26); the macOS/Linux checklist is task R1.6
- Whether Claude Code picks up a rewritten `.claude/agents/*.md` mid-session. `persona-watcher.ts:10-14` itself marks this unverified
- Spike items for hook firing by cwd, headless `ask` refusal, cost per turn, and reboot survival: observations with no owned code to check
- Team-origin precedence for `inference.personas.<id>.prompt` (W17) and whether `golem init` writes the `.golem/personas` gitignore allowlist into other projects (W16): loader/init partitions
- Apple-Silicon detection path (`capability.ts:114-131`): covered by unit tests with canned probe output only; no macOS hardware here
