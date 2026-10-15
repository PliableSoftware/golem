---
task: team-security-stricter-only
title: "A team may set a security.* setting only toward a stricter value, never loosen one (USER decision P4, revised 2026-10-09)"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md P4 (USER, 2026-10-09, revised after discussion); ADR-0008 and docs/wiki/concepts/Team Layer.md; src/config/loader.ts REMOTE_DENIED_SETTINGS (named keys only: proxy.bypass_all, portal.url, portal.issuer, portal.client_id, team.org_id, team.portal_url, team.sync, team.skills) and the security section of src/config/schema.ts."
gate: "Every security.* key is classified in code as having a declared stricter direction (for example a boolean that exposes a surface: false is stricter; a duration or an age: smaller is stricter; a list that widens reach: a subset is stricter) or as having none; the team layer (a remote origin) may set a security.* key only to a value that is stricter than or equal to the value the member's own layers resolve to, and a looser value is IGNORED with a warning that names the key, the team value and why (never an error, never a startup failure: ADR-0008), while a key with no declared direction stays denied remotely (fail closed); the member's own config can still set any value; proxy.bypass_all and the other named keys stay denied; tests per direction type cover stricter, equal and looser values, a team value tightening a default, a team value trying to loosen a member's own stricter setting, and an unclassified key being denied; golem status shows a team-supplied security value with its provenance; a new security key without a declared direction fails a test so it cannot be forgotten; golem verify exit 0; an independent read-only review before merge, because it is a policy and security change."
depends_on: []
touches: [src/config/loader.ts, src/config/schema.ts, src/portal/team-layer.ts, tests, docs/wiki/concepts/Team Layer.md]
created: 2026-10-09
---

## What this is

The user wants team policy to be consistent with the rule already behind the `proxy.bypass_all` ban: an organisation can make a member's machine safer but never less safe. List every `security.*` key first (write the classification table in this task: key, stricter direction or none, and why), commit it before the code, and call out any key whose direction is unclear rather than guessing: unclear means denied.

The comparison is against what the member's own layers resolve to, not against the default, so a team cannot loosen a setting the member tightened.

## Out of scope

- Building the phone-approval setting (R13.9).
- The other non-security team keys.

## Status after `team-layer-everywhere` (2026-10-09, after the third review)

The classification, the per-direction enforcement and the tests landed in `team-layer-everywhere` (see `src/config/team-policy.ts`), for ALL keys and not only `security.*`, so this task's gate is covered except for what remains here: a `raise-only` class (a number where higher is stricter; `knowledge.local_answer_min_confidence` is denied until then), the `golem team sync` report cannot show member-relative refusals (`lower-only`, `narrow-roots` need the member's own value, so only load-time warnings and `team.skipped` show them), and a fresh independent review of the final table.
