---
task: DUST3.1
title: "Dead code (proxy, providers): delete the unreferenced context guard/monitor, resolveModel and ResolvedTarget.contextSize"
state: queued
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/PLAN.md Phase 3; SUMMARY.md 'Dead candidates in code' DUST1.1, DUST1.2; re-verified 2026-10-08 in docs/plan/audit/dust-1/PHASE3-INDEX.md"
gate: "golem verify exit 0 before AND after (exit code, not tailed output); suite test count unchanged (no test references these symbols); every SAFE-TO-DELETE item gone and the grep proofs below return zero hits."
depends_on: []
touches: [src/proxy/context-guard.ts, src/proxy/context-monitor.ts, src/proxy/index.ts, src/providers/targets.ts]
created: 2026-10-08
---

## What this is

Dust Phase 3 deletion pass for `src/proxy` and `src/providers`. Every item below was re-verified
against the current code on 2026-10-08 (after DUSTSEC.1-18 and the DUST2 comment pass). Run
your own grep again before deleting anything; if a symbol has gained a reference, stop and
report it rather than deleting.

Work in your own worktree (`git worktree add ../golem-dust3-1 -b dust3-1 development`) and
commit each deletion as you go.

## SAFE-TO-DELETE (execute)

Criteria: unexported or internal-only, zero references in `src/`, `tests/`, `scripts/` and
`vscode-extension/` apart from the definition and a barrel re-export with no importer, not
under `src/interfaces/`, not an MCP tool/prompt, CLI command, config key or plugin API, not
reached by dynamic import or string lookup. The package entry `src/index.ts` exports only
`./interfaces/index.js` and `VERSION`, so `src/proxy/index.ts` is an internal barrel.

| # | item | where | proof (command → result) |
|---|---|---|---|
| 1 | `ContextGuard`, `getContextGuard` (whole file, 321 lines) | `src/proxy/context-guard.ts`; barrel `src/proxy/index.ts:1,79` | `grep -rnw --exclude-dir=node_modules -E 'ContextGuard\|ContextMonitor\|getContextGuard\|getContextMonitor\|parseModelDescriptor' src tests scripts vscode-extension` → hits only in the two files and `src/proxy/index.ts:1,2,79,80` |
| 2 | `ContextMonitor`, `getContextMonitor`, `parseModelDescriptor` (whole file, 254 lines) | `src/proxy/context-monitor.ts`; barrel `src/proxy/index.ts:2,80` | same command; `grep -rn 'context-guard\|context-monitor' src tests scripts` → only the four barrel lines (no dynamic import) |
| 3 | `resolveModel` | `src/providers/targets.ts:195`; barrel `src/proxy/index.ts:48` | `grep -rnw resolveModel src tests scripts vscode-extension` → 2 hits (definition + barrel) |
| 4 | `ResolvedTarget.contextSize` field | `src/providers/targets.ts:109` | `grep -rn '\.contextSize\b' src tests \| grep -v src/proxy/context-` → 0 hits; never assigned by `toResolved` |

Delete the barrel lines together with the symbols. Do not touch the gateway-descriptor
`contextSize` (`src/providers/gateways.ts:57`, config schema): it is a config surface, see
the proposal below.

## NEEDS-USER (proposals only, do not delete)

| item | file:line | evidence | recommendation |
|---|---|---|---|
| Gateway model descriptor `contextSize` config field | `src/providers/gateways.ts:57`, `src/config/schema.ts:189,253` | Only reader was the context guard/monitor, which has no importer, so the key is validated and then ignored, now and after this task | Keep the key and document it as reserved, or retire it through `RETIRED_SETTINGS`. User call: it is a public config key |

## Hard rules

- Proxy stays lossless and prefix-stable at level <= 1. Nothing here is on the request path
  (the deleted modules have no importer), so recorded-shape tests must pass unchanged.

## Out of scope

- The `persona_worker` branch in `selectTarget`: the audit lists it as dead, but DUST3.10's
  route-label fix (C-c) makes it reachable. Do not delete it here.
- Stale comments in these dirs (DUST3.18).
