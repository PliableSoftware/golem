---
task: tui-slider-0-branch
title: "Remove the dead slider-0 needsConfirm branch in the TUI and rewrite the four tests that pin it"
state: queued
owner: agent
size: S
discipline: code
design: "DUST3.2 item 4 (refused in Phase 3 because four tests pin it); docs/plan/audit/dust-1/DECISIONS.md SL0 (default recommendation, 2026-10-09). src/tui/state.ts needsConfirm has an enum branch for the retired slider level 0 ('Level 0 disables redaction'); tests/unit/tui-render.test.ts and tui-state.test.ts use an enum danger-control fixture."
gate: "The slider-0 branch of needsConfirm in src/tui/state.ts is deleted; the four tests are rewritten to a fixture that is not the retired slider, still exercising the confirm-before-dangerous-change behaviour for the controls that DO exist (show which control each new fixture uses); no test is simply deleted without an equivalent; the TUI confirm behaviour for bypass_all and any other danger control is unchanged and has a test; golem verify exit 0."
depends_on: []
touches: [src/tui, tests/unit]
created: 2026-10-09
---

## What this is

The last slider-era behaviour in the TUI. The audit says the branch is unreachable because the slider no longer exists, but the tests assert it, so the removal is a test rewrite as much as a deletion. Recorded as a default (not asked): the user can reverse it.

## Out of scope

- Other TUI cleanups.
