---
task: team-payload-off-resolution
title: "Stop carrying the raw team payload on the config resolution object"
state: queued
owner: agent
size: S
discipline: code
design: "DUST2.22 (#318) 'Raw team payload (B), follow-up' in docs/plan/tasks/DUST2.22.md; withoutRefusedValues in src/config/effective.ts; tests/unit/config/team-payload-surfaces.test.ts"
gate: "`team.teamLayer.settings` is no longer present on the object `loadEffectiveConfig` hands to surfaces; `loadConfig` receives the team layer by a separate channel; the surface-scan test (team-payload-surfaces) still passes and pins the new reader list; a test fails on the old code if the raw payload is reachable from the resolved object; no behaviour change for any accepted or refused team value; golem verify green by exit code."
depends_on: []
touches: [src/config, tests]
created: 2026-10-15
---

## What this is

`team.teamLayer.settings` is the team's raw payload and rides on the resolution object that surfaces
receive. Probing in DUST2.22 found no surface that serialises it, and `withoutRefusedValues` now drops
refused keys from the handed-out object. The structural risk remains for values that are accepted but
sensitive-shaped; none exist today, since every accepted team class is a boolean, a number, a level, a
root list or the bounded team prompt. A cleaner fix is to stop carrying the raw payload on the
resolution at all and pass the layer to `loadConfig` by a separate channel.

## Out of scope

- Changing which team values are accepted or refused.
- Per-persona team prompts.
