---
title: Team Payload Off the Resolution Object
type: debrief
tags: [config, team, portal, security, refactor]
sources: [docs/plan/tasks/team-payload-off-resolution.md, docs/plan/tasks/DUST2.22.md, src/config/effective.ts, src/cli/commands/proxy.ts, tests/unit/config/team-payload-surfaces.test.ts]
created: 2026-10-22
updated: 2026-10-22
---

# Team Payload Off the Resolution Object

`loadEffectiveConfig` no longer hands the team's raw payload (`team.teamLayer.settings`) to surfaces. The layer reaches `loadConfig` by a separate channel, and the object surfaces receive carries only the reported fields.

## The problem

DUST2.22 found no surface that serialised the raw payload, and `withoutRefusedValues` already dropped refused keys from the object handed out. The structural risk stayed: any future accepted-but-sensitive-shaped team value would ride along on an object that surfaces print. Every accepted team class today is a boolean, a number, a level, a root list or the bounded team prompt, so nothing leaked, but the safety rested on that fact and not on the shape.

## What shipped

- `TeamResolution` in `src/config/effective.ts`: the layer resolution minus `teamLayer`, plus `layerLoaded: boolean`. `EffectiveConfig.team` has this type.
- `forSurfaces()` replaces `withoutRefusedValues`. The raw layer goes only to `loadConfig({ teamLayer })`.
- `src/cli/commands/proxy.ts` gates its notice on `team.layerLoaded`, which matches the old `teamLayer !== undefined` check in every case (unlinked, caller-supplied layer, resolve threw, no layer, outage with a cached layer, skipped layer, refused keys, second load threw).
- A new test walks the resolved object at every depth for the key `teamLayer` and for the canary value, and fails on the old code. The reader-list pin in `team-payload-surfaces` drops `cli/commands/proxy.ts`.

No behaviour change for any accepted or refused team value.

## Review

Independent review found no defects. Four nits were applied: a comment on `layerLoaded`, a stale test header, a whole-object canary check (`JSON.stringify(c)`), and a provenance layer assertion so a missing entry cannot pass.

## Lessons

- A guard that depends on every current value being harmless is a guard on today's data. Take the payload off the object and the guard no longer depends on the data.
- A key-name walk finds only the key it names. Pair it with a value canary over the whole serialised object.

## See also

- [[Team Layer]]
- [[Settings Cascade]]
