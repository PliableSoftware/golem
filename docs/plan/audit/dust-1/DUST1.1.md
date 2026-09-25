# DUST1.1 — redaction, security, pipeline core and proxy: audit findings

Audited at `fd3aedc` (branch `dust/DUST1.1`). Read-only: no code, test, wiki, spec or ADR
was changed. "Probed" means a scratch script outside the repo imported the main
checkout's `dist/` (also built from `fd3aedc`), ran the behaviour, and printed booleans
only. It never printed a secret.

**Bucket counts (table rows below):** shipped-and-matches **64** · shipped-but-drifted
**19** · partial **15** · not-started **4** · dead-or-superseded **5** (107 classified
rows, plus 1 row deferred to DUST1.4).

## Headline findings (most serious first; all probed unless marked)

1. **Pipeline fail-open forwards the unredacted request.** Any throw inside
   `process()` makes the proxy forward the ORIGINAL body (`src/proxy/server.ts:346-356`).
   A test pins this as intended (`tests/integration/pipeline-proxy.test.ts:191`). Probed:
   a throwing `compression.compress`, a throwing `policy()`, and a throwing `onEvent`
   each put a raw AWS key upstream. This is reachable in production. A failed CCR blob
   write (`mkdir`/`writeFile`/`rename`, `src/compression/local-blob-store.ts:61-89`)
   makes `NativeLosslessCompression.compress` reject (it calls `putIfAbsent` at
   `src/compression/native-lossless.ts:404`), and at compression ≥ 1 that request goes
   upstream raw. Other unguarded throw sites: `lookup()`/`substituteKnownContent`
   (`pipeline.ts:695-701`), `applyBrevity`, `buildContextLedger`, and the synchronous
   `sessionRecorder.snapshot()` inside the event recorder (`src/cli/proxy-build/telemetry-hooks.ts:52`).
2. **Unauthenticated admin endpoint turns redaction off.** `POST /__golem/pipeline/false`
   (`src/proxy/server.ts:206-211`) flips `#pipelineEnabled`. The proxy then skips the
   whole pipeline, redaction included (`:350`). There is no auth, no Origin check and no
   persistence. Nothing reads `pipelineEnabled()` (grep: no caller), so no status surface
   shows the change. That is exactly the invisible-off state R11.3 set out to remove
   (`src/cli/pipeline-switch.ts:5-22`). Probed: a POST carrying `Origin: https://evil.example`
   got 200, and the next request forwarded a raw key. The default port is 4653
   (`src/config/schema.ts:1069`). A web page could therefore send the same simple POST
   (drive-by, not browser-tested). So could an agent's Bash tool.
3. **The `x-golem-bypass` header is a second, per-request redaction-off path**
   (`src/proxy/server.ts:350`, `src/proxy/headers.ts:86-91`, pinned by
   `tests/integration/pipeline-proxy.test.ts:102`). ADR-0004 says `bypass_all` is "the
   only redaction-free path". The `golem-bypass` skill (`.claude/skills/golem-bypass/SKILL.md:13-16`,
   generated from `src/cli/skills/basics.ts:75`) lists it as switching off *less* than
   `golem compression off` and never says redaction is skipped.
4. **Plugin stage mutating `body` in place skips the re-redaction.** `pipeline.ts:587`
   requires `next !== body`, and `:601` re-redacts only if `touched`. Probed: in-place
   mutation, with the stage returning `body` or `undefined`, forwards a raw secret
   whenever any later stage marks the request changed. The same root cause breaks "a
   throwing stage keeps the pre-stage body". Test gap: `tests/unit/plugins/plugin-stage.test.ts:104`
   covers only a returned new object.
5. **Object keys are never redacted.** `redactValue` rewrites values only
   (`src/pipeline/redaction.ts:287-290`), despite "Runs over the ENTIRE JSON" (`:308-310`).
   Probed: a secret used as a key survives with count 0. `ConversationStore` inherits this
   (`src/session/conversation-store.ts:188`).
6. **`connection-password` is not idempotent.** Its capture `([^\s@/]+)` accepts `[`, `]`
   and `:` (`src/pipeline/redaction-rules.ts:195`), so it re-matches its own placeholder.
   Probed: a second pass over two passwords in reversed order renumbers them. That breaks
   the idempotency and prefix-stability claims in the wiki, `redaction.ts:18-20`,
   `redaction-rules.ts:15-16` and ADR-0005 §3.
7. **The shim compresses, while every surface says it does not.** `SHIM_POLICY = policyFor(1)`
   (`src/cli/proxy-runtime.ts:48`) switches lossless compression on. Decision 56(c) says
   "no compression". So do the stop banner ("compression, brevity and local-answer are
   off", `src/cli/commands/proxy.ts:560`), `proxy-runtime.ts:201-202` and
   `src/cli/proxy-build/sidecars.ts:44`.
8. **The npm package name changed.** `package.json` `name` went from `golem-run` to
   `@pliable/golem` in `2fc7cd2` (2026-09-23), a commit whose message is about gateway
   model shapes. Spec §2.1/§6, CLAUDE.md, README.md:3 and `scripts/release.mjs:74` still
   say `golem-run`, and `d315b23` made npm publish unconditional. The next release
   publishes under the new name. Not probed; it is outward-facing.
9. **`isPathLikeToken` rejects any chunk containing `=` or `+`** (`redaction-rules.ts:352`, `:367`).
   Probed: a bare `/…/<uuid>/…` path survives, but `OUT_DIR=<path>` and `--out=<path>`
   still redact. The §140 fix is partial, and the result is over-redaction, not a leak.
10. **575 lines of dead code:** `src/proxy/context-guard.ts` and `src/proxy/context-monitor.ts`.
    `src/proxy/index.ts:1-2` and `:79-80` re-export them, and nothing imports them (repo-wide
    grep, tests included).

## Classification table

Legend: M = shipped-and-matches, D = shipped-but-drifted, P = partial, N = not-started,
X = dead-or-superseded. "Task" = existing `docs/plan/tasks/` id covering the gap. It is
`none` for every gap here: a keyword sweep of open task docs found only R14.3 (ACP
fail-open, unrelated) and R7.3 (WASM binaries, unrelated).

### Wiki — `concepts/Redaction Stage.md`

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| One ordered rule table | :16-22 | `redaction-rules.ts:104-237` | `tests/unit/pipeline/redaction.test.ts` CASES | D | Order PEM→provider→JWT/conn→PII holds, but `nostr-secret-key` (R14.3) is appended **after** `email` (:224-236), and the page does not list it. The doc's "then PII" is no longer last | none |
| PEM blocks first | :17-18 | `redaction-rules.ts:105-113` | redaction.test.ts | M | | |
| `sk-ant-` before `sk-` | :19-20 | `:140-150` (negative lookahead too) | redaction.test.ts | M | | |
| Entropy backstop 32-128 chars, 4.2 bits | :23-27 | `:260`, `:265-266`, `:273`, `:397-418` | redaction-audit.test.ts | M | | |
| Pure-hex and 2-of-3-class exclusions | (absent) | `:401-404`, `:408-416` | redaction-audit.test.ts | D | Load-bearing exclusions the page never names (doc side is incomplete) | none |
| Pure function: no clock, randomness or **config** | :29-30 | `redaction.ts:147-157`; `activeRedactionRules()` `redaction-rules.ts:500-502` | — | D | Since R8.11 the table depends on `plugins.load` (config at startup), and a plugin `validate` can be impure (`loader.ts:248-257`) | none |
| Idempotent: placeholder charset matched by no rule | :30-32 | `redaction-rules.ts:195` matches `[`/`]`/`:` | redaction.test.ts:165 and redaction-audit.test.ts:329 miss the multi-value case | D | Probed renumbering (headline 6). Plugin patterns are also unconstrained | none |
| Stage 1, never reordered; `bypass_all` the single exception | :36-41, mermaid :43-50 | `pipeline.ts:478-485`; but `server.ts:206-211`, `:350`, `:351-356` | pipeline-proxy.test.ts:102, :191 pin the extra paths | D | Three more redaction-off paths: header, admin endpoint, fail-open (headlines 1-3). Join injection (stage 0.9, `pipeline.ts:429-475`) runs before redaction by design and is then redacted | none |
| §31 integrity-hash exclusion | :57-59 | `redaction-rules.ts:298`, `:398-400` | redaction-audit.test.ts | M | | |
| §37 128-char ceiling | :60-65 | `:260-266` | redaction-audit.test.ts | M | | |
| §49 path-like tokens | :66-76 | `:351-373` | redaction-audit.test.ts | P | `=`/`+` chunks disqualify (headline 9) | none |
| "Open, not yet fixed" credit-card item | :84-92 | fixed at `:80-95` | redaction-audit.test.ts:291-306 | X | The page still carries the open item above its own "Resolved" section (:98-118) | none |
| §50/§55 separator/grouping guard | :98-116 | `:66-95`, `:216-217` | redaction-audit.test.ts:291+ | M | | |
| §24/§56 four provider rules | :122-140 | `:157-207` | redaction.test.ts CASES | M | | |
| §140 hex chunks, 3-chunk floor | :147-164 | `:344-373` | redaction-audit.test.ts:194 | M | Code comments cite **§137** (`:318`, `:387`). §137 is `subagent-park`; §140 is correct (stale comment) | |
| Negative cases paired with positives | :78-82 | — | redaction-audit.test.ts (28 cases) | M | Pairing spot-checked, not exhaustively | |

### Wiki — `concepts/Redaction Path Placeholders.md`

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| Candidate charset / POSIX path is one token | :19-28 | `redaction-rules.ts:265-266` | redaction-audit.test.ts | M | | |
| `\` breaks runs, so both spellings agree | :30-38 | charset excludes `\` (`:266`) | redaction-audit.test.ts:194-202 | M | | |
| `redactStandaloneText` is one-way | :86-90 | `redaction.ts:169-171` | redaction.test.ts | M | | |
| `redactReversibleText` used for remote `coder` | :91-96 | `src/inference/target-dispatcher.ts:917` uses **`redactReversibleTexts`** | — | D | Name drift: R13.11 multi form. Same table semantics (`redaction.ts:243-261`) | none |
| Restoration map in memory only | :93-96 | `redaction.ts:251-259` (closure) | — | M | | |
| Placeholders look identical either way | :98-103 | `redaction.ts:65`, `:77` | — | M | | |
| Write path byte-faithful; only the view corrupts | :42-48 | hooks side (`src/hooks/redact.ts:34`) | — | M | Observed live in this audit: `redaction-rules.ts:193`/`:235` rendered with placeholders that are not on disk (checked with `od`) | |

### Wiki — `concepts/Plugin Seams.md` and ADR-0005

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| No discovery; `load` default `[]` | wiki :134-136; ADR §1 | `loader.ts:9-12`, `:168`; `schema.ts:1199` | loader.test.ts | M | | |
| `plugins.enabled` kill switch, default true | wiki :137-138; ADR §1 | `loader.ts:153`; `init.ts:46-51`; `schema.ts:1198` | loader.test.ts | M | | |
| Bare specifier resolved from project; no download | ADR §1 | `loader.ts:83-89` | loader.test.ts | M | | |
| Built-ins first, plugin suffix, entropy last | wiki :74-75; ADR §2 | `redaction-rules.ts:500-502`; `redaction.ts:150-155` | redaction-append-only.test.ts | M | | |
| No remove/replace/reorder API; `REDACTION_RULES` never handed out | wiki :76-77; ADR §2, threat row 3 | API absent ✓; but `REDACTION_RULES` is an **exported, unfrozen** array (`redaction-rules.ts:104`) | redaction-append-only.test.ts | P | "Yes, structurally" is overstated: an in-process plugin can import and splice it, which ADR's own "full authority" section concedes | none |
| Namespaced kinds `<plugin>/<rule>`, charset-validated | wiki :78-79; ADR §2 | `loader.ts:32`, `:107`, `:214`, `:244` | loader.test.ts | M | `registerExtraRedactionRules` itself checks only `includes("/")` (`redaction-rules.ts:481`); the loader is the real gate | |
| Plugin rule sees placeholders, cannot un-redact | wiki :80-82 | `redaction.ts:150-155` order | redaction-append-only.test.ts | M | | |
| Register once; second refused | wiki :83-86; ADR §2 | `redaction-rules.ts:470-487` | redaction-append-only.test.ts | M | Sealed even when 0 accepted | |
| Plugin `validate` throw = not a secret | wiki :110-112; ADR §4 | `loader.ts:126-138`, `:248-257` | loader.test.ts | M | | |
| `g` flag required | types.ts:37 | `loader.ts:222-224` | loader.test.ts | M | Zero-length-match patterns (e.g. `/x*/g`) are not rejected, and `applyRule` then inserts `[REDACTED:k:1]` at every position (`redaction.ts:96-120`) | none |
| Stage runs after redaction and local-answer, before compression | wiki :63-67; ADR §3 table | `pipeline.ts:568-614` | plugin-stage.test.ts:86 | M | | |
| Redaction re-runs over stage output | wiki :88-99; ADR §3, threat row 5 | `pipeline.ts:587`, `:601-611` | plugin-stage.test.ts:104 (new-object case only) | P | In-place mutation bypasses it (headline 4) | none |
| `redaction-after-plugins` attributed separately | wiki :97-99 | `pipeline.ts:609` | plugin-stage.test.ts:123 | M | | |
| Stage throw: skipped, pre-stage body kept | wiki :103-105; ADR §4 | `pipeline.ts:591-599` | plugin-stage.test.ts:149, :168 | P | Partial in-place mutation before the throw persists | none |
| `setup()` throw discards all registrations | wiki :107-109; ADR §4 | `loader.ts:201-207`, `:314-321` | loader.test.ts | M | | |
| Every problem surfaced by `golem plugin` and counted | ADR §4 | `cli/plugin.ts:36-53` runs a **fresh** load | — | P | Runtime problems never reach it. Stage throws go only to proxyLog (`pipeline.ts:594`). Validate throws append to the proxy's in-memory `problems` array for the life of the process, which nothing reads after init (`loader.ts:250-254`) and which grows without bound | none |
| `golem plugin`: read-only, no install verb, resolved path, no-sandbox notice | wiki :114-125; ADR §5 | `cli/plugin.ts:55-59`, `:99-117`, `:158` | — | M | | |
| "Same code path the proxy runs, so what you see here is what the proxy got" | `cli/plugin.ts:33-34` | separate process and load | — | D | Can differ from the running proxy (edited plugin file, changed settings). Also executes third-party `setup()` inside a diagnostic command | none |
| Regex-hang risk named by `golem plugin` | ADR §5 | no such text (grep for backtrack / catastroph / hang in `src/cli/plugin.ts`, `src/config/ui-model.ts`) | — | N | | none |
| Settings help states no sandbox | wiki :33-34 | `src/config/ui-model.ts:689` | — | M | | |
| MCP tool colliding with a built-in is rejected | wiki :67; ADR threat row 8 | `loader.ts:43-55`, `:288-294`; `src/mcp/server.ts:288-333` (registered last, description tagged) | mcp-plugin-tools.test.ts | M | `BUILTIN_MCP_TOOL_NAMES` matches the 11 live tools | |
| Shim gets rules, not stages | wiki :140-145 | `proxy-runtime.ts:281-287`; rules process-global | proxy-bypass-shim.test.ts | M | | |
| Plugin rules protect an org's private format wherever Golem redacts | ADR Context; wiki :48-58 | `initPlugins` only in `commands/proxy.ts:302` and `commands/mcp-serve.ts:261` | — | P | Hooks (`src/hooks/redact.ts:34`, `session-state.ts:313`), vibe store (`vibe/store.ts:141`, `:169`, `:227`) and join-queue enqueue (`session/join-queue.ts:170`, in the write-server process) redact **without** plugin rules. Upstream is still covered by the proxy's pass | none |
| No-plugin install is byte-identical | ADR Consequences | `pipeline.ts:581`; `redaction-rules.ts:501` | plugin-stage.test.ts:59, :66 | M | | |
| Prompt-cache stability: "Yes" | ADR threat row 6 | nothing enforces a pure `validate` | — | P | | none |
| R9.3 map is a closure local | ADR threat row 2 | `redaction.ts:251-259` | — | M | | |
| Contract in non-frozen `src/plugins/types.ts` | ADR Consequences | `types.ts:16-19` | — | M | | |
| Declarative pattern-only rules (successor) | wiki :151-154; ADR Alternatives | — | — | N | Recorded as a successor | none |
| WASM-compiled rules (successor) | wiki :155-158; ADR Alternatives | — | — | N | | none |

### Spec §2.1 Integration surfaces (proxy half)

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| Single process, two doors, one shared engine | :114 | proxy daemon (`commands/proxy.ts:178`) and `golem mcp serve` (`commands/mcp-serve.ts:261`) each load their own plugins/state | — | D | Two processes. Each builds its own engine | none |
| `npx golem-run init` | :116 | `package.json` name `@pliable/golem` since `2fc7cd2` | — | D | Headline 8 | none |
| Init sets `ANTHROPIC_BASE_URL` | :117 | `src/cli/proxy-wiring.ts` (`ENV_BASE_URL`, `proxyBaseUrl`); per-project port `proxy-daemon.ts` (`defaultProjectPort`) | — | M | | |
| Proxy forwards to `api.anthropic.com` | :125 | `src/proxy/types.ts:43` | proxy-passthrough.test.ts:93 | M | | |
| Responses piped as raw bytes | :121, CLAUDE.md | `server.ts:622-704` (UsageSniffer forwards chunks unmodified) | proxy-passthrough.test.ts:70 | M | Translating routes re-serialize by design (`:515-620`) | |
| `get_original(ref)` via MCP | :121 | tool is `expand` (Decision 27) | — | X | | none |
| MCP tool list `search_local`… | :126 | none in src (grep) | — | X | MCP half; superseded by Decisions 27/35 | none |
| SDK: thin wrapper over the Anthropic SDK | :127 | `src/index.ts:1-5` exports interfaces and `VERSION` only | — | N | | none |
| Skills/tools layering; bypass skill exception | :131-142 | `SKILL.md:6-9` | skills-tools-layering.contract.test.ts | M | The exception is declared. Option 1's wording is a contradiction (below) | |

### Spec §6 Tech Stack

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| TypeScript, Node ≥ 22, ESM | :265 | `package.json` `engines`/`type` | — | M | | |
| Fastify or equivalent HTTP layer | :265 | `node:http` + `undici` (`server.ts:19-23`) | — | M | | |
| Distributed as `golem-run` | :265 | `@pliable/golem` | — | D | Headline 8 | none |
| Native lossless stage + Headroom sidecar at `compression.level: 3` | :266 | sidecar at ≥ 2 (`sidecars.ts:37`; `commands/proxy.ts:320`) | — | D | The same comment also says "first ≥3 request" (`sidecars.ts:38`) | none |
| Vector DB: LanceDB candidate / Qdrant | :267 | `src/knowledge/file-driver.ts:4-13` rules LanceDB out; no qdrant anywhere | — | X | | none |
| Embeddings ONNX/transformers.js CPU fallback | :269 | hashing embedder (`src/knowledge/index.ts`, `sidecars.ts:84`); no onnx dep | — | D | | none |
| MCP SDK, stdio + streamable HTTP | :270 | `src/mcp/serve.ts` (both transports) | — | M | "re-exported Headroom tools" is unverifiable here | |
| SQLite cache/metadata store | :271 | `src/telemetry/types.ts:10` (JSONL chosen over `node:sqlite`) | — | X | | none |
| tree-sitter code parsing | :272 | optional tier (`src/hooks/post-tool-use/digest.ts:13`) | — | P | Optional add-on, not core | none |

### Decision 33 (local-answer, pipeline side)

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| Own settings leaves, not the slider | D33 bullet 1 | `schema.ts:511`, `:518` | — | M | | |
| Single-turn, role user, plain text | D33 (a) | `local-answer-response.ts:69-81` | local-answer-response.test.ts | M | Plus undocumented gates: no `tools`, ≤ 1000 chars (`:50`, `:72-79`) | |
| Confidence floor 0.6 | D33 (c) | `schema.ts:1138`; `sidecars.ts:86` | — | M | | |
| Visible "verify independently" label | D33 Labeling | `src/knowledge/local-answer.ts:21` | — | M | | |
| `respondDirectly` seam skips upstream | D33 proxy seam | `src/proxy/types.ts:17`, `:65`; `server.ts:362-371` | local-answer-stage.test.ts | M | | |
| Feature off → upstream called, bytes unchanged | D33 proxy seam | `pipeline.ts:498`, `:747-751` | local-answer-stage.test.ts | M | | |
| `avoidedUpstreamOutputTokens` telemetry | D33 Telemetry | `pipeline.ts:105`, `:540` | — | M | | |
| Default ON | D33 final bullet | `schema.ts:1137` | — | M | Stale comment `sidecars.ts:65` says "OFF by default" | |
| Runs on the redacted body | D33 / guidance | `pipeline.ts:478-499` | local-answer-stage.test.ts | M | | |
| 2 s budget (R10.23) | (absent) | `pipeline.ts:334`, `:512-526` | local-answer-stage.test.ts | D | Undocumented in the spec. Bug: on the answered path `reportHeldRequest` (`:548`) runs before the `finally` records `stageMs["local-answer"]` (`:563`), so the held-request log omits the stage that held it | none |
| Extractive `composeFromHits` / `isProseSource` | D33 (b), acceptance | KB side | — | — | Owned by DUST1.4. Not re-verified here and not counted in any bucket | |

### Decision 56 (stop = pipeline off)

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| `stop` keeps the port served by a shim | D56 (b) | `commands/proxy.ts:528-560`; `proxy-daemon.ts:439-452` | proxy-bypass-shim.test.ts:109 | M | | |
| `ProxyDesired` third state | D56 (b), Interfaces | `proxy-state.ts:18-23` | — | D | Names swapped. D56 says `stopped` = pipeline off; the code uses `bypass` for pipeline-off and `stopped` for `--hard` only (`commands/proxy.ts:532-538`) | none |
| Shim redacts | D56 (c) | `proxy-runtime.ts:48`, `:203` | proxy-bypass-shim.test.ts:115 | M | | |
| Shim: no compression, no brevity, no local-answer | D56 (c) | lossless compression ON (`policyFor(1)`); brevity off ✓; local-answer off ✓ (`sidecars.ts:77`); sidecar off ✓ (`:48`) | nothing pins compression | D | Headline 7. The join queue is still wired in the shim (`proxy-runtime.ts:241-246`), which D56 does not mention | none |
| `wire` / `unwire` | D56 (d) | `commands/proxy.ts:614`, `:651`; `proxy-wiring.ts` | — | M | | |
| Ownership guard reused | D56 (d) | centralised in `proxy-wiring.ts:17`, `:158-189`, `:227-270` (not `init.ts`) | — | M | Location differs, rule identical | |
| Shim never honours `bypass_all` | wiki/ADR-0004 | `proxy-runtime.ts:309` | proxy-bypass-shim.test.ts:128 | M | | |
| Daemon log `.golem/proxy.log`, 1 MB (D57(e) spill-over) | D57 (e) | `proxy-daemon.ts:86-98`, `:416`, `:447-452` | — | M | | |

### ADR-0004 — the `proxy.bypass_all` claim

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| Persisted setting, default false | ADR :73 | `schema.ts:116`, `:1068` | config tests | M | | |
| `golem on`/`off` writes it (the toggle no longer forgets) | ADR :66-71 | `pipeline-switch.ts:85-104` | cli-pipeline-switch.test.ts:82, :108 | M | ADR :71's "noted, not fixed here" is now fixed (R11.3) | |
| CLI-only: a tool call cannot set it | ADR :75-76 | no MCP setter (`src/mcp/deps.ts:31`); team layer refused (`src/config/loader.ts:112-145`) | — | P | A Bash tool call can run `golem off`, or `curl` the admin endpoint (headline 2). Nothing blocks either | none |
| Surfaced loudly wherever active | ADR :74 | settings-reading surfaces (`statusline.ts`, `status-collect.ts`, `watch.ts`, `tui/header.ts`); `pipeline-switch.ts:125` | — | P | The admin-endpoint and header states are invisible (no caller of `pipelineEnabled()`) | none |
| Only redaction-free path; every table row `redaction: true` | ADR :80-89 | table ✓ `policy.ts:138-175`; but `server.ts:206-211`, `:350`, `:351-356` | pipeline-proxy.test.ts:102, :191 | D | Headlines 1-3 | none |
| "Unrepresentable" | ADR :88-89 | `StageConfig.redaction: boolean` (`policy.ts:131`); the pipeline obeys `false` (`pipeline.ts:478`, `:603`) | policy.contract.test.ts | P | Unreachable from settings, but a caller-built policy can still disable redaction | none |

### CLAUDE.md hard rules (owned subset)

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| Redaction never weakened or reordered | CLAUDE.md | order ✓ (`pipeline.ts:477-485`); weakened by headlines 1-5 | — | D | | none |
| `bypass_all` single exception, CLI-only, loud | CLAUDE.md | see ADR-0004 rows | — | D | | none |
| Byte-faithful at compression ≤ 1, with recorded-shape tests | CLAUDE.md | response pipe raw ✓; an unchanged request returns the original bytes ✓ (`pipeline.ts:747-751`) | proxy-passthrough.test.ts; pipeline-proxy.test.ts:124 | P | Any redaction or level-1 dedup re-serializes the **whole** body with `JSON.stringify` (`pipeline.ts:753`), which normalizes bytes outside the redacted span (escapes, number forms). `policy.ts:19` calls level 1 "Byte-faithful" | none |

### `src/interfaces/` conformance

| feature | claim source | code evidence | test evidence | class | note | task |
|---|---|---|---|---|---|---|
| `PipelinePolicy` / stage table | `policy.ts` | `pipeline.ts` honours `redaction`, `losslessCompression`, `semanticCompression` | policy.contract.test.ts | D | `semanticCache` has **zero readers** in src, yet levels 2-3 promise "+ semantic cache" (`policy.ts:20-21`), as does `src/cli/dials.ts:213`. `toolResultCache` is read only by `src/mcp/in-memory-compression.ts:80`, never by the proxy | none |
| `CompressionService` | `compression.ts` | `native-lossless.ts:334`, `mcp/in-memory-compression.ts:63` | compression.native.contract.test.ts, mcp-in-memory-compression.contract.test.ts | M | | |
| `BlobStore` | `storage.ts` | `local-blob-store.ts:39` | storage.local.contract.test.ts | M | | |
| `InferenceService` | `inference.ts` | `inference/service.ts:81` | unit/inference/service.test.ts uses inference-contract | M | | |
| `KnowledgeBase` | `knowledge.ts` | `knowledge/knowledge-base.ts:114` | unit/knowledge/*-contract use | M | `FederatedSearch` has no `implements` site (DUST1.4) | |
| `LocalAnswerService` | `local-answer.ts` | `knowledge/local-answer.ts:66` | local-answer.contract.test.ts | M | | |
| `WikiStore` / `WikiReader` | `wiki.ts` | `wiki/file-wiki-store.ts:37`, `wiki/federated-wiki-reader.ts:27` | wiki.contract.test.ts | M | | |
| `ConversationStore` (redact before disk) | `conversation-store.ts:14-21`, `:73-74` | `session/conversation-store.ts:132`, `:188` | unit only (`tests/unit/session/conversation-store.test.ts`) | P | No `tests/contract/` suite for a frozen contract; key redaction gap inherited | none |
| `JoinQueue` (redact on enqueue, atomic claim) | `join-queue.ts:18-40` | `session/join-queue.ts:106`, `:170` | unit only (`join-queue.test.ts`) | P | No contract suite. Plugin rules absent in the enqueuing process | none |
| `SessionEvent*` (seq, idempotent) | `session-events.ts:8-33` | no `implements` site | session-bus.test.ts, session-transport.test.ts | P | No contract suite. Not deeply verified | none |

## Undocumented (owned src with no owned-doc claim)

- `src/security/*`: device CA (`device-ca-store.ts`), catalog (`device-store.ts`),
  enrolment codes (`enrolment.ts`), passcode factor (`user-factor.ts`: scrypt with random
  salt and `timingSafeEqual`, `:134-167`, and no attempt limiting), the write guard
  (`write-guard.ts:1-19`) and the mTLS write server (`write-server.ts`). ADR-0007 covers
  these (another partition); none of this partition's docs do.
- `src/proxy/`: loopback cert/reach/serve (`loopback-*.ts`), cache-prefix observer
  (`cache-prefix.ts`, R8.1), context ledger (R8.4), usage sniffer (R1.1/R11.7), limit
  prediction, served-model snapshot, transparent 429/529 retry (`rate-limit-retry.ts`;
  `server.ts:472-513`, R14.5), local `count_tokens` for translating upstreams
  (`server.ts:403-419`), virtual `golem/<id>` model rewrite (`server.ts:61-86`, `:331-343`),
  per-origin pools capped at 32 (`:104`, `:156-169`), and the unauthenticated
  `/__golem/statusline` endpoint (`:214-228`).
- `src/pipeline/brevity.ts`, `src/pipeline/join-injection.ts` (R13.7, stage 0.9 before
  redaction).
- `src/cli/fast-path.ts` (hook and statusline fast path, imported by `src/cli/main.ts`),
  `src/cli/proxy-build/*` (R10.1 split), and `proxy-daemon.ts` spawn env and fingerprint.
  `proxy-wiring.ts` also carries the extra-CA and Foundry env keys.
- Local-answer ≤ 1000-char and no-`tools` gates, and the 2 s budget (see the D33 rows).
- The pipeline observes the **pre-redaction** body for the session tree and live
  conversations (`pipeline.ts:399-418`). Verified: only hashes are persisted
  (`session/session-tree.ts:3`, `session/live-conversations.ts:28`).

## Dead candidates

- `src/proxy/context-guard.ts` (321 lines) and `src/proxy/context-monitor.ts` (254):
  re-exported at `src/proxy/index.ts:1-2`, `:79-80`, with no importer anywhere (repo-wide
  grep, tests included). `context-guard.ts:13` imports `../providers/gateways.ts` with a
  `.ts` extension.
- `StageConfig.semanticCache` and its `SemanticCache` values: written in `policy.ts:135-173`,
  read nowhere.
- `BuildProxyOptions` has an orphaned doc comment for a deleted slider-store field
  (`src/cli/proxy-runtime.ts:93-97`).

## Stale comments (Phase 3 input)

- `pipeline.ts:14` "secret-free level-0 requests"; `:20` "slider ≥2"; `:162-163`
  "persisted slider level"; `:209` "(slider ≥3)"; `:287` "`slider.level`"; `:720`
  "off at slider 0".
- `proxy-runtime.ts:139-143`: calls `x-golem-bypass` "the single sanctioned
  redaction-off path" (ADR-0004 moved that to `bypass_all`). `:201-202` says "redaction
  and nothing else" while `SHIM_POLICY` compresses.
- `sidecars.ts:37-38`: "≥2" and "first ≥3" in one comment. `:44`: "shim runs no
  compression at all". `:65`: "OFF by default".
- `redaction-rules.ts:318`, `:387` cite §137; should be §140.
- `redaction.ts:308-310` "Runs over the ENTIRE JSON" (keys excluded). `:18-20` and
  `redaction-rules.ts:15-16` claim idempotency (false for `connection-password`).
- `server.ts:11-13` "at A1 the pipeline is the identity". `:235-239` says every terminal
  path reports, but `:536-537` and `:586-587` return without `report()`.
- `cli/plugin.ts:33-34` "what you see here is what the proxy got".
- `policy.ts:19` "1 — … Byte-faithful" while level 1 rewrites via dedup/compaction.
- `commands/proxy.ts:560` (user-facing): "compression … off" on the shim.

## Contradictions for the human (not resolved here)

1. **Fail-open vs the redaction hard rule.** `server.ts:346-356` and
   `pipeline-proxy.test.ts:191` treat forwarding the original on error as correct.
   CLAUDE.md says redaction is never weakened. The hard rule looks right. A fail-closed
   (or redact-then-forward) fallback would satisfy both.
2. **`x-golem-bypass` survives ADR-0004.** Is a per-request, unpersisted, unsurfaced
   redaction-off header still sanctioned? The skill (`SKILL.md:13-16`) presents it as the
   mildest option.
3. **The admin endpoint** (`server.ts:200-211`) has no auth, no Origin check and no
   persistence. It is the only redaction toggle that no status surface can see.
4. **What "CLI-only" means.** No MCP tool can set `bypass_all`, but an agent's Bash tool
   can run `golem off` or `curl` the endpoint, and the skill tells the model "no tool call
   can turn redaction off".
5. **Decision 56(c) "no compression"** versus `SHIM_POLICY = policyFor(1)`: which is
   meant? The CLI banner and three comments side with D56.
6. **What "byte-faithful at ≤ 1" means**, given that level-1 dedup and any redaction
   re-serialize the whole body.
7. **Package name** `@pliable/golem` versus `golem-run` in the spec, CLAUDE.md, README and
   the release script, with npm publish now unconditional.
8. **ADR-0005 "Yes, structurally"** for "plugin weakens built-ins" sits beside the ADR's
   own admission of full process authority. `REDACTION_RULES` is exported and mutable.
9. **Plugin rules are absent from hook, vibe and join-queue redaction** (separate
   processes). Is that intended? ADR-0005 names only the proxy and MCP server.
10. **Spec §2.1 "single process"** versus a proxy daemon and a separate `mcp serve` process.

## Unverifiable here

- KB-side Decision 33 claims (`composeFromHits`, `isProseSource`, the ≥ 0.6 calibration):
  DUST1.4.
- Whether Claude Code can emit `x-golem-bypass` (e.g. via `ANTHROPIC_CUSTOM_HEADERS`). Not
  tested.
- The browser drive-by against the admin endpoint was probed with Node `fetch` plus a
  forged `Origin`, not a real browser's no-cors POST. It is expected to be the same
  (simple request, no preflight).
- Whether a translating or Foundry route's `mapUpstreamHeaders` injects stored provider
  credentials. If it does, the loopback proxy is a cross-origin-triggerable relay for
  that credential. Not traced.
- The passcode brute-force surface (where `verifyPasscode` is reachable remotely).
- `SessionEvent` implementations, which were not traced.
- **Audit-integrity note:** this session's own tool output passed through redaction, so
  some reads displayed placeholders that are not on disk (`redaction-rules.ts:193`,
  `:235`, checked byte-wise). The git attribution email in the session instructions also
  arrived as a placeholder, so this branch's commit trailers carry the literal
  `[REDACTED:email:…]` text.
