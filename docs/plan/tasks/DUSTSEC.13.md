---
task: DUSTSEC.13
title: "inference.worker_targets is live — take it off RETIRED_SETTINGS, fix the test comment, document it"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md G1 (USER, 2026-10-08); SUMMARY.md X2, Gaps 1.6/r062 + 1.8/r016 (G08); DUST1.6 C1, DUST1.8 #4"
gate: "A config carrying inference.worker_targets loads with no retired-setting error or warning and routes as the schema describes; the test comment that says it warns is corrected; the setting is documented in the config reference. golem verify green by exit code."
depends_on: []
touches: [src/config/migrations.ts, src/config/schema.ts, src/config/loader.ts, tests, docs/wiki/concepts/Persona Registry.md]
created: 2026-10-08
updated: 2026-10-08T10:26:13.640Z
---

## What this is

Schema (`src/config/schema.ts:303`) and readers treat `inference.worker_targets` as live and
routing gives it the highest precedence, but `RETIRED_SETTINGS` in `src/config/migrations.ts:98-102`
lists it (since R14.3), and a code comment says it raises.

**USER decision (verbatim, G1):** `inference.worker_targets` is LIVE: remove from
`RETIRED_SETTINGS`, fix the test comment that says it warns, document it.

## The work

1. Remove the `RETIRED_SETTINGS` entry. **Also check the R14.3 migration at
   `src/config/migrations.ts:156-160`** that rewrites `worker_targets."coder"` into
   `personas.coder.model`: with the setting live, a migration that deletes it changes routing.
   Report what it does; if it removes the key, stop it doing so (a live setting is not migrated
   away) and say so in the PR.
2. Fix the test comment that says it warns (DUST1.6 C1 names it; grep `tests/` for
   `worker_targets`) and the "retired in R14.3 and raises" code comments (SUMMARY drift
   1.6/r062).
3. Document precedence (`worker_targets[worker]` vs persona model) where config is documented
   (the Persona Registry wiki page and the schema doc comment at `schema.ts:320-346`).

## Out of scope

- Changing routing precedence.

## Verification bar

`golem verify` green by exit code; `golem wiki check` if a wiki page changed. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
