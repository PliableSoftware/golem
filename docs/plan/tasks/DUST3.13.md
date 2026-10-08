---
task: DUST3.13
title: "Watch and dashboard CLI: live stats source, respect NO_COLOR and non-TTY, true footer cadence, no overlapping frames, CCR size from the worktree root"
state: queued
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.9 D2, D5, D6, D9, D10; re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/cli/watch.ts, src/cli/commands/note-dashboard-watch.ts, src/cli/storage-size.ts, tests]
created: 2026-10-08
---

## What this is

Work in your own worktree (`git worktree add ../golem-dust3-13 -b dust3-13 development`), failing
test first, commit as you go. DUST2.18 (dashboard figures) may touch the same command file.
Rebase if needed.

## The work

1. **D2: the dashboard stats source is frozen at startup** (`src/cli/commands/note-dashboard-watch.ts:107,117`).
   Resolve it inside each poll.
2. **D5: `golem watch` ignores `NO_COLOR` and non-TTY** (`note-dashboard-watch.ts:170,179`,
   `src/cli/watch.ts:185`). A lone `--no-color` default makes `opts.color` true. Pass colour only
   when the flag was given; otherwise use the TTY/`NO_COLOR` check.
3. **D6: the footer misreports its cadence** (`watch.ts:159`). It prints `WATCH_REFRESH_MS`, not
   `refreshMs`.
4. **D9: frames overlap, and a null state shows "running"** (`watch.ts:221,79`). Add an in-flight
   guard (or chained `setTimeout`) and a distinct glyph for null.
5. **D10: storage sizing reads the wrong CCR dir in a linked worktree** (`src/cli/storage-size.ts:55-57`).
   Use `resolveWorktreeRoot(projectDir)` as the CCR store does (`native-lossless.ts:362`).

## Out of scope

- D7 (statusline runs `aggregate()` every prompt for `tokensBefore/After`, which it never
  renders): those fields are served on `/__golem/statusline` and pinned by
  `statusline.test.ts:786`. NEEDS-USER, see the index.
- Telemetry store bugs: DUST3.12.
