# Dust Phase 3: refactor pass index

**Date: 2026-10-08.** Input: [`SUMMARY.md`](SUMMARY.md) "Phase 3 inputs" (Confirmed code bugs,
`dead-or-superseded` rows, Dead candidates in code, Stale comments) and the security mediums
S7-S21. Every item was re-verified against `development` at `97ded62` (after DUSTSEC.1-18 and the
DUST2 comment pass, PRs #213-#240). Items that no longer reproduce are listed below and have no
task. Phase-plan context: [`PLAN.md`](PLAN.md). USER decisions: [`DECISIONS.md`](DECISIONS.md).

**One approval pass needed:** the [NEEDS-USER table](#needs-user-proposals). No task deletes or
changes any of those items until the user rules on it.

## Gate (every task)

- `golem verify` exit 0 **before** starting and **after** finishing, judged by exit code.
- Suite test count does not drop, except tests whose only subject is a deleted symbol, which are
  deleted with it (named in the task).
- Bug tasks: each defect gets a regression test that fails on the pre-fix code.
- Each task runs in its own worktree and commits early on its own branch.

## Tasks

Class counts: **S** = SAFE-TO-DELETE items the task executes; **U** = NEEDS-USER proposals the
task lists and must not touch; **B** = bugs fixed.

| task | size | area (touches) | S | U | B | title |
|---|---|---|---|---|---|---|
| DUST3.1 | S | src/proxy, src/providers | 4 | 1 | 0 | Dead code: context guard/monitor, `resolveModel`, `ResolvedTarget.contextSize` |
| DUST3.2 | S | src/config, src/tui, src/cli | 5 | 9 | 0 | Dead code: `coerceLevel`, `DIM`, `_levelFallbackName`, slider-0 confirm branch, orphan comment |
| DUST3.3 | M | src/pipeline, src/plugins | 0 | 0 | 5 | Pipeline redaction correctness (S8, S10, zero-length rules, bounded problems, held stage) **HR** |
| DUST3.4 | M | src/cli status/proxy/select-target/ps | 0 | 0 | 4 | Status honesty (S11, S12) and proxy process control **HR** |
| DUST3.5 | M | proxy-daemon, prompt-guidance, route-resolver, providers/gateways | 0 | 0 | 4 | Credentials reach the proxy; S16 env collision; S21 key off the route |
| DUST3.6 | S | gateway CLI, models, credentials/store, schema | 0 | 0 | 5 | Gateway CLI papercuts (depends on DUST3.5) |
| DUST3.7 | L | src/knowledge store, auto-index | 1 | 4 | 5 | Vector store integrity (D6 lost update, D3, D4, D5, D7) |
| DUST3.8 | L | wiki-tools, src/wiki, distill, rerank, mcp-serve | 0 | 0 | 8 | Wiki write path and KB lifecycle (S13 **HR**, h5, D2, D9, D11-D14) |
| DUST3.9 | S | fast-path, headroom-adapter, context-substitution | 0 | 0 | 3 | Compression accounting (C3, C6 `router`, `ccrRefsStored`) |
| DUST3.10 | M | src/inference, src/tools, mcp snooze/coder | 1 | 0 | 4 | Inference roles (D26e), route label (C-c), bench `level` cases (h3), instrumentation (h5) |
| DUST3.11 | M | src/tasks, spawn-gate, delegation-ledger, tasks CLI | 0 | 0 | 4 | Escalation re-run, `resetAtIso`, ledger race, `--waive` |
| DUST3.12 | M | src/telemetry | 1 | 3 | 4 | Telemetry store (D3, D4, D8 NUL bytes, D11) |
| DUST3.13 | M | watch, dashboard, storage-size | 0 | 0 | 5 | Watch/dashboard CLI (D2, D5, D6, D9, D10) |
| DUST3.14 | M | src/portal, init, team | 0 | 1 | 4 | Portal/team sync honesty (D3, D6, 4xx stamping, `team sync` exit 2) |
| DUST3.15 | M | src/session | 0 | 4 | 4 | SSE cursor (D5), idempotency races (D8), host-log trim, `session forget` path |
| DUST3.16 | S | src/buzz | 0 | 3 | 2 | Buzz cancel (D7), provisioning orphans (D9) |
| DUST3.17 | S | src/vibe, scripts/release.mjs | 0 | 0 | 2 | `vibe confirm` tombstone; lockfile bump |
| DUST3.18 | L | many (comments only) | 0 | 0 | 0 | Stale comments and strings, about 110 lines across 19 dirs (depends on DUST3.1, DUST3.2) |

Totals: 12 SAFE-TO-DELETE items executed, 25 NEEDS-USER proposals (the table below plus keeps),
63 bugs across 15 bug tasks. DUST3.10's 4 bench data rows count as one SAFE item.

Ordering: everything except DUST3.6 (after DUST3.5) and DUST3.18 (after DUST3.1-3.2, and after
DUST3.8 for `wiki-tools.ts`) can run in parallel. Expect textual rebases where DUST3.18 meets a
bug task's file.

## NEEDS-USER proposals

Approve, change or reject per row. "Keep" rows are listed so the record is complete; approving
them means no work.

| # | item | file:line | evidence | recommendation |
|---|---|---|---|---|
| 1 | S9: object keys never redacted (**HR**) | `src/pipeline/redaction.ts:304-307` | `redactValue` recurses values only; probe: an AWS-key-shaped key survives with count 0 | Redact keys that match a rule, behind a recorded-shape test; a new DUST3 task |
| 2 | S17: `security.*` not on `REMOTE_DENIED_SETTINGS` (exception P4) | `src/config/loader.ts:144-153` | A team admin can switch on `security.join_injection` / `write_lan` on members' machines | Add both keys (or `security.*`) to the deny list |
| 3 | S18 + DUST1.8 h3: enforced team policy reach (exception G3) | `src/portal/team-layer.ts:596`; only `status-collect.ts:145`, `commands/proxy.ts:192` use it; hot reload `proxy-runtime.ts:225` drops it | Team `redaction.*`/`compression.*` not honoured in hooks, MCP, `acp`, session host, config UIs | Route every config load, including hot reload, through the team-aware loader |
| 4 | `/__golem/statusline` unauthenticated (LOW) | `src/proxy/server.ts:189-200` | No auth or origin check | Loopback-only plus a local token, or serve non-sensitive fields only |
| 5 | Passcode factor has no attempt limit (LOW) | `src/security/user-factor.ts:157` | Only local caller found (`device.ts:180`) | Add a failed-attempt counter with backoff |
| 6 | `slider` MCP prompt (exception M2) | `src/mcp/prompts.ts:13-39`; `mcp-server.test.ts:366-372`; "8 frozen prompts" `server.ts:65` | Drives the unregistered `level` tool | Delete; count becomes 7; spec §2.1 updated |
| 7 | `StageConfig.semanticCache` / `SemanticCache` | `src/interfaces/policy.ts:120,135` | Frozen contract; written, never read | Remove in a contract-change task |
| 8 | `SemanticCompression "low_relevance"` + worker preset | `src/interfaces/policy.ts:117`; `headroom-worker.py:244` | No `LEVEL_TABLE` row produces it | Remove with #7 |
| 9 | `knowledge.vector_db_url` + Qdrant branch | `src/config/schema.ts:479`; `src/knowledge/index.ts:177-182` | Public key, no reader; branch only throws | Retire via `RETIRED_SETTINGS`, delete branch |
| 10 | `HaikuFallbackRequired` / `allowHaiku` | `src/inference/service.ts:42,50,141`; `index.ts:74` | Always false; no config key; no catch | Delete; spec §2.2 claim to not-started register |
| 11 | `coderRouteConflict` second branch | `src/inference/coder-route.ts:184-192` | Fires only on whitespace asymmetry | Trim both sides, delete branch |
| 12 | C-b: second coder resolution chain | `src/inference/coder-route.ts:93-160` | Divergent copy of `persona-lane` | Refactor task: delegate to `persona-lane` |
| 13 | `ApplyControlOptions.initProbe` | `src/config/control-surface-types.ts:197` | Read nowhere; a test fixture sets it | Delete with the fixture line |
| 14 | `SettingMeta.ownedBy` (G26 / D50(a), h5) | `src/config/ui-model.ts:149` | Never set; duplicate rows; vacuous test | Populate on the three runtime-owned keys and fix the test |
| 15 | `resolvePersistedEmbedMode` | `src/cli/auto-index.ts:136` | Test-only | Delete with its describe block and the comment at `proxy-runtime.ts:115` |
| 16 | `isPdfExtractionAvailable` | `src/knowledge/extractors.ts:52` | Test-only; comment false | Delete with its test case |
| 17 | `aggregateUsageByLevel`, `usageReportRows` | `src/telemetry/jsonl-store.ts:615`, `usage-report.ts:53` | Test-only slider A/B readers | Delete readers and tests; keep the writer |
| 18 | `GolemState.tokensBefore/After` + per-prompt `aggregate()` (D7) | `src/cli/statusline.ts:134-135,912-914` | Never rendered; served on `/__golem/statusline`; pinned `statusline.test.ts:786` | Compute only for the endpoint, not on every prompt |
| 19 | `FileJoinQueue.prune` (**HR** area) | `src/session/join-queue.ts:284` | No caller, no test | Wire on queue open |
| 20 | Gateway descriptor `contextSize` key | `src/providers/gateways.ts:57`; `schema.ts:189,253` | Validated, never read (its only reader is the dead guard/monitor) | Keep as reserved, or retire |
| 21 | Dead `~/.golem` scan in `collectProxies` | `src/cli/commands/ps.ts:290-304` | Comment (`:333-342`) says it never finds anything | Delete the loop with a test that `ps` output is unchanged |
| 22 | Chars/4 estimator copies | `src/prompt/compact.ts:71`, `src/pipeline/brevity.ts:154`, `src/mcp/in-memory-compression.ts:38` | Redundant, lack `max(1)` | Consolidate later; keep now |
| 23 | Account control ignores `_scope` (new, not in audit) | `src/config/control-surface-runtime.ts:78` | Advertises three writable scopes, writes one | Advertise only the real scope, or honour it |
| 24 | `aggregateUsageBySemanticForced`, `aggregateAvoidedUpstream` | `src/telemetry/jsonl-store.ts:642,739` | Staged for R2.6 / wanted by DUST2.18 | Keep |
| 25 | Buzz R14.2-R14.4 staged code (`provisionBuzz` et al., `golemHarnessDefinition` + D11, `postChannelMessage`/`recordDeferred`) | `src/buzz/*` | No CLI yet; queued tasks name them | Keep; D11 fixed inside R14.3 |

Keep, no action (contract-bound, test fixtures or live): `StageConfig.toolResultCache` (live on the
MCP path), `HEADROOM_CLIENT_NPM_PIN` (pin guard), `HeadroomSidecar.health()` (test probe),
`LocalDirBlobStore.stream/delete` (`BlobStore` contract), `InMemoryVectorDriver`,
`ZONE_FOR_TYPE.adr`, `identityRedact` (test seam, HR), `listConversations` (frozen interface),
`hostSessionLogPath`, `init-team.ts:197` catch, `HostAttachment.attached` path,
`DesiredAgent.discipline`, `unknownWorkerWarnings`, `liveStatsSource`.

## Excluded: already tracked elsewhere

| audit item | tracked by | why |
|---|---|---|
| Whole-body `JSON.stringify` re-serialise (1.1 r098) | DUST2.24 / decision C1 | Hard rule reworded to lossless and prefix-stable; recorded-shape tests guard it |
| h9 `OUT_DIR=<path>` over-redaction | DUST2.23 | Path-like tokens are its scope (its brief's anchor `redaction.ts:351-373` is now `redaction-rules.ts:367-383`) |
| Keyless gateway `use`/`list` (V1) | DUST2.2 decision | Doc follows code; intended |
| User wiki wins title collisions (D1) | DUST2.5 decision K2 | Intended |
| CCR bridge pairs by index | DUST2.20 | Compression gating completeness |
| D10 rebuild deletes first / checkpoint at end | DUST2.14 | Resumable ingest checkpoints |
| D8 web-cache freshness | DUST2.13 | Its scope |
| W8 / S19 owner:user dispatch | DUSTSEC.11 / 17 | Fixed |
| Row 30 `spawnResume` failure; session-report H5 | `dust-comment-pass-code-defects` | Queued |
| Row 26 quoted scalars | `roadmap-generator-quoted-titles` | Queued |
| Row 27 `task resume` for plan tasks; task `worktree` fields; `plan-task.ts:25` comment | DUST2.12 | Queued |
| Non-atomic version writes; `release-prepare.yml:92-94` comment | DUST2.21 | Queued |
| `applyControl` writes to locked controls; false "overridden" for personas | DUST2.16 | Queued |
| `/interrupt` answers 501 | DUST2.19 | Queued |
| `schema.ts:480` watch_paths comment | DUST2.14 | Becomes true when it lands |
| Plugin diagnostics UX | DUST2.11 | DUST3.3 only bounds the array |
| Buzz Desktop harness cannot start (D11) | R14.3 (not on the named exclusion list) | Staged code; R14.3 step 7 installs the harness |
| `wiki-check-unlisted-pages`, `stale-committed-to-git-claims` | themselves | No overlapping audit item found |

## Not reproduced (no task)

Re-verified 2026-10-08. These no longer reproduce, or cannot be reproduced here. 52 items.

- **Bugs (9):** S7 `x-golem-bypass` (DUSTSEC.2); S14 plugin rules on every path (DUSTSEC.8); S15
  vibe files (DUSTSEC.9); S19 owner:user (DUSTSEC.11/17); S20 invalid team value stops proxy
  (DUSTSEC.14); DUST1.1 h7 shim compresses (DUSTSEC.12); DUST1.5 h1 `coder` `outputSchema` (now
  declares every key); DUST1.6 C-a / DUST1.8 h4 `worker_targets` retirement (DUSTSEC.13); DUST1.10
  D10 `session host stop` on Windows (suspected only; needs a Windows run, not reproducible on this
  Linux host).
- **Dead candidates (9):** `bypass` prompt persistent branch (rewritten); `P1_TOOL_FALLBACK`
  "not shipped" (reworded); `RETIRED_SETTINGS` `worker_targets` entry (removed); migration-test skip
  branch (removed); `WriteServerOptions.stepUpPaths` (now passed, `session-host.ts:292`);
  `appendTurn`/`readConversation` (used since R13.8); `liveStatsSource` (live fallback);
  `DesiredAgent.discipline`/`unknownWorkerWarnings` (live); code side of G02, r018, r037, r048, G38
  (`search_local`, `get_original`, `golem_set_slider`, `eol_set_slider`, `slider-read.ts`,
  `localResponse`: 0 hits).
- **Stale comments (34):** fixed or gone at `pipeline.ts:14`; `proxy-runtime.ts:139-143,201-202`;
  `sidecars.ts:44`; `server.ts:11-13`; `policy.ts:19`; `commands/proxy.ts:4-6,118-121,185-186,214,560`;
  `gateways/registry.ts` account names; `providers/targets.ts:300-305`; `gateway.ts:229`;
  `native-lossless.ts:378`; `prompts.ts:95`; `persona-lane.ts:37-39`; `workers.ts:22-28,76`;
  `migrations.ts:156-159`; `capability.ts:10-15`; `pre-tool-use.ts:65-66` and its test;
  `loader.ts:367-370`; `update/index.ts:6,174,22` and installers; `stats.ts` LIVE_STATS_NOTE;
  `identity.ts:98-100`; `prompt-guidance.ts:355-356`; `target.ts:154`; `select-target.ts:23-26`;
  `ps.ts:5` (its test exists now); `team.ts:4-7,75-82,447`; `session.ts:1-7`; VS Code `setAccount`.

## Where current code contradicts the audit

- **`persona_worker` in `selectTarget` is not dead code to delete.** It is the right label for a
  persona-sourced route (C-c), so DUST3.10 revives it.
- **`policy.ts` moved to `src/interfaces/policy.ts`.** Every `StageConfig` dead candidate is now a
  frozen-contract item, so it is NEEDS-USER, not SAFE.
- **`src/telemetry/jsonl-store.ts` and `cost-benchmark.ts` contain literal NUL bytes**, so `rg`/`grep`
  treat them as binary. The audit's greps never saw the `aggregate*` definitions there. DUST3.12 fixes
  the bytes first.
- **S12 is worse than written.** `bypass_all` runs a normal daemon, not the shim, so
  `golem proxy status` says "Pipeline is active" while redaction is off.
- **`pipeline.ts` (~596) claims redaction is idempotent**; S10 shows it is not.
- **Not provably dead:** the `init-team.ts:197` catch branch, and the `coderRouteConflict` second
  branch (whitespace).
- **`GolemState.tokensBefore/After` is served** on `/__golem/statusline`, not merely unrendered.
- **`sidecars.ts:65` is wrong about the default:** `local_answer_enabled` is ON.
- **ADR-0007 is self-inconsistent** (rule 7 in its list, "invariant 8" at `:167,:329`). The code
  copied the 8. That is a doc fix, outside Phase 3.
- **The lockfile is in sync today** (0.54.3, `@pliable/golem`). The defect is that `release.mjs`
  will drift it at the next release.
- **`vscode-extension/src` does not exist.** Extension code is `vscode-extension/*.js`, which was
  grepped instead.
