# Claims ledger and banned claims

**DRAFT. Not published. Not a source of truth.** See [`README.md`](README.md).
Phase 5 drafts (DUST5.3 to DUST5.5) may make only the claims in section 1, worded
no stronger than the row. Nothing in section 2 may appear in any draft.

- Checked against code on **2026-10-08** at commit **`a3f1d39`** (`git rev-parse --short HEAD` in the worktree, branch `dust5/review-fixes`). Every `path:line` below was opened and read at that commit, or sits in a file that `git diff 7c92d36 a3f1d39` shows unchanged since the first pass (rows still stamped `7c92d36`). Line anchors drift: re-read before a draft ships. Rows C-01, C-03, C-06, C-08, C-11 and C-13 were revised after the fact-check in [`REVIEW.md`](REVIEW.md).
- Package: `@pliable/golem` 0.54.3 in `package.json`. The newest tag is `v0.54.3` (2026-09-23). **No tag contains any DUSTSEC fix** (see B-29).
- Status values: `verified` (read in code, and a test or the code's own comment agrees), `estimated` (a number the product itself labels estimated), `dated` (true as of a date, not re-measured here).
- Specs are cited as `spec §n` (`docs/golem-spec.md` v1.33). A spec section alone never carries a row: each row has a code line.

## 1. Claims

### Redaction

| id | claim (as it may appear in copy) | source | checked | status |
|---|---|---|---|---|
| C-01 | Golem redacts the JSON body of `POST /v1/messages` requests before any other pipeline stage runs and before it is forwarded. Since DUSTSEC.19 (PR #265, code `109f32b`), a request to any other path whose body is a JSON object or array gets redaction only (same rules, same order, no other stage), and the error path does the same. Not redacted: a body that is absent, empty or not JSON; a JSON body sent with a content encoding such as gzip, or one that begins with a byte-order mark (it fails to parse and is forwarded as it arrived); a JSON value that is not an object on `POST /v1/messages` (an array or a bare scalar there is never redacted, because both `process` and `redactOnly` return early; the upstream rejects such a body), and a bare JSON scalar (a string or a number) on any other path. The redaction walk has no size cap on the body. DUSTSEC.20 (long-token rule rewrites some 33 and 34 character API ids) and DUSTSEC.21 (encoded and non-JSON bodies, no size bound) are open task docs. The fix is on `development` and in no tag (B-29). | spec §4; `src/pipeline/pipeline.ts:313-316` (messages path gate), `:329-341` (`redactJsonBody`, non-messages JSON), `:407-421` (`redactOnly`, same routes), `:429-433` (`process`: non-messages redaction, honouring the policy flag), `:525-527` (stage 1, redaction); `tests/integration/pipeline-redact-json-bodies.test.ts:79-155` | 2026-10-08 `a3f1d39` | verified |
| C-02 | Every compression level, including `off`, runs redaction. No dial value can turn it off: the level table has no row without it. | spec §4; `src/interfaces/policy.ts:138-190` (`redaction: true` in all four rows) | 2026-10-08 `7c92d36` | verified |
| C-03 | If the pipeline throws, the proxy re-runs redaction alone on the original request and forwards that. If redaction itself throws, it answers 502 and forwards nothing. | spec §4; `src/proxy/server.ts:323-352`; `src/pipeline/pipeline.ts:407-421` (`redactOnly`) | 2026-10-08 `a3f1d39` | verified |
| C-04 | Redaction can be switched off in exactly one way: the setting `proxy.bypass_all`. It defaults to `false`, takes effect when the proxy starts, and no request header or HTTP endpoint changes it. A bypassed proxy forwards the body untouched. | spec §4; `src/config/schema.ts:1113`; `src/proxy/server.ts:104-120,332`; `src/cli/proxy-runtime.ts:303-310`; `src/proxy/headers.ts:44-48,62` (the old header is only stripped) | 2026-10-08 `7c92d36` | verified |
| C-05 | When `proxy.bypass_all` is on, Golem says so: the status output carries a warning that redaction is off and secrets and PII reach the upstream unredacted. | `src/cli/status-collect.ts:552-556` (`REDACTION_OFF_WARNING`), `:434-437` (added to status when on) | 2026-10-08 `7c92d36` | verified |
| C-06 | A remote team layer cannot set `proxy.bypass_all`, nor the portal identity keys (`portal.url`, `portal.issuer`, `portal.client_id`) or the team binding keys. The loader drops them with a warning. | `src/config/loader.ts:108-153` (`REMOTE_DENIED_SETTINGS`), `src/portal/team-layer.ts:171-174` | 2026-10-08 `a3f1d39` | verified |
| C-07 | A Claude Code PreToolUse hook denies the documented ways an agent's Bash or file edit would set `proxy.bypass_all`. It is a guard on common spellings, not a sandbox: an agent with arbitrary shell access is not stopped by it. | `src/hooks/bypass-guard.ts:1-30` (what is and is not caught) | 2026-10-08 `7c92d36` | verified |
| C-08 | Oversized tool output is redacted before it is stored in the local CCR store or excerpted, so the stored original is the redacted text. | `src/hooks/post-tool-use.ts:269-278` | 2026-10-08 `a3f1d39` | verified |

### Compression

| id | claim | source | checked | status |
|---|---|---|---|---|
| C-09 | The default is `compression.level` `1` (lossless) and `brevity.level` `off`. | `src/config/schema.ts:1167,1175` | 2026-10-08 `7c92d36` | verified |
| C-10 | Level `off` runs redaction only. Level `1` adds lossless compression (dedup, compaction). Levels `2` and `3` add semantic compression of stale turns and are lossy. | spec §4; `src/interfaces/policy.ts:138-190` | 2026-10-08 `7c92d36` | verified |
| C-11 | At level 1 or below the pipeline is lossless and prefix-stable: whatever level 1 removes is retrievable byte for byte from the CCR store, and a later turn forwards the same bytes for the earlier history. Requests no stage changes are forwarded with their original bytes. Redaction and dedup do rewrite the body, so do not say byte-identical or byte-faithful. | spec §4; `src/pipeline/pipeline.ts:10-24`; `tests/contract/level1-fidelity.contract.test.ts:82-194` (19 tests, run passing 2026-10-08 `7c92d36`) | 2026-10-08 `a3f1d39` | verified |
| C-12 | Levels 2 and 3 are lossy. On an Anthropic prompt-caching upstream they run as level 1 (lossless), because rewriting history would break the cached prefix. They apply on non-caching upstreams and need the optional Headroom sidecar (`compression.headroom_sidecar`, off by default). An opt-in research flag (`compression.force_semantic_on_caching`, off by default) overrides the gate. | spec §4; `src/compression/effective-level.ts:45-50,88-114`; `src/config/schema.ts:1163-1164`; `src/interfaces/policy.ts:138-190` | 2026-10-08 `7c92d36` | verified |
| C-13 | **OVERSTATED as first written; do not use the old wording** ("about 0%, measured in July 2026" breaks B-26; "compression pays off on non-caching upstreams" runs into B-31, because the spec gates lossy compression on measured benefit). Replacement wording: token savings from compression are situational, not the headline (spec §1, Decisions 32 and 23), and Golem's own stats note calls them near zero on cached Anthropic traffic. State no percentage and no benefit on non-caching upstreams. | spec §1 (Decisions 32 and 23, the paragraph at spec line 12); `src/cli/stats.ts:125-128` | 2026-10-08 `a3f1d39` | overstated (old row); the replacement is verified |

### Local tools

| id | claim | source | checked | status |
|---|---|---|---|---|
| C-14 | When a tool result in Bash, Read, Grep, Glob or WebFetch exceeds 12,000 characters, a hook replaces it with a head/tail excerpt and a `hash=` reference. The (redacted) original is stored under `.golem/ccr` and Claude can retrieve it with the `expand` tool. | `src/hooks/post-tool-use.ts:83,265-325`; `src/hooks/settings-writer.ts:31`; `src/mcp/server.ts:91-135` | 2026-10-08 `7c92d36` | verified |
| C-15 | Local answers: for an eligible question the proxy can answer from the project knowledge base without calling the model. The answer is extractive (it quotes retrieved text, no generative model), carries the visible prefix "**Golem** Answered locally from the project knowledge base — verify independently." (quote it exactly, `LOCAL_ANSWER_LABEL`, `src/knowledge/local-answer.ts:20-21`), and is on by default (`knowledge.local_answer_enabled`). Drafts in `docs/marketing/` and the working docs in `docs/plan/` are never quoted. | `src/knowledge/local-answer.ts:1-7,20-21,34,57-62`; `src/config/schema.ts:1182`; `src/proxy/server.ts:354-357` | 2026-10-08 `7c92d36` | verified |
| C-16 | The knowledge base works with no setup: a pure-TypeScript lexical hashing embedder is the default, replaced by an Ollama embedding model when one is reachable. The vector store is a local file driver. A Qdrant server is not supported: setting `knowledge.vector_db_url` throws `NotImplementedYetError`. | `src/knowledge/index.ts:162-185` | 2026-10-08 `7c92d36` | verified |
| C-17 | Golem picks a local model tier from detected GPU or unified memory: under 8 GiB P-min, 8 to 16 GiB P-mid, over 16 GiB P-max, none detected P-cpu. | spec §1; `src/inference/capability.ts:53-58` | 2026-10-08 `7c92d36` | verified |
| C-18 | `golem ollama setup` asks for confirmation (or needs `--yes`, and refuses without a TTY) before it installs Ollama or pulls models. Nothing else in this ledger installs or pulls a model. Do not say which models; see B-33. | `src/cli/ollama.ts:152-192` | 2026-10-08 `7c92d36` | verified |

### MCP surface

| id | claim | source | checked | status |
|---|---|---|---|---|
| C-19 | The MCP server registers up to eleven tools: `code`, `coder`, `devices`, `snooze`, `search`, `fetch`, `ingest`, `expand`, `stats`, `wiki_read`, `wiki_upsert`. `search`, `fetch` and `ingest` register only with a knowledge base, `coder` only with a local-inference dependency, `code` only with a code root, the two wiki tools only with a wiki, and plugin tools may add more. It can run over stdio or streamable HTTP. | `src/mcp/server.ts:91,146,239-293`; `src/mcp/coder-tools.ts:165`; `src/mcp/code-tool.ts:67`; `src/mcp/devices-snooze.ts:48,135`; `src/mcp/search.ts:298,374,458`; `src/mcp/wiki-tools.ts:48,96`; `src/mcp/serve.ts:12-20,67` (stdio and streamable-HTTP transports) | 2026-10-08 `7c92d36` | verified |
| C-20 | The proxy accepts nine upstream providers: Anthropic, Azure Foundry, OpenRouter, OpenAI, Gemini, NVIDIA NIM, Ollama, llama.cpp and a custom endpoint. Anthropic is the default. | `src/providers/index.ts:101-147`; `src/config/schema.ts:1116` | 2026-10-08 `7c92d36` | verified |

### Team layer

| id | claim | source | checked | status |
|---|---|---|---|---|
| C-21 | A hosted team portal can supply a `team` settings layer. In the normal band it ranks above the user's own settings and below the project, local and environment layers; `!important` declarations resolve afterwards in reverse order. An invalid team value skips the whole team layer with a warning; the proxy still starts. | `src/config/loader.ts:77-105,325-360`; spec §5.1 (cascade) | 2026-10-08 `7c92d36` | verified. Say nothing about where team policy is enforced (B-01). |

### Hosted sessions and devices

| id | claim | source | checked | status |
|---|---|---|---|---|
| C-22 | `golem session host` can run an agent session that Golem supervises and that outlives the CLI call. Golem keeps a per-project record of hosted sessions (id, pid, start time) in `.golem/state/hosted-sessions.json`, checks liveness on every read, and offers `list`, `log`, `stop` and `forget`. | `src/session/host-registry.ts:1-50`; `src/cli/commands/session-host.ts:73-78,375-376,402-403,440-441,469-470` | 2026-10-08 `7c92d36` | verified. Nothing about remote or permission handling (B-04, B-07, B-37). |
| C-23 | A paired device talks to a separate HTTPS server that requires a client certificate for everything except the one enrolment-claim route, and runs a certificate check on every other request. | `src/security/write-server.ts:160-170,205-236` | 2026-10-08 `7c92d36` | verified. Not a claim about a LAN worker fleet (B-06). |

### Honest observability

| id | claim | source | checked | status |
|---|---|---|---|---|
| C-24 | Golem's token-savings figures are estimates (about four characters per token), and the request count counts rewritten requests only. `golem stats` labels them "est." and "rewritten requests". Any figure from it must be called an estimate. | `src/cli/stats.ts:125-128,206-209` | 2026-10-08 `7c92d36` | estimated |
| C-25 | `golem stats --cache` reports the prompt-cache hit rate from the token usage the API billed on each response, kept separate from Golem's own prediction of what broke the prefix. `golem bench cost` compares Golem's savings estimates with Claude Code's cost-doc baselines. The dashboard does not show cache hit rate or cost. | `src/telemetry/cache-report.ts:1-20`; `src/cli/commands/dials-stats.ts:115`; `src/cli/commands/bench.ts:78-85`; spec §5 | 2026-10-08 `7c92d36` | verified (billed usage is the cache report only; `bench cost` is estimates, B-26) |
| C-26 | The npm package is `@pliable/golem` and the CLI is `golem`. | `package.json:2`; `README.md:3` | 2026-10-08 `7c92d36` | verified |

Count: 26 rows.

## 2. BANNED

Each item is banned in every wording, with the reason. A draft that needs one of these needs the underlying question settled first, by the user, not by a draft.

### 2a. Open contradictions (spec §10): assert neither answer

| id | banned | reason |
|---|---|---|
| B-01 | That team policy is enforced everywhere, or where it is enforced. | G3, open. Only `golem status` loads the team layer; `golem config`, the panel, VS Code, hooks, MCP and the hot-reload do not. A security question, left for the user. |
| B-02 | That the `slider` MCP prompt is supported. | Removed 2026-10-09 (USER decision M2): it is no longer in `src/mcp/prompts.ts`, and calling it is an unknown-prompt error. The control is `golem compression`. |
| B-03 | Whether `blocked` is a task state or task metadata. | H2, open. Code and README say state; Decision 55(d) and the wiki say metadata. |
| B-04 | That Decision 61 covers hosted sessions. | P3, open. Whether it reaches hosted sessions given Decision 60(d) is undecided. |
| B-05 | That `security.*` settings cannot be changed remotely. | P4/S17, open. Whether they belong on `REMOTE_DENIED_SETTINGS` is undecided. Only the keys listed in C-06 are known denied. |
| B-06 | A LAN worker fleet, a hub capability table, hub-to-worker mTLS, GPU/VRAM/load reporting from workers, or task-to-tier routing across machines. | DUST2.25, open fleet question. Today a LAN machine is an Ollama URL. Device-pairing mTLS (C-23) is a different thing; do not merge them. |
| B-07 | Anything about how the permission-request deny behaves when a relay is connected. | DUSTSEC.10 / R8, open. No "relay connected" signal exists at the hook; R12.13 is unconfirmed. |

### 2b. UNVERIFIED in the spec (§11): not asserted

| id | banned | reason |
|---|---|---|
| B-08 | That `snooze` is instrumented (reports telemetry). | UNVERIFIED in §11, so banned. Note: this pass saw `instrumented(tel, "snooze", ...)` calls at `src/mcp/devices-snooze.ts:241,255`, which contradicts the spec's reasoning. The spec is not edited here; see section 3. |
| B-09 | LM Studio or vLLM as drop-in inference backends. | UNVERIFIED (§3.3, §6). Untested by URL. |
| B-10 | A tier-fallback ladder, or falling back to Haiku. | UNVERIFIED (§2.2). Only a `FallbackPolicy.allowHaiku` field is known. |
| B-11 | A Bun standalone binary. | UNVERIFIED (§6, Decision 41). Never confirmed run. |
| B-12 | That the Decision 56 shim bypasses local answer. | UNVERIFIED (Decision 56 note). |
| B-13 | Which call sites use a catalog model role (triage, extraction, judging, drafting). | UNVERIFIED (§3.3, Decision 26). Only `coder` (drafter) and rerank (judge) are known. |
| B-14 | The file names in Decision 51(d), and that the macOS CI leg is advisory. | UNVERIFIED (§11). |

### 2c. Not built (spec §12 and §5)

| id | banned | reason |
|---|---|---|
| B-15 | Per-device utilization on the dashboard. | Not built, no task. |
| B-16 | A canary mode or a quality-delta view. | Not built, no task. |
| B-17 | `golem replay-eval`, or any eval harness that scores quality per compression level. | Not built, no task. R2.6 is a cost A/B only. |
| B-18 | Cache hit rate or cost shown on the dashboard. | They live on `golem stats --cache` and `golem bench cost` (DUST2.18). |
| B-19 | An SDK; an exact or semantic response cache; Whisper or OCR media pre-processing; local test running with a failure digest; git-aware context; Batch-API queueing; a cross-encoder reranker; a shared cross-project knowledge collection; Qdrant server mode; tree-sitter chunking as a default. | Each is in the "Not started" register (§12) or an opt-in add-on. The `StageConfig.semanticCache` field has no reader. |
| B-37 | Remote steering, relay or self-hosted remote access, multi-device continuity, or "start a session from your phone" as working features. | §12 rows 1.10/r006, 1.11/r037, 1.11/r043: not started or partial (R13.8, R13.10, R12.13 to R12.15). |

### 2d. Retired or false wording

| id | banned | reason |
|---|---|---|
| B-20 | "Byte-faithful" (for compression levels or the proxy). | Retired by USER decision C1. Say "lossless and prefix-stable at level <= 1". Redaction and dedup rewrite bytes. (Only the raw `bypass_all` passthrough is untouched, and that is the redaction-off mode, not a selling point.) |
| B-21 | "Redaction can never be turned off." | False. `proxy.bypass_all` turns it off. Say: it is the only switch, never the default, persisted, applied at proxy start, set from the CLI, and surfaced loudly (C-04, C-05). |
| B-22 | The `x-golem-bypass` header or `POST /__golem/pipeline/false` as features. | Removed (DUSTSEC.2). The header is only stripped. |
| B-23 | The "slider" as a current control. | Retired by ADR-0004. The controls are `compression.level` and `brevity.level`. |
| B-24 | `golem-run` as the install name. | Canonical name is `@pliable/golem` (C-26). Claiming `golem-run` on npm is an open user task. |
| B-30 | "A plugin cannot weaken redaction", unqualified. | A plugin has process authority. The truthful form: the built-in rules are not weakened through the plugin API, and plugin rules are additive; a plugin that runs in-process can do anything the process can. Prefer not to make the claim. |
| B-32 | "Golem redacts all traffic" or "every request". | Since DUSTSEC.19 JSON object or array bodies on every path are redacted (C-01), but a body that is absent, not JSON, gzip-encoded or led by a byte-order mark passes through as it arrived, and the redaction walk has no size cap. DUSTSEC.20 and DUSTSEC.21 are open. Say what C-01 says, not "all traffic". |
| B-33 | "`golem ollama setup` pulls only the drafter model", or any specific model list. | Spec §1 (A10) says drafter only, but the code pulls every role model for the tier and can install Ollama first (`src/cli/ollama.ts:169,184-192`; `src/inference/ollama-bootstrap.ts:285-308`). Use C-18 as written. |
| B-34 | "Ten providers". | Ten names exist but `claude-cli` is a spawn target, not a proxy upstream (`src/providers/index.ts:128,145-147`). Nine proxy providers (C-20). |
| B-35 | That the bypass guard makes it impossible for an agent to disable redaction. | It is not a sandbox (C-07). |
| B-36 | That a local answer is correct, complete or authoritative. | It is extractive and confidence-gated, labelled "verify independently". It can quote the wrong page. Say "quoted from the project KB". |
| B-38 | "Real billed-token telemetry, not estimates" as a blanket statement (README line 10-11). | Only the cache report uses billed usage (C-25). Savings figures are estimates (C-24). The README wording needs a follow-up fix. |

### 2e. Overstatement

| id | banned | reason |
|---|---|---|
| B-25 | Compression token savings on Anthropic traffic. | Decision 23: about 0% on cached Anthropic traffic; levels 2 and 3 are off there (C-12, C-13). Any savings there come from the provider's prompt caching, not from Golem compression. |
| B-26 | A savings, cost or percentage figure stated as measured, or without the word "estimate". | They are estimates (C-24). This includes the `golem bench cost` description, which says "measured savings" in its help text. |
| B-31 | An unqualified claim that Golem lowers the user's bill, tokens or latency. | Compression is situational (C-13), figures are estimates (C-24), and no cost comparison has been run for these drafts. Say what the code does, not what it saves. |
| B-27 | "Audited", "certified" or "independently reviewed" for the Dust reviews. | They were read-only agent reviews inside this project. Say "reviewed by project agents" at most. |
| B-28 | "No known vulnerabilities" or any equivalent. | Not true to claim: the DUSTSEC reviews found follow-ups, the bypass guard is not a sandbox, and DUSTSEC.18 got no third review. |
| B-29 | That any DUSTSEC security fix is in a released version, or that users on current releases are protected by them. | No release tag contains any DUSTSEC fix. `git tag --sort=-v:refname` shows `v0.54.3` (2026-09-23) as newest, `git rev-list --count v0.54.3..HEAD` is 293 commits, and `git tag --contains` returned no tag for DUSTSEC fix commits `fd5b1dd`, `b30ca87`, `6702e63`, `078b77f` and `8b4e3a6`. Allowed only if DUST5.4 shows a tag containing the fix, re-checked at that time. |

## 3. Discrepancies found while reading code (not fixed here)

Out of scope to edit the spec or wiki. Each should become a follow-up task doc.

1. Spec §2.1 marks `snooze` instrumentation UNVERIFIED on the basis of one grep hit; `src/mcp/devices-snooze.ts:241,255` calls `instrumented(...)` for `snooze`. Banned until the spec is updated.
2. Spec §1 (A10) says `golem ollama setup` pulls the drafter model only; the code pulls every role model for the tier (`src/cli/ollama.ts:169`, `src/inference/ollama-bootstrap.ts:285-308`).
3. Spec §2.1 and §5 say "ten providers"; the proxy accepts nine (`src/providers/index.ts:145-147`).
4. Spec line anchors have drifted: the spec cites `src/config/schema.ts:1135` and `:1143` for the level defaults (now `:1167` and `:1175`), `:1074` for the dashboard port (now `:1212`), and `src/knowledge/index.ts:177-180` for the Qdrant throw (now `:182`).
5. Spec §2.2 cites `src/proxy/loopback-cert.ts` for device-surface mTLS; the write server is `src/security/write-server.ts`. `loopback-cert.ts` is the WebFetch loopback certificate.
6. `README.md` lines 10-11 say "real billed-token telemetry, not estimates"; savings figures are estimates (`src/cli/stats.ts:125-128`). See B-38.
7. `golem bench cost` help text says "measured savings" (`src/cli/commands/bench.ts:82-84`); the figures are estimates.
