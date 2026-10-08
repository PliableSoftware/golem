---
task: DUST3.16
title: "Buzz ACP: cancel with no turn in flight must not silence the next turn; provisioning must not orphan minted identities or name a nonexistent `--rotate`"
state: queued
owner: agent
size: S
discipline: code
design: "SUMMARY.md DUST1.10 D7, D9; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/buzz/acp-agent.ts, src/buzz/provision.ts, tests]
created: 2026-10-08
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-16 -b dust3-16 development`), failing
test first, commit as you go.

## The work

1. **D7: a cancel with no turn in flight poisons the next turn** (`src/buzz/acp-agent.ts:75,139`).
   `cancelled.add` runs unconditionally. Add to the set only while a prompt is in flight for that
   session, and fix the comment at `:56-58,73-74`.
2. **D9: provisioning orphans identities** (`src/buzz/provision.ts:197-245`). Secrets are minted in
   the loop, then it throws before the manifest write, and the hint names
   `golem buzz provision --rotate`, which does not exist (`:242`). Write manifest records for every
   minted persona before throwing, and make the hint name a real recovery step. No CLI reaches
   `provisionBuzz` yet (R14.2), so test at the function level.

## NEEDS-USER (proposals only, do not delete)

| item | file:line | evidence | recommendation |
|---|---|---|---|
| `provisionBuzz`, `mintIdentity`, `rotateIdentity`, `findGenerateKeyRunner`, `runGenerateKey`, `addMemberCommand` | `src/buzz/provision.ts:172`; `src/buzz/identity.ts:208,240,299,329,345` | No CLI yet | Keep; R14.2 |
| `golemHarnessDefinition`, `harnessDefinitionPath` (+ D11: harness `args:["acp"]` exits 1 without `--persona`) | `src/buzz/harness-definition.ts:30,35,40` | Test-only; named in R14.3 step 7 | Keep; fix D11 inside R14.3 |
| `RunAcpTurnDeps.postChannelMessage` / `recordDeferred` | `src/buzz/acp-turn.ts:79,81` | Seams for R14.4 | Keep |

## Out of scope

- Keygen parser (S6): DUSTSEC.6/17/18.
