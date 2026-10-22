---
task: team-layer-partial-skip
title: "One invalid team value skips the whole team layer: decide whether the valid keys should still apply"
state: queued
owner: user
size: S
discipline: plan
design: "ADR-0008, 'Amended 2026-10-08 (DUST2.3; DECISIONS.md G2, USER decision)'. Code: buildTeamOrigin in src/config/loader.ts. An invalid team value logs 'team layer SKIPPED: nothing from it applies, and the proxy still starts' and the whole layer is dropped."
gate: "The user records one decision in ADR-0008: keep whole-layer skip, or apply the valid keys and drop only the invalid one. If the second, a code task follows with failing-first tests and the warning names the dropped key. If the first, this task is closed with the reason written into ADR-0008."
depends_on: []
touches: [docs/decisions, src/config]
created: 2026-10-22
---

## What this is

Since v0.56.0 and v0.57.0 a team can publish more keys, so one bad value now silences more policy. A member whose portal serves one malformed key receives none of the team's settings, and the only signal is one warning. The 2026-10-08 amendment chose whole-layer skip deliberately, because the layer is dry-run through both bands so a throw cannot leave a half-applied layer.

## Why it is the user's

G2 was a user decision. Dropping only the bad key is a smaller blast radius but means a layer that applies partially, which the dry-run was built to avoid, and which could apply a security-relevant key while dropping the key that was meant to accompany it.

## Out of scope

- Changing which team values are accepted or refused.
