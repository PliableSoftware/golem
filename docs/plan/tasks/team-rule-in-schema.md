---
task: team-rule-in-schema
title: Publish each setting's team rule in the schema, so the portal stops accepting values the client will drop
state: done
owner: agent
size: M
discipline: code
design: src/config/team-policy.ts (TEAM_POLICY, TeamRule, staticRefusal, isMemberRelative); src/config/control-surface-settings.ts (the controls the published schema is built from); ADR-0008 'The floor'; docs/wiki/concepts/Team Layer.md 'The floor: a team may only tighten'. Portal side: PliableSoftware/golem-portal lib/team-settings.ts (TEAM_ORIGIN_DENIED) and lib/golem-schema.ts.
gate: Every setting control in the schema published by `golem config schema --json` carries its team rule, derived from TEAM_POLICY and never written a second time; a test fails if a control has no rule or the published rule differs from teamRule(); the totality guarantee (a new schema leaf with no policy entry is a compile error) still holds and now also covers the published field; the field is additive, so a portal that ignores it keeps working. golem verify exit 0.
depends_on: []
touches: [src/config, tests, docs/wiki]
created: 2026-10-21
updated: 2026-10-22T00:39:44.332Z
---

## What this is

The portal lets an admin save a value for any setting in the published schema. The client then drops it, with a warning, if the team origin may not carry it. Today the portal knows about exactly one such key (`proxy.bypass_all`); the client's policy denies 44, and has further rules (`false-only`, `true-only`, `lower-only`, `narrow-roots`, `bounded-text`). So an admin can save `inference.model` or `proxy.model` for a project and the portal reports success while every machine ignores it. That is a silent no-op, and the portal's own comment already says that where the two disagree the portal is the bug.

The portal must not copy the 44-key table: a second copy is how the two drift. The schema it already fetches is the right carrier, because it is published per release and the portal already refuses to invent keys the schema does not have.

## What to build

1. Add the team rule to each setting control in the published schema, additively (a new optional field next to `writableScopes` and `locked`; the name is the harness's to choose, suggested `teamRule`). Its value is the `TeamRule` string from `TEAM_POLICY`, read through `teamRule()`, never retyped.
2. For the member-relative rules the schema can only say the direction (`lower-only`, `narrow-roots`), because the comparison needs the member's own value, which the portal never has. Say so in the field's documentation, so the portal can word it as "a team may only lower this" rather than pretending it can validate.
3. `bounded-text` carries its bound (today `TEAM_PROMPT_MAX_CHARS`, 2000 characters, no control characters, no URL) so the portal can show and enforce the same limit without a second constant.
4. Controls that are not settings (guidance, runtime) carry no rule.
5. A test that every setting control has a rule and that it equals `teamRule(dotted)`.
6. Document the field in the schema's consumer notes and in `Team Layer.md`.

## Out of scope

- Changing any rule. This only publishes what is already decided.
- Making the client trust the published field. The compiled-in table stays the authority; the schema field is a courtesy so an admin is told at the point of saving.

## Portal follow-up (tracked there, not here)

Once released, the portal reads the field: `denied` settings show disabled with the reason and are refused on write (`denied_at_team_origin`), `false-only` and `true-only` limit the control to the allowed value, `lower-only` and `narrow-roots` say what the team may do, and `TEAM_ORIGIN_DENIED` is deleted. Until then the portal keeps its one-key list, and a schema without the field must degrade to today's behaviour with a visible note, not to silence.

## Status

Item 3 narrowed on review: `teamBound` publishes only `{ maxChars }`. The client's real check (`teamPromptViolation`) allows tab and newline and refuses far more than a control-character and URL rule, so publishing those two would make a portal reject what the client accepts. Also published: `teamEnforceable: false` on `inference.team_prompt` (`REMOTE_NEVER_ENFORCED`).

## Outcome

shipped
