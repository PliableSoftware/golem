---
task: dead-code-delete-rows
title: "Delete the dead public surface the Phase 3 audit recommended deleting (USER decision DEAD)"
state: queued
owner: agent
size: L
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md DEAD (USER, 2026-10-09); the NEEDS-USER proposal table in docs/plan/audit/dust-1/PHASE3-INDEX.md (25 rows: public config keys, CLI commands, MCP surface, plugin seams, frozen-interface fields), each with evidence and a recommendation; docs/plan/tasks/DUST3.1.md, DUST3.2.md and the other DUST3.* briefs for the per-area evidence."
gate: "Only the rows whose recommendation is delete are executed; every 'keep' row is left alone and recorded as deliberately kept; each row is RE-VERIFIED against the current code first (the table predates a lot of merged work) and dropped with a note if it no longer holds; one reviewed PR per area (config, CLI, MCP, plugin seams, frozen interfaces), never one giant PR; for each deletion a grep proof over src, tests, docs, skills and the VS Code extension shows zero references including string lookups and dynamic imports; a config key being deleted keeps being ACCEPTED on read with a one-time deprecation warning for one release if the audit shows any user could have set it (never a hard failure on an old settings file); a deleted CLI command or MCP tool has its help, skills, wiki pages and generated files updated from source; frozen-interface changes carry the contract amendment and updated contract tests and are called out in the PR; test count drops only by tests of deleted symbols (state which); golem verify exit 0 per PR; an independent read-only review before merging any PR that touches src/interfaces or a public surface."
depends_on: []
touches: [src/config, src/cli, src/mcp, src/plugins, src/interfaces, docs, tests]
created: 2026-10-09
---

## What this is

The user approved executing the delete rows. Start by reading the table and writing, in this task, a list of the rows you will execute and the rows you are leaving, with one line of evidence each, and commit it before deleting anything so the decision is reviewable. Do the zero-risk rows first. Anything a test pins as intended behaviour needs the test rewritten or the row dropped with a reason.

## Out of scope

- The 'keep' rows and anything not in the table.
- Renames or refactors beyond deletion.

## Execution list

Re-verified 2026-10-09 against `development` at `b73c7888`, by grep over `src`, `tests`, `docs`,
`.claude`, `vscode-extension`, `scripts` and `package.json` (there is no top-level `skills/` dir; skill
text lives under `src`). String lookups, dynamic imports and config-key reads were included. The
table is `PHASE3-INDEX.md` "NEEDS-USER proposals" (rows 1-25); rows 1-5, 12, 14, 18, 19, 23 are
fixes or wiring, not deletions, and are out of scope here (see LEFT).

Corrections the re-verify turned up:

- **Row 9's recommendation conflicts with this task's gate.** `RETIRED_SETTINGS`
  (`src/config/migrations.ts:91`) makes a retired key RAISE on load (`retirementMessage`, "raises rather
  than ignoring"). The gate forbids a hard failure on an old settings file. Row 9 therefore needs a
  warn-and-ignore path instead; do NOT use `RETIRED_SETTINGS`.
- **`TEAM_POLICY` is `Record<LeafPath, TeamRule>`** (`src/config/team-policy.ts:61`), and
  `knowledge.vector_db_url` is `D` (denied to team admins) with a test pinning it. While the key is
  still accepted it must keep that entry.
- Row 6 is already shipped (commit `69bd1c06`).

Rows marked **NEEDS-REVIEW** touch `src/interfaces/`, a documented setting or a documented command;
they get the independent read-only review before merge. None touch redaction or credentials.

### Rows to EXECUTE

PRs, one per area: (1) config, (2) CLI and internal test-only exports, (3) inference, (4) frozen
interfaces. No plugin-seam row is in the table and the one MCP row (6) already shipped, so there is
no plugin or MCP PR.

| area | # | evidence | what is deleted | tests that pin it | config deprecation | risk |
|---|---|---|---|---|---|---|
| config | 13 | `ApplyControlOptions.initProbe` declared `src/config/control-surface-types.ts:197`, read nowhere in `src` (`applyRuntime` uses `setDial`, no init probe) | the field, its doc comment (`:184-196`), the `InitProbe` type import (`:4`) if then unused; the `initProbe` fixture and its `OPTS` entry in `tests/unit/control-surface.test.ts:42-53` | `tests/unit/control-surface.test.ts` (fixture only; no assertion on it) | none (type field, not a setting) | Zero. Check `InitProbe` import is still used elsewhere in the file before dropping it |
| config | 9 **NEEDS-REVIEW** (documented setting) | `knowledge.vector_db_url`: `schema.ts:524`, `ui-model.ts:425`, `team-policy.ts:98`; only reader is `openKnowledgeBase` `selectDriver` (`src/knowledge/index.ts:181`), which throws `NotImplementedYetError`; no caller in `src` passes `vectorDbUrl`; spec already says "not implemented" (`golem-spec.md:159,169`) | `OpenKnowledgeBaseOptions.vectorDbUrl` (`index.ts:146`) and the throwing branch (`:181-185`), its doc lines (`:143,161-162`); `ui-model.ts` entry; stale Qdrant wording in `knowledge/driver.ts:7`, `schema.ts:20,523`, `interfaces/knowledge.ts:5` (comment only) | `knowledge.test.ts:133` (delete, subject is the branch); `config-ui-model.test.ts:95` (drop the `kindOf` line); `team-policy.test.ts:105` (KEEP while key is accepted) | **YES.** A user could have set it (it is a public, documented key, and a URL that never worked). Keep it in the schema as accepted-and-ignored (loosen to `z.string().optional()` so an old malformed value cannot fail), emit a one-time deprecation warning, remove after one release. NOT `RETIRED_SETTINGS` (raises). Published `config-schema.json` is regenerated at release; mark the key deprecated there | Medium. Documented user-facing key and a team-policy security entry; the warn-only mechanism is new code, so it needs its own test. Spec/`CLAIMS.md`/verification-notes mentions are dated history, leave those |
| CLI / internal | 15 | `resolvePersistedEmbedMode` `src/cli/auto-index.ts:137`: only references are its own describe (`auto-index.test.ts:85-103`), a comment `proxy-runtime.ts:108`, and a name map in the one-shot refactor script `scripts/extract-commands.mjs:118` | the function; the `describe("resolvePersistedEmbedMode")` block (3 cases) and its import; reword the comment at `proxy-runtime.ts:108` (the proxy resolves the mode from the persisted manifest another way); drop the name from `scripts/extract-commands.mjs:118` (string only, script is not in `package.json`) | `tests/unit/cli/auto-index.test.ts` (3 cases, all of the deleted symbol) | none | Low. Confirm the manifest reader it wraps (`writeManifest` sibling) keeps another caller |
| CLI / internal | 16 | `isPdfExtractionAvailable` `src/knowledge/extractors.ts:51`: no `src` caller; one test; comment's "golem ext registry" claim is false | the function | `tests/unit/knowledge/extractors.test.ts:117` (one case, `it("reports PDF extraction as available…")`; keep the sibling "unavailable error" case) | none | Low. `loadUnpdf` stays (used by extraction) |
| CLI / internal | 17 | `usageReportRows` `src/telemetry/usage-report.ts:53` and `JsonlTelemetryStore.aggregateUsageByLevel` `jsonl-store.ts:645` (+ `TelemetryStore` member `types.ts:267`): no `src` caller outside the barrel; only tests call them. `aggregateUsageBySemanticForced`/`aggregateAvoidedUpstream` (row 24) are NOT touched | `usageReportRows`, `LevelReportRow`, `aggregateUsageByLevel` impl and interface member; `UsageByLevel` type and barrel exports (`telemetry/index.ts:62,70,73`) if no remaining user; stale comments (`jsonl-store.ts:301`, `index.ts:154`). The usage-event WRITER (`recordUsageEvent`) stays | `jsonl-store.test.ts` describe at `:251` (9 refs: roll-up per level, scope, empty, old-lines cases; those whose only subject is the reader are deleted; keep any case that asserts the gross-token `aggregate()` is unaffected by usage events, `:316`, rewritten without the reader); `usage-report.test.ts` (the `semanticForcedReportRows` cases stay; only a title mentions the deleted fn) | none | Low-medium. Any mock `TelemetryStore` elsewhere would break at compile time: none found, `tsc` is the proof. Check no hand-written `UsageByLevel` consumer in `vscode-extension` (none found) |
| CLI | 21 **NEEDS-REVIEW** (documented command `golem ps`, behaviour unchanged) | `collectProxies` `src/cli/commands/ps.ts:292-310` scans `~/.golem/<name>/.golem/proxy.pid`; nothing registers a project there (`~/.golem` holds shared state); the comment at `:333-342` says the same for the sibling mcp scan | only the "2. Check user's .golem" loop in `collectProxies` (the current-project lookup stays). The matching loop in `collectMcpServes` (`:353-362`) is NOT in the row; leave it | none targeted (`ps-kinds.test.ts`, `ps-package-name.test.ts` cover other paths). Add one test that `collectProxies` output is unchanged for a current-project pid file | none | Low. Needs the "ps output unchanged" test the row asks for; `collectProxies` is module-private, so test via `ps --json` or export for test |
| inference | 10 | `HaikuFallbackRequired`/`allowHaiku`: `src/inference/service.ts:42,50,92,141`; barrel `index.ts:76`; no config key, no `src` constructs `fallback:` with it, nothing catches the error | `allowHaiku`, `#allowHaiku`, the `HaikuFallbackRequired` class, its barrel export, the `if (this.#allowHaiku)` throw (`:141-143`); `FallbackPolicy.stepDownTier` STAYS (live, `:106`). Spec `golem-spec.md:157,634`: reword the "Haiku via API" ladder as a not-started item | `tests/unit/inference/service.test.ts`: `:128-136` case (delete); `allowHaiku: false` options at `:103,:118` (drop that key only; cases stay) | none (not a settings key) | Low. Public barrel symbol, but no consumer in repo |
| inference | 11 | `coderRouteConflict` `src/inference/coder-route.ts:167`: the second branch (`:181-192`) compares `workerTargetFromPersona(...)` with `defaultCoder`, and `mcp-serve.ts:270` sets `defaultCoder` to the same `personaModel`, so it differs only on whitespace (`configured` is `.trim()`ed, `fromPersonaWorker` is not). Still holds on current code | the second branch. Also trim `fromWorker` in branch one (it falls back to the same untrimmed persona model, so the same whitespace asymmetry makes a false "worker_targets wins" report) | `coder-route.test.ts:157-185` (2 cases, neither exercises branch two; stay green) | none | Low. Behaviour change is limited to removing a false conflict on whitespace; add one case: padded persona model reports no conflict |
| frozen interfaces | 7 **NEEDS-REVIEW** (`src/interfaces/`) | `StageConfig.semanticCache` + `SemanticCache` type `src/interfaces/policy.ts:120,135,147-173`, barrel `interfaces/index.ts:51`: written per level, read nowhere in `src` (spec `:195` already calls it a dead field) | the field in all four `LEVEL_TABLE` rows, the `SemanticCache` type, its barrel export. `toolResultCache` stays (live on MCP path). Spec `:195,225,226,311,685` and `docs/marketing/CLAIMS.md`: reword; wiki synthesis/source pages are dated history, leave | `tests/contract/policy.contract.test.ts:56,70,76` (three `semanticCache` assertions; amend the contract tests) | none | Medium. Frozen contract: needs the amendment note in the PR and the independent review; no `StageConfig` literal in `tests/` sets it (grep), `tsc` confirms |
| frozen interfaces | 8 **NEEDS-REVIEW** (`src/interfaces/`) | `SemanticCompression "low_relevance"` `policy.ts:117`: no `LEVEL_TABLE` row produces it; the only other occurrence is the worker preset `src/compression/headroom-worker.py:244`; no test or doc references it | the union member and the `"low_relevance"` entry of `_MODE_PRESETS` (unknown modes already fall back to `stale_turns`, `:252`) | none (`headroom-worker-selftest.py` uses `stale_turns` only) | none | Medium-low. Ride with row 7 as one interface PR. Python worker is a pinned-Headroom adapter file: run the worker self-test |

Counts: 10 EXECUTE rows. config 2 (13, 9), CLI and internal 4 (15, 16, 17, 21), inference 2 (10, 11),
frozen interfaces 2 (7, 8), plugin seams 0, MCP 0 (row 6 shipped). NEEDS-REVIEW: 7, 8, 9, 21.

Order, zero-risk first: 13, 16, 15, 11, 10, 17 (tests-only subjects), then 21, then 9, then 7+8.

### Rows LEFT

| # | row | disposition | reason |
|---|---|---|---|
| 6 | `slider` MCP prompt | **DROPPED: already shipped** | Commit `69bd1c06` removed it; `prompts.ts` registers 7, `mcp-server.test.ts:111` says "7 frozen prompts". Residue to fix inside the CLI PR, not a deletion: `src/mcp/server.ts:65` still says "8 frozen prompts" |
| 20 | gateway descriptor `contextSize` key | LEFT: recommendation is "keep as reserved, or retire", not delete | Not a delete row; no instruction to retire it. Left alone |
| 22 | chars/4 estimator copies | KEPT (recorded) | Recommendation is keep and consolidate later |
| 24 | `aggregateUsageBySemanticForced`, `aggregateAvoidedUpstream` | KEPT (recorded) | Staged for R2.6 / DUST2.18. Row 17 must not remove them or their `UsageBySemanticForced` types, which share `usage-report.ts` |
| 25 | Buzz R14.2-R14.4 staged code | KEPT (recorded) | Queued tasks name it; D11 is fixed inside R14.3 |
| 1-5 | S9 key redaction, S17 deny list, S18 team policy reach, statusline auth, passcode limit | NOT DELETE | Behaviour changes with HR/security scope, each its own task |
| 12 | second coder resolution chain | NOT DELETE | Refactor onto `persona-lane` |
| 14 | `SettingMeta.ownedBy` | NOT DELETE | Recommendation is populate and fix the test |
| 18 | `GolemState.tokensBefore/After` | NOT DELETE | Recommendation is compute only for the endpoint; the field is served on `/__golem/statusline` |
| 19 | `FileJoinQueue.prune` | NOT DELETE | Recommendation is wire it on queue open |
| 23 | account control ignores `_scope` | NOT DELETE | Advertise or honour the scope |
| keep list | `toolResultCache`, `HEADROOM_CLIENT_NPM_PIN`, `HeadroomSidecar.health()`, `LocalDirBlobStore.stream/delete`, `InMemoryVectorDriver`, `ZONE_FOR_TYPE.adr`, `identityRedact`, `listConversations`, `hostSessionLogPath`, `init-team.ts:197` catch, `HostAttachment.attached`, `DesiredAgent.discipline`, `unknownWorkerWarnings`, `liveStatsSource` | KEPT (recorded) | Contract-bound, test seams or live, per `PHASE3-INDEX.md` |

No delete row was found to no longer hold except row 6. Note for the CLI PR: the row-21 `~/.golem`
scan in `collectMcpServes` (`ps.ts:353-362`) is the same dead shape but is outside the 25-row table,
so it is not touched here.
