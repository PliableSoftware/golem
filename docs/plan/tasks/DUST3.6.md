---
task: DUST3.6
title: "Gateway CLI papercuts: reject `--store fiel`, read piped login on `add --login`, report keychain faults on `forget`, stop truncating model ids silently, reject `model[262k]`"
state: queued
owner: agent
size: S
discipline: code
design: "SUMMARY.md DUST1.2 'Functional, medium'; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: [DUST3.5]
touches: [src/cli/commands/gateway.ts, src/cli/models.ts, src/credentials/store.ts, src/config/schema.ts, src/providers/gateways.ts, tests]
created: 2026-10-08
---

## What this is

Small, independent CLI defects. It depends on DUST3.5 only because both edit
`src/providers/gateways.ts`. Work in your own worktree
(`git worktree add ../golem-dust3-6 -b dust3-6 development`), failing test first, commit as you go.

## The work

1. **`--store fiel` silently means keychain** (`src/cli/commands/gateway.ts:99`). Use Commander
   `.choices(["keychain","file"])`.
2. **`gateway add --login` fails on a non-TTY** (`gateway.ts:205-206`). It calls
   `loginGateway(..., {})` without the piped-stdin read that `gateway login` has (`:104`). Reuse it.
3. **`forget` swallows a keychain fault** (`src/credentials/store.ts:293`). `.catch(() => null)`
   reports "no stored credential". Distinguish not-found from a backend error.
4. **`golem models` truncates ids over 33 chars with no marker** (`src/cli/models.ts:85`). Add an
   ellipsis, or do not truncate.
5. **`model[262k]` goes upstream as a model name** (`src/config/schema.ts:197`,
   `src/providers/gateways.ts:46`). The `/\[(\d+)\]/` parse does not match, so the whole string
   becomes the name. Reject a bracket suffix that is not digits with a validation error. Accepting
   `k`/`m` would be a feature; do not add it. Fix the `gateways.ts:46` and `schema.ts:196`
   comments that show `262k`.

## Out of scope

- Keyless gateways refusing `use` without `--yes` and listing `key MISSING`: intended behaviour
  by decision V1 (DUST2.2).
- `account login` / `proxy.accounts` strings in `src/cli/gateways.ts` and
  `src/cli/commands/target.ts`: DUST3.18.
