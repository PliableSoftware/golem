---
task: DUST3.14
title: "Portal and team sync honesty: init reports the real team outcome, `team sync` works unlinked, only 402/403 stamp not-entitled, the api_error notice says what is true"
state: queued
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.10 D3, D6, the 4xx stamping row; DUST1.11 (`team sync` exit 2); ADR-0008; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/cli/init.ts, src/cli/init-team.ts, src/cli/commands/team.ts, src/portal/entitlement.ts, src/portal/team-layer.ts, tests]
created: 2026-10-08
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-14 -b dust3-14 development`), failing
test first, commit as you go.

## The work

1. **D3: `golem init` reports 402/403/api_error as "signed in and up to date", and a stale cache
   as freshly applied** (`src/cli/init.ts:556-575`). Return the disposition and notice, and have
   `init-team` print them. That makes the comment at `init.ts:552-553` true. Check it after.
2. **`golem team sync` exits 2 for solo users** (`src/cli/commands/team.ts:509-515`).
   `portalContext()` throws `not_configured` before the unlinked early return. Read the binding
   first, the same fix already made for `status`.
3. **A 4xx with a known code stamps the entitlement cache** (`src/portal/entitlement.ts:137-140`).
   Restrict `not_entitled` to 402/403.
4. **D6: the `api_error` notice contradicts the next load** (`src/portal/team-layer.ts:757-761`,
   `entitlement.ts:263-266`). `api_error` stamps nothing, yet the notice says team settings are
   "NOT being applied". Scope the wording to this sync.

## NEEDS-USER (proposals only)

| item | file:line | evidence | recommendation |
|---|---|---|---|
| `init-team.ts` catch branch | `src/cli/init-team.ts:197` | Audit called it unreachable; it is not provably so (`resolvePortalConfig`, `createCredentialStore`, `translateTeamRows` run outside the guarded calls) | Keep |

## Out of scope

- Where enforced team policy applies (G3/S18) and `security.*` remote denial (S17/P4): open
  USER decisions, in the index.
- Stale "has not shipped yet" comments in `init-team.ts:80,163-164`: DUST3.18.
