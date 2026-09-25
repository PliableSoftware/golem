# DUST1.2 — providers, routing, gateways & credentials: audit findings

Read-only audit, 2026-09-25, branch `dust/DUST1.2` off `development@fd3aedc`.
Scope per `docs/plan/tasks/DUST1.2.md`. Line numbers are at `fd3aedc`.
Classification only; nothing here is fixed. Test evidence below means "a test
that pins this exists, found by reading it". No test was run: the worktree has no
`node_modules` (see **Unverifiable here**).

**Headline:** one rename was never carried back into the docs, and three things
the brief assumed are false:

- **The `account` → `gateway` rename (R9.23) never reached the spec or ADR-0003.**
  Decisions 46/47/48/49 and ADR-0003 name `golem account login|logout|use|list|add|remove`
  and `--model`. The CLI is `golem gateway …` (`src/cli/commands/gateway.ts:35`)
  and takes `--models` (`:145`).
- **`claude-cli` was never retired.** R13.12 split the removal out to R13.14,
  which is still queued and blocked. The spawn path is fully live.
- **ADR-0003 invariant 4 no longer holds as written.** It says no MCP surface can
  touch credentials or select an account, and that `src/credentials/` is
  CLI-only. Both are now false.
- **Decision 47's "exporting the var configures nothing" holds only for the
  detached daemon.** A foreground `golem proxy run` still takes a hand-exported
  key over the stored one.

## Findings table

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 1 | Golem fronts non-Anthropic gateways through per-provider adapters | D22 "Architecture" | `src/providers/index.ts:100-126` (10 providers); `src/cli/route-resolver.ts:101-161` (Gemini and OpenAI-schema translators) | `tests/unit/providers/openai-translate.test.ts`, `gemini-translate.test.ts`, `tests/integration/proxy-translate.test.ts` | shipped-and-matches | D22 names OpenRouter + Azure Foundry. The code also has `openai`, `ollama`, `llamacpp`, `gemini`, `nvidia-nim` and `claude-cli`, and no doc lists them all. | — |
| 2 | The Anthropic path stays byte-faithful; non-Anthropic adapters are a separate code path | D22 "Hard boundary" | `route-resolver.ts:96-100,157-160` (no translator for case a); `src/cli/proxy-runtime.ts:316-321` (resolver absent with one target) | `tests/integration/proxy-routing.test.ts` | shipped-but-drifted | Bytes are never mutated, but once more than one target exists, `bodyModelOf` does a full `JSON.parse` of every request body, Anthropic path included (`route-resolver.ts:205-215`). `model-display.ts:21-29` says the proxy deliberately never parses the whole body on the hot path. Byte-faithfulness holds; the stated performance design does not. | none |
| 3 | Target-model-friendly prompt translation (20g generalised) | D22 "Stage generalization" | no provider-specific prompt shaping in `src/providers/` | — | not-started | Only wire-schema translation exists; nothing reshapes the prompt per target model. Possibly owned by the prompt partition (`src/prompt/`). | none |
| 4 | Cache alignment is per-provider | D22; D48 "Caching assumption" | `src/providers/index.ts:385-400` | `tests/unit/providers/index.test.ts` | shipped-and-matches | `openrouter` → `true` (fail-safe), other translating providers → `false`, as D48 says. | — |
| 5 | Spec §2/§2.1: the hub forwards to `api.anthropic.com` | spec §2.1 table row "Transparent proxy" | `providers/index.ts:100-146`; `providers/gateways.ts:93-138` | — | shipped-but-drifted | §2 still describes a single Anthropic upstream. The code fronts 10 providers plus a gateway/target registry. The code looks right; §2 predates D22/R6.1. | none |
| 6 | Credential resolution chain is keychain → file (env removed) | D46 amended by D47; ADR-0003 2nd amendment | `src/credentials/store.ts:119-131` (`readChain`); `backends.ts:48` (`CredentialBackendId = "keychain" \| "file"`) | `tests/unit/credentials/store.test.ts`; `tests/unit/cli/gateways.test.ts:220-229` | shipped-and-matches | D46's own text still lists `env` first. D47 supersedes that; D46 is not annotated. | — |
| 7 | `file` backend is never auto-selected for writes | D46; ADR-0003 invariant 2 | `store.ts:157-178` (`writeBackend`); `commands/gateway.ts:92-99` | `store.test.ts` | shipped-and-matches | Minor: `--store` accepts any string, and anything other than `file` silently means keychain (`commands/gateway.ts:99`), so a typo like `--store fiel` is not rejected. | none |
| 8 | No native dependency: macOS `security`, Linux `secret-tool`, Windows DPAPI via a detected PowerShell host (`pwsh` first) with a real self-test | D46; ADR-0003 1st amendment | `backends.ts:236,263,274-311,377-389,460,577` (`DPAPI_HOSTS = ["pwsh.exe","powershell.exe"]`) | `tests/integration/credentials-win32.test.ts`; `store-batch.test.ts` | shipped-and-matches | Since R9.20 the self-test no longer gates reads; it only disambiguates after a failure (`gateways/credentials.ts:261-266`). The docs still say the host is detected by a self-test. | — |
| 9 | Honest labels: DPAPI is never called "Credential Manager", a file is never called "encrypted" | D46 "Honesty rules" | `backends.ts:263,311,577,647`; `store.ts:162-175` | `store.test.ts` | shipped-and-matches | | — |
| 10 | Secrets never go through argv | D46; D47 | `backends.ts:236` (`-w` reads stdin), `:345`; `commands/gateway.ts:104` (piped stdin) | `store.test.ts` | shipped-and-matches | | — |
| 11 | CLI owns credentials; the detached daemon gets a minimal allowlist env (`buildSpawnEnv`) | D46; ADR-0003 1st amendment | `src/cli/proxy-daemon.ts:281-299,456` | not located | shipped-and-matches | | — |
| 12 | "Exporting the var by hand configures nothing"; `credentialEnvForProxy` never reads an ambient var | D47; ADR-0003 2nd amendment | `src/cli/commands/proxy.ts:215-218` (`process.env[name] ??= secret`); `proxy-daemon.ts:301-309` (`CREDENTIALS_INJECTED_ENV`) | — | shipped-but-drifted | True for the detached daemon, which gets a clean env. In a foreground `golem proxy run`, an ambient `GOLEM_UPSTREAM_API_KEY__<ID>` beats the stored key, because `??=` keeps whatever is already there. Exporting `CREDENTIALS_INJECTED_ENV` by hand also skips store resolution completely. D47 describes the `??=` as intentional, but it contradicts D47's own "configures nothing" sentence. See **Contradictions** C3. | none |
| 13 | `gateway login`: masked prompt → probe → store only if accepted; a rejected key is never stored; inconclusive stores with a warning | D46 | `gateways/credentials.ts:110-184`; `prompt.ts:48-97` | `gateways.test.ts`; `tests/unit/credentials/probe.test.ts` | shipped-but-drifted | The behaviour matches. The docs name it `golem account login` (R9.23 renamed it to `gateway`). | none |
| 14 | Non-TTY `login` reads the key from stdin | D47 | `commands/gateway.ts:104-109,242-247`; `gateways/credentials.ts:126-133` | `gateways.test.ts` | shipped-but-drifted | Same `account` → `gateway` naming drift. `gateway add --login` does not accept piped stdin (`commands/gateway.ts:205-206` passes no secret), so it fails on a non-TTY. | none |
| 15 | `use` preflight fails closed on an unresolvable credential; `--yes` overrides | D46; ADR-0003 invariant 3 | `src/cli/gateways.ts:122-139` | `gateways.test.ts:170-196` | shipped-but-drifted | Naming drift. The preflight also has **no keyless exemption**: `gateway use <ollama/llamacpp gateway>` refuses without `--yes`, although `gateway add` tells the user "no key to set — next: golem gateway use <id>" (`commands/gateway.ts:198-203`). The test at `gateways.test.ts:170-176` pins the refusal, using an `ollama` gateway. See C1. | none |
| 16 | `list` shows key location and strength, never the value | D46 | `gateways/registry.ts:120-202,216-242` | `gateways.test.ts:553-570` | shipped-but-drifted | Naming drift. `renderGateways` prints `key MISSING (set it with: golem gateway login <id>)` for keyless `ollama`/`llamacpp` gateways and for the Anthropic `inherit` default. `renderTargets` (`cli/targets.ts:350-356`) was fixed for exactly this in R13.13, but the gateway surface was not. `gateways.test.ts:555-558` pins `key MISSING` for an ollama gateway. See C1. | none |
| 17 | `account remove` logs out first (`forget` before the registry edit); `--keep-credential` | D47(b); ADR-0003 2nd amendment | `src/cli/gateways.ts:270-318` (logout at `:299-307`, registry write at `:310`) | `gateways.test.ts` | shipped-but-drifted | The ordering matches. Naming drift (`gateway remove`). `forget` swallows a faulting backend's `get` (`store.ts:293`, `.catch(() => null)`), so a keychain error during remove reports "no stored credential" rather than a fault. | none |
| 18 | Login/logout/switch/add/remove are audit-logged to `.golem/state/` | ADR-0003 invariant 5 + amendment | `gateways/registry.ts:205-213` (`account-log.jsonl`); `cli/targets.ts:89-97` | `gateways.test.ts` | shipped-and-matches | For config actions only; per-request routing is row 19. | — |
| 19 | Every *request* → (account, provider, reason) selection is appended to `.golem/state/` | ADR-0003 invariant 5 | `proxy-runtime.ts:321-331` → `proxyLog`; `src/shared/proxy-log.ts:39`; `proxy-daemon.ts:93-98` (`.golem/proxy.log`, tail-truncated to 1 MB on each start) | — | partial | Per-request routing is logged only when the registry has more than one target (`proxy-runtime.ts:321`). It goes to `.golem/proxy.log`, not `.golem/state/`, and that log is truncated on every daemon start. The single-target path records nothing per request. | none |
| 20 | Invariant 4: no MCP/tool surface reads credentials or selects an account; `src/credentials/` is imported only by the CLI | ADR-0003 invariant 4 + 1st amendment; `credentials/index.ts:12-13`; `store.ts:32-33` | `src/cli/commands/mcp-serve.ts:53-78` (the MCP server resolves every credential via `credentialEnvForProxy`); `src/mcp/coder-tools.ts:134-156` (`coder` exposes a `target` argument); `src/buzz/identity.ts:51`, `buzz/provision.ts:28`, `buzz/acp-turn.ts:24-26`, `portal/tokens.ts:32` import the credential module | not located | shipped-but-drifted | No tool returns a secret. But the MCP server process reads the OS store (the process ADR-0003 says is least reliable for keychains), and the model can pick a target, and with it a gateway credential, through `coder`. That is R9.3's deliberate design (bounded by `agent_selectable`, `providers/targets.ts:76-90`) but ADR-0003 was never amended for it. The code comments repeat the stale invariant. See C2. | none |
| 21 | Invariant 1: secrets never on a settings/log surface | ADR-0003 invariant 1; `route-resolver.ts:23-25` | `route-resolver.ts:108-125` + `:96` (Gemini `translateUpstream.path` carries `?key=<secret>` and is spread onto the `ProxyRoute`); `gemini-translate.ts:183-196` | not located | shipped-but-drifted | No log line was found that prints it (`proxy/server.ts:399,433,451` only use it as the request path). But the comment "no key is ever placed on a `ProxyRoute`" is false for Gemini. The probe avoids printing the key (`probe.ts:151-153`). | none |
| 22 | No silent cross-account fallback | ADR-0003 invariant 3 | `providers/gateways.ts:113-126`; `providers/targets.ts:337-349`; `route-resolver.ts:269-286` | `tests/unit/providers/targets.test.ts`, `accounts.test.ts` | partial | Unknown ids fail closed. **But credential env names can collide:** `perGatewayEnvVar` (`providers/gateways.ts:76-78`) upper-cases and maps every non-`[A-Z0-9]` to `_`, and gateway ids are unconstrained (`src/config/schema.ts:180`, `z.string().min(1)`). So `work-1`, `work.1`, `Work_1` share `GOLEM_UPSTREAM_API_KEY__WORK_1`. `credentialEnvForProxy` keeps the first one (`gateways/credentials.ts:78-83`), so the second gateway silently authenticates with the first gateway's key. The file backend has the same problem (`backends.ts:142-144`, lower-cases). | none |
| 23 | No automated route-on-exhaustion / quota rotation | ADR-0003 Gate 1 scope OUT; invariant 5 (amend.) | `providers/routing.ts:9-26,96-129` (4 explicit levels, no rules engine) | `tests/unit/providers/routing.test.ts` | shipped-and-matches | Grep for a retry on another account on a 429 found nothing in the owned files. | — |
| 24 | Routing never silently swaps the model; the response reports the real serving model | ADR-0003 "Routing correctness rail" | `openai-translate.ts:732,790` (`parsed.model ?? fallback.model`); `openai-stream.ts:344`; `gemini-translate.ts:341`; `route-resolver.ts:288-298` | `openai-translate.test.ts`, `openai-stream.test.ts` | shipped-and-matches | | — |
| 25 | OpenRouter is translating (case b) | D48(a) | `providers/index.ts:157-166` | `index.test.ts` | shipped-and-matches | | — |
| 26 | `vendor/` prefix kept for multi-vendor gateways (`openrouter` only) | D48(b) | `providers/index.ts:208-210`; `openai-translate.ts:424-425`; `route-resolver.ts:131` | `openai-translate.test.ts` | shipped-but-drifted | Also true for `nvidia-nim` now. D48 says "true for `openrouter` only". The code looks right; the doc is stale. | none |
| 27 | Base-URL/route composition checked at config time (`upstreamRequestUrl`, `doubledVersionSegment`, `add` warns; chat-completions path tolerates a full endpoint URL) | D48(c) | `providers/index.ts:409-462`; `cli/gateways.ts:232-241`; `providers/targets.ts:386-411` | `index.test.ts`, `targets.test.ts` | shipped-and-matches | | — |
| 28 | `--model` on a byte-faithful provider warns | D48(d) | `cli/gateways.ts:207-231` | `gateways.test.ts` | shipped-but-drifted | Behaviour holds, but the flag is now `--models` (plural, comma list, `commands/gateway.ts:145`). Spawn providers are exempt since R13.13. | none |
| 29 | Probe reports the route it does not test (`requestUrl`, `configWarning` even on `accepted`); `login` prints "requests will go to" | D48(e) | `probe.ts:143-170`; `gateways/credentials.ts:143-159`; `commands/gateway.ts:111` | `probe.test.ts` | shipped-and-matches | | — |
| 30 | Proxy banner reports the resolved upstream | D48(f) | `select-target.ts:28-41` (`resolveUpstreamDisplay`) | not located | unverifiable here | The banner itself is in `src/cli/proxy-build/` (another partition). | — |
| 31 | Model ids displayed verbatim; `friendlyModelLabel`/`friendlyModelVersionLabel`/`localModelVersionLabel` deleted | D49 | `providers/model-display.ts:1-19`; `upstream-display.ts:39-66`; grep across `src/`, `tests/`, `vscode-extension/` finds zero hits for the three names | `tests/unit/providers/model-display.test.ts` | shipped-and-matches | Helpers are gone. | — |
| 32 | `golem models` prints ids verbatim | D49; `cli/models.ts:6-8` | `cli/models.ts:85` (`entry.id.slice(0, 33)`, `entry.provider.slice(0, 13)`) | `tests/unit/cli/models.test.ts` | shipped-but-drifted | Ids longer than 33 characters are **truncated** without an ellipsis, e.g. `nvidia/nemotron-3-super-120b-a12b:free` (38). That directly contradicts the file's own header and D49. | none |
| 33 | `claude-cli` provider retired by R13.12, no live path left | brief "Also verify"; R13.12 | `providers/index.ts:122-126,149-151,188,258-262,331-334`; `mcp-serve.ts:9,120-122`; `inference/target-dispatcher.ts:486-491,659,902,920`; `inference/claude-cli.ts:103,224` | — | not-started | The retirement was **never done**. R13.12 (done) explicitly split removal into R13.14 (`state: queued`, blocked on a live delegation check); see verification-notes §145. The whole spawn path is live and reachable from `coder`. | R13.14 |
| 34 | Account switching writes a non-secret selector | ADR-0003 Scope IN; D46 | `cli/gateways.ts:141-154` (writes `inference.model`, local scope) | `gateways.test.ts` | shipped-but-drifted | ADR-0003 and D46 describe switching the *account*. Since R9.1/R9.23/R10.24 the selector is `inference.model` and accepts a gateway id, a target id, or the default id. No owned doc records the key. | none |

Bucket totals (34 rows): shipped-and-matches **15**, shipped-but-drifted **14**,
partial **2**, not-started **2**, dead-or-superseded **0**, unverifiable **1**.

## Undocumented

Exported behaviour in owned files that no owned doc mentions:

- `src/providers/routing.ts` — the four-level route precedence (virtual `golem/<id>`
  model → `x-golem-target` header → conversation binding → `inference.model`).
  Documented only in `docs/plan/proposals/multi-target-routing.md`, not in the spec or ADR-0003.
- `src/providers/targets.ts` — the target registry, `TARGET_TRUST_LEVELS`,
  `defaultTrustFor` (loopback → `local`, else `lan`/`third-party`), and `<gateway>:<model>`
  derived ids (`:268`).
- `src/providers/index.ts:149-189` — `PROXY_PROVIDERS`, `isSpawnProvider`, `isKeylessProvider`;
  `:307-336` `originationAuthScheme` (R13.11); the `llamacpp` and `nvidia-nim` providers.
- `src/credentials/store.ts:88` / `backends.ts:93` — batched `resolveMany`/`getMany` (R9.20).
- `src/cli/gateways/credentials.ts:220-233` — N credentials injected into the daemon
  (R9.1). The larger blast radius is recorded in a code comment, not in ADR-0003.
- `src/cli/targets.ts` — `golem target list|show|add|test`.
- `src/cli/models.ts` — `golem models` / `refresh` rendering (R8.8).
- `src/cli/upstream-display.ts` — `upstreamLabel` host → name mapping (`azure` → `foundry`).
- `src/providers/target-settings.ts` — `withDefaultTarget`.
- `src/providers/openai-translate.ts` — `countTokensResponse` (R10.15), `EmptyCompletionError`,
  vision gating (R10.14), reasoning mapping.

## Dead candidates

- `resolveModel` (`src/providers/targets.ts:195-202`). Re-exported from `src/proxy/index.ts:48`,
  but a grep of `src/`, `tests/` and `vscode-extension/src` finds no caller. Its only other mention is
  the stale doc comment at `targets.ts:300-305`.
- `ResolvedTarget.contextSize` (`targets.ts:108-109`). Never assigned: `toResolved`
  (`:208-225`) does not set it, and `entry.model?.name` (`:284`) drops the descriptor's
  `contextSize`. The context monitor/guard read the descriptor from elsewhere.
- `DEFAULT_KEY_ENV` / `envVarForGateway` remain, correctly, as the internal handoff (D47). Not dead.

## Stale comments

- `src/cli/gateways.ts:66`: "(`golem gateway login <id>` or exporting the env var)". Env
  was removed by D47, and the thrown message (`:134-136`) rightly omits it.
- `src/cli/gateways.ts:168,181,196,265,291`, `gateways/registry.ts` throughout: "`account login`",
  "`account use`", "`account add`", "`account remove`". Those commands are `gateway …`.
- `src/cli/gateways/credentials.ts:220-226`: calls the helper `perGatewayEnvVar`, but the code
  uses `envVarForGateway` (which delegates to it).
- `src/credentials/index.ts:12-13`, `store.ts:32-33`: "no MCP/tool surface imports any of
  this". False (row 20).
- `src/credentials/backends.ts:9-10`: "Windows DPAPI via `powershell.exe`". The code prefers `pwsh.exe` (`:383`).
- `src/cli/route-resolver.ts:23-25`: "no key is ever … placed on a `ProxyRoute`". False for Gemini (row 21).
- `src/cli/commands/mcp-serve.ts:62-64`: says `credentialEnvForProxy` "encodes which store id backs
  the active account". When `inference.model` is a target id, it looks up the *target* id as a store id
  (`gateways/credentials.ts:246`), which never exists. This is harmless only because `accountsReferencedByTargets`
  also injects the backing gateway. Compare `useGateway` (`gateways.ts:116-118`), which does map target → gateway.
- `src/providers/index.ts:1-16`: the module header says "Anthropic-native providers … Nothing here translates
  bodies". The module is the barrel for every translator and all case-(b) predicates.
- `src/providers/gateways.ts:41-42`: `"model[262k]"` as a supported suffix. The schema parser only accepts
  digits (`src/config/schema.ts:197`, `/\[(\d+)\]/`), so `model[262k]` becomes a model *name*
  and goes on the wire as-is. (The parser is outside this partition.)
- `src/providers/targets.ts:8-13,22-25`: a `proxy.accounts` table and "This module is inert in R9.1". It is
  `proxy.gateways` and has been routed since R9.2.
- `src/providers/targets.ts:300-305`: "may also be a bare model name … resolved via `resolveModel`". Code never does this.
- `src/cli/targets.ts:19-20`: "In R9.1 the registry is inert". `:252`: compound id `<gateway>/<model>`, but the
  separator is `:`. `:375`: "(stored now, enforced in R9.3)".
- `src/cli/gateways/registry.ts:188-193`: "`active` stays a GATEWAY id", but for a target with
  `accountId: null` it falls through to `selectedTarget.id`.
- `src/providers/openai-translate.ts:427`, `gemini-translate.ts:212`: remediation "set proxy.upstream_model"
  is wrong for gateway targets (`models[]` / `golem target add --model`).
- `src/cli/commands/gateway.ts:229`: stray apostrophe in the user-facing text, "KEPT'—". Not owned; noted for Phase 3.

## Contradictions for the human

- **C1 — Keyless gateways on the `gateway` surface.** R10.8/R13.13 decided that no credential is the
  *correct* state for `ollama`/`llamacpp` (`providers/index.ts:168-189`, `cli/targets.ts:145-151,344-356`), and
  `gateway add` tells the user there is no key to set (`commands/gateway.ts:198-203`). But `useGateway`
  refuses such a gateway without `--yes` (`cli/gateways.ts:129-139`), and `renderGateways` prints `key MISSING`
  for it (`registry.ts:221-223`). Both are pinned by tests: `tests/unit/cli/gateways.test.ts:170-176`
  and `:555-558`, using an `ollama` gateway. Either the tests encode the pre-R10.8 intent, or the
  keyless decision was meant for targets only. Which side is right is the human's call.
- **C2 — ADR-0003 invariant 4 vs R9.3 / R10.8.** The ADR says no MCP surface selects an account and
  credentials are CLI-only. The `coder` tool lets the model choose a target (`coder-tools.ts:134-156`), and the
  MCP server resolves every stored key (`mcp-serve.ts:53-78`). The same holds for `buzz/` and `portal/`. Either
  amend the ADR (as it was amended twice for D46/D47) or narrow the code.
- **C3 — D47 "exporting configures nothing" vs D47 "`??=` so the parent's value wins".** In a foreground run the two
  cannot both hold: `??=` cannot tell a parent-injected value from a hand export (`proxy.ts:215-218`).
- **C4 — "fail closed" on an unknown default target.** `renderTargets` says requests "fail closed"
  (`cli/targets.ts:366-371`), and the multi-target resolver does 400 (`route-resolver.ts:270-286`). With a
  single target there is no resolver, and `resolveActiveUpstream` falls back to the top-level config with a warning
  (`providers/gateways.ts:116-126`). Which one happens depends on how many targets exist.
- **C5 — Model-name gateway selection.** The `resolveDefaultTargetId` doc promises bare-model-name selection (`qwen3`); the code
  does not implement it (`targets.ts:307-321`). Decide whether it is wanted (and so un-dead `resolveModel`) or drop the claim.

## Cross-partition claims (unclassified)

Provider/credential claims found on pages owned by other partitions:

- `docs/wiki/concepts/Architecture.md`, `docs/wiki/WIKI.md`, `docs/wiki/sources/kimi-k3.md`, and one
  `docs/wiki/syntheses/r6-multi-pro…` page use `golem account …` (renamed to `gateway` in R9.23).
- `docs/golem-spec.md` has 4 `golem account` mentions outside the owned decisions.
- `src/config/schema.ts:196-205`: the `model[262k]` parse (see Stale comments).
- `src/proxy/context-guard.ts:118` and `src/proxy/context-monitor.ts:73`: two copies of `parseModelDescriptor`,
  which accept `k`/`m` suffixes that the schema parser does not.

## Unverifiable here

- No targeted `vitest` run: the worktree has no `node_modules` (`ERR_MODULE_NOT_FOUND`), and installing one was
  out of proportion for a read-only note. Test evidence is by reading only.
- Whether any error path serialises a Gemini `ProxyRoute` (and with it `?key=`). Not found in `src/proxy/server.ts`.
- Whether undici transport errors in `probe.ts:225-230` can echo a Gemini URL, and with it the key.
- D48(f)'s banner (`src/cli/proxy-build/`) and the macOS/Linux keychain paths (no machine for them here).
- D46's claim that a `use` switch is audit-logged "invariant 6". ADR-0003 numbers audit as invariant **5**, so
  the amendment's "(invariant 6)" at ADR-0003:182 is a numbering slip.
