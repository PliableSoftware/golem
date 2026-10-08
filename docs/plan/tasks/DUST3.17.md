---
task: DUST3.17
title: "`vibe confirm` refuses a rejected key; release.mjs bumps package-lock.json with the other versions"
state: queued
owner: agent
size: S
discipline: code
design: "SUMMARY.md DUST1.8 'Functional, medium' (vibe confirm tombstone, package-lock not bumped); CLAUDE.md Branches and releases; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/vibe/candidates.ts, scripts/release.mjs, tests]
created: 2026-10-08
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-17 -b dust3-17 development`), failing
test first, commit as you go.

## The work

1. **`vibe confirm` accepts a tombstoned key** (`src/vibe/candidates.ts:153-169`). `transition`
   never checks `existing.state`. Refuse a `rejected` key unless explicitly forced.
2. **`release.mjs` does not bump `package-lock.json`** (`scripts/release.mjs:28`). `PKGS` lists only
   the two `package.json` files. The lock is in sync today (0.54.3, `@pliable/golem`) only because
   it was synced by hand. Bump the lock's root `version` and `packages[""].version` together. DUST2.21
   (atomic lockstep) edits the same file. If it has landed, add the lock to its all-or-none set; if
   it has not started, prefer folding this item into DUST2.21 and closing it here with a note.

## Hard rules

- Never hand-edit a version. This changes the tool that moves versions, nothing else.

## Out of scope

- `release.mjs` header steps that say "not committed/tagged/published": DUST3.18.
- Atomic writes / SHA256SUMS assertion: DUST2.21.
