---
task: DUSTSEC.14
title: "An invalid team value warns and skips the team layer; the proxy still starts (ADR-0008)"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md G2 (USER, 2026-10-08); SUMMARY.md S20; ADR-0008; DUST1.8 h2"
gate: "Probe: a team-origin row with an invalid value — proxy starts, logs one warning naming the key and the team source, and the team layer is not applied (before: ConfigError, proxy refused to start). An invalid value in a non-team layer behaves exactly as before. golem verify green by exit code."
depends_on: []
touches: [src/config/loader.ts, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:14.190Z
---

## What this is

ADR-0008 says nothing about a team link may stop the proxy, but `src/config/loader.ts:625-631`
throws `ConfigError` on any invalid leaf, team layer included (probed, SUMMARY S20).

**USER decision (verbatim, G2):** code follows ADR-0008: an invalid team value logs a warning and
the team layer is skipped; the proxy still starts.

## The work

1. Distinguish the team origin at the validation site; skip the WHOLE team layer (not just the
   leaf) on an invalid value, warn once, continue.
2. The warning must reach a surface the user sees (`golem status` / proxy log), not only stderr of
   a detached daemon.
3. Tests per the gate.

## Hard rules

- A skipped team layer must not loosen redaction: team policy can only add redaction, so skipping
  it can never remove a built-in. Assert built-ins still run.

## Out of scope

- G3/S18 (where enforced team policy applies) — left open for the user (DECISIONS.md G3).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
