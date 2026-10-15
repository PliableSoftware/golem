---
task: DUST3.9
title: "Compression accounting and hook config: honour read_skeleton_enabled on the fast path, accept Headroom `router`, count only stored CCR refs"
state: done
owner: agent
size: S
discipline: code
design: "SUMMARY.md DUST1.3 C3 (high impact), DUST1.3 'Functional, medium'; DECISIONS C6 (false warning stays a Phase 3 bug); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop; recorded-shape tests for level <= 1 unchanged."
depends_on: []
touches: [src/cli/fast-path.ts, src/compression/headroom-adapter.ts, src/compression/context-substitution.ts, tests]
created: 2026-10-08
updated: 2026-10-08T18:33:45.969Z
---

## What this is

Three small defects where a setting is ignored or a figure is overstated. Work in your own
worktree (`git worktree add ../golem-dust3-9 -b dust3-9 development`), failing test first, commit
as you go. DUST2.20 also touches `src/compression`. Rebase if it is in flight.

## The work

1. **C3: `knowledge.read_skeleton_enabled: false` is ignored on the default hook path**
   (`src/cli/fast-path.ts:337-346`; `src/hooks/post-tool-use.ts:285`). The fast path passes only
   `maxInlineChars`, so `skeletonAllowed` defaults to true. The commander path does pass it
   (`src/cli/commands/prompt-guidance.ts:326`). Pass the same reader. Rewrite the comment at
   `fast-path.ts:332-336`, which claims no caller passes the field. Test: the fast path with the
   setting false produces no skeleton.
2. **C6: `router` reported as unreachable** (`src/compression/headroom-adapter.ts:529-539,551-556`).
   `KNOWN_HEADROOM_CONFIG_FIELDS` lacks `router`, a documented D57 key. Add it. Headroom imports
   stay confined to this file (hard rule).
3. **`ccrRefsStored` counts substitutions, not stores** (`src/compression/context-substitution.ts:183-194`).
   The `putIfAbsent` result is discarded. Count only `true` results. If `pipeline.ts:730` needs a
   change, keep it to that line; DUST3.3 owns the rest of `pipeline.ts`.

## Hard rules

- Headroom pinned exactly; imports only in `src/compression/headroom-adapter.ts`.
- Lossless and prefix-stable at level <= 1.

## Out of scope

- CCR bridge pairing by index: DUST2.20.
- Slider-era comments in `src/compression`: DUST3.18.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
