---
task: DUST3.4
title: "Status honesty and proxy process control: never hide redaction-off, report bypass in `proxy status`, make select-target restart properly, stop advertising a dashboard `ps` never finds"
state: queued
owner: agent
size: M
discipline: code
design: "SUMMARY.md S11, S12; DUST1.11 'Functional, medium' (select-target, ps); ADR-0004 (bypass_all surfaced loudly); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/cli/status-collect.ts, src/cli/commands/proxy.ts, src/cli/commands/select-target.ts, src/cli/commands/ps.ts, tests]
created: 2026-10-08
---

## What this is

User-facing surfaces that understate the state of redaction or misreport the proxy. Write each
failing test first. Work in your own worktree (`git worktree add ../golem-dust3-4 -b dust3-4 development`),
commit as you go.

## The work

1. **S11 (HR): redaction-off warning dropped when an update is available**
   (`src/cli/status-collect.ts:430-436`). The ternary returns `[update, ...warnings]` and loses
   `REDACTION_OFF_WARNING`. The warning must appear whatever else is present. Test with
   `bypass_all` true and an update available, with `NO_COLOR` set (the panel shows bypass by
   colour only).
2. **S12 (HR): `golem proxy status` says "Pipeline is active" under `bypass_all`**
   (`src/cli/commands/proxy.ts:497-499`). `bypass_all` runs a normal daemon with
   `pipelineEnabled:false` (`proxy-runtime.ts:317`), so it never takes the shim branch. Print a
   loud bypass line instead. Test both states.
3. **select-target restart** (`src/cli/commands/select-target.ts:46-55`). It ignores the
   `waitForPortFree` result and never calls `writeProxyDesired("running")`. Reuse the restart
   helper in `commands/proxy.ts` rather than keeping a second one. Test: busy port is reported,
   desired state written.
4. **`ps` advertises a `dashboard` kind no collector emits** (`src/cli/commands/ps.ts:13,38,779`).
   Remove it from help and the kind list, or add a collector. Removing it is the smaller change;
   take it unless the dashboard has a pidfile to read.

## Out of scope

- The dead `~/.golem` subdirectory scan in `collectProxies` (`ps.ts:290-304`): NEEDS-USER
  proposal in the index.
- `ps.ts:17` and other comment-only fixes: DUST3.18.
