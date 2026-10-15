---
task: DUST3.2
title: "Dead code (config, tui, cli): delete coerceLevel, DIM, _levelFallbackName, the slider-0 confirm branch and an orphaned doc comment; table the public leftovers for the user"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/PLAN.md Phase 3; SUMMARY.md 'Dead candidates in code' DUST1.1, DUST1.5, DUST1.6, DUST1.8, DUST1.9; re-verified 2026-10-08 in docs/plan/audit/dust-1/PHASE3-INDEX.md"
gate: "golem verify exit 0 before AND after (exit code); suite test count unchanged; every SAFE-TO-DELETE item gone and its grep proof returns zero hits; no NEEDS-USER item touched."
depends_on: []
touches: [src/config/control-surface-types.ts, src/tui/state.ts, src/tui/ansi.ts, src/cli/session-report.ts, src/cli/proxy-runtime.ts]
created: 2026-10-08
updated: 2026-10-08T18:33:42.186Z
---

## What this is

Dust Phase 3 deletion pass for the config, TUI and CLI leftovers of the retired slider. Each
item was re-verified on 2026-10-08. Re-run each proof before deleting; if a reference has
appeared, stop and report.

Work in your own worktree (`git worktree add ../golem-dust3-2 -b dust3-2 development`), commit
each deletion as you go.

## SAFE-TO-DELETE (execute)

Criteria as in DUST3.1 (zero references in `src/ tests/ scripts/ vscode-extension/` apart from
the definition; not public; not under `src/interfaces/`; no dynamic or string lookup).

| # | item | where | proof (command → result) |
|---|---|---|---|
| 1 | `coerceLevel` (also carries wrong text: "expected 0–3", key `slider.level`) | `src/config/control-surface-types.ts:205-213` | `grep -rnw --exclude-dir=node_modules coerceLevel src tests scripts vscode-extension` → 1 hit (definition) |
| 2 | `DIM` | `src/tui/ansi.ts:22` | `grep -rnw DIM src` → 1 hit (definition). The `DIM` in `tests/integration/knowledge-persistence.test.ts:28` is an unrelated local constant |
| 3 | `_levelFallbackName` (also names retired "passthrough") | `src/cli/session-report.ts:234` | `grep -rnw _levelFallbackName src tests scripts` → 1 hit (definition) |
| 4 | Enum branch of `needsConfirm` (`String(value) === "0"`, slider level 0) and its "Slider level 0 is the passthrough bypass" doc line | `src/tui/state.ts:363-367` | Unreachable branch, not a symbol: `grep -n 'danger:' src/config/ui-model.ts` → 4 controls (`:168,548,557,603`), all boolean leaves (`security.write_lan`, `security.join_injection`, `telemetry.dashboard_lan`, …); no enum control carries `danger`. After removal an enum would fall through to `truthy(value)`, which prompts more, never less |
| 5 | Orphaned doc comment for a deleted slider-store field ("When present, the level is re-read from this store on EVERY request") | `src/cli/proxy-runtime.ts:100-105` | `grep -n 'When present, the level is re-read' src/cli/proxy-runtime.ts` → 1 hit, no field follows it. Comment-only |

Note: `src/cli/session-report.ts` is also touched by `dust-comment-pass-code-defects`
(a different line). Rebase rather than resolve by hand if both are in flight.

## NEEDS-USER (proposals only, do not delete)

These are public, contract-bound, test-pinned or hard-rule items in this task's area. They are
collected with all the others in `docs/plan/audit/dust-1/PHASE3-INDEX.md` for one approval pass.

| item | file:line | evidence | recommendation |
|---|---|---|---|
| `ApplyControlOptions.initProbe` | `src/config/control-surface-types.ts:197` | Nothing in `src/` reads it; `tests/unit/control-surface.test.ts:42,53` builds it into a fixture | Delete the field and the fixture line (test count unchanged) |
| `SettingMeta.ownedBy` (G26 / D50(a), DUST1.8 h5) | `src/config/ui-model.ts:149`; filter `src/config/control-surface-settings.ts:50` | Never set anywhere in `src/`, so duplicate runtime/setting rows remain; `config-ui-model.test.ts:44` passes vacuously | Populate it on `compression.level`, `inference.model` and `brevity.level` and make the test non-vacuous (behaviour task), or delete field, filter and test |
| `slider` MCP prompt (contradiction M2, left to the user) | `src/mcp/prompts.ts:13-39` | Tells the model to use the `level` tool, which is not registered; pinned by `tests/integration/mcp-server.test.ts:366-372`, and "all 8 frozen prompts" (`src/mcp/server.ts:65`, `prompts.ts:2`, `mcp-server.test.ts:46`) counts it | Delete the prompt, make the count 7, update spec §2.1 (`docs/golem-spec.md:274`) |
| `HaikuFallbackRequired` / `FallbackPolicy.allowHaiku` | `src/inference/service.ts:42,50,141`; barrel `src/inference/index.ts:74` | No construction site passes `fallback`, so `allowHaiku` is always false; no catch site; no config key | Delete, and move spec §2.2 "Claude Haiku via API if the user allows" to the not-started register |
| `coderRouteConflict` second branch | `src/inference/coder-route.ts:184-192` | Both sides come from the same persona value; it fires only when the model string has surrounding whitespace (trim asymmetry), and the message compares a key with itself | Trim both sides and delete the branch |
| `coder-route.ts` second resolution chain (C-b) | `src/inference/coder-route.ts:93-160` vs `src/inference/persona-lane.ts:84` | Own `looksLikeModelId` copy and chain; comment now admits it does not delegate | Separate refactor task: delegate to `persona-lane`, keep `via` labels pinned by `coder-route.test.ts` |
| `StageConfig.semanticCache`, `SemanticCache` values | `src/interfaces/policy.ts:120,135` | Frozen contract; written by `LEVEL_TABLE`, read nowhere | Remove in a contract-change task (update `policy.contract.test`) |
| `SemanticCompression "low_relevance"` + worker preset | `src/interfaces/policy.ts:117`; `src/compression/headroom-worker.py:244` | No `LEVEL_TABLE` row produces it | Remove with the row above |
| Three chars/4 token estimators | `src/prompt/compact.ts:71`, `src/pipeline/brevity.ts:154`, `src/mcp/in-memory-compression.ts:38` vs `src/compression/tokens.ts:17-22` | Redundant, not dead; the copies lack the `max(1)` | Consolidate on `compression/tokens.ts` in a later task; keep for now |

## Out of scope

- Comment-only staleness elsewhere in these files (DUST3.18).
- Telemetry, knowledge, session and buzz leftovers: listed in DUST3.7, DUST3.12, DUST3.15 and
  DUST3.16, beside the bugs in the same files.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
