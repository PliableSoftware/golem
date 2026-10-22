---
title: Team Rule in Schema — published policy for the portal
type: debrief
tags: [schema, portal, team, policy, config]
sources: [docs/plan/tasks/team-rule-in-schema.md, src/config/team-policy.ts, src/config/control-surface-types.ts, src/cli/commands/config.ts, tests/unit/config/team-rule-in-schema.test.ts, docs/decisions/ADR-0008-settings-cascade-and-importance.md, docs/wiki/concepts/Team Layer.md, docs/wiki/concepts/Settings Cascade.md]
created: 2026-10-22
updated: 2026-10-22
---

# Team Rule in Schema — published policy for the portal

The portal can now read each setting's team rule from the published schema and stop accepting values the client will drop. The compiled-in `TEAM_POLICY` table stays the authority; the schema field is a courtesy so an admin is told at the point of saving rather than after.

## The problem

Today the portal knows exactly one denied key (`proxy.bypass_all`). The client policy denies 44 settings and enforces further rules (`false-only`, `true-only`, `lower-only`, `raise-only`, `narrow-roots`, `bounded-text`). An admin can save `inference.model` or `proxy.model` for a project and the portal reports success while every machine ignores it — a silent no-op that misleads the admin.

The portal must not copy the 44-key table: a second copy is how the two drift. The schema it already fetches per release is the right carrier, so the idea was to add the rule to each published setting control.

## What shipped

**New fields on setting controls** in the published schema (`golem config schema --json`, `config-schema.json`):

- `teamRule?: TeamRule` — the string from `TEAM_POLICY` read via `teamRule()`, never retyped. One of `settable | false-only | true-only | lower-only | raise-only | narrow-roots | bounded-text | denied`. Guidance and runtime controls carry none.
- `teamBound?: { maxChars: number }` — present only with `teamRule: "bounded-text"`. The portal can check length; the client may still refuse other content.
- `teamEnforceable?: false` — present only on `inference.team_prompt` (can be set, never enforced at team origin).

**Member-relative rules** (`lower-only`, `raise-only`, `narrow-roots`) publish direction only because the comparison needs the member's own value, which the portal never has. Static parts they do not convey:
- `narrow-roots` needs a non-empty absolute-path list (checked in the client)
- `knowledge.auto_index_max_files` refuses 0 unless the member's own value is 0
- `compression.level` is ordered by its options
- Client refuses structural markers, code fences, URLs and IPs, mixed scripts, invisible characters, 9-10 digit numbers, stacked combining marks, role-header lines, tags, marker text

**Test totality.** Every setting control in the published schema carries a rule equal to `teamRule(dotted)` (the string derived from `TEAM_POLICY`). Unclassified keys are compile errors, never silent defaults.

## What was wrong, found and fixed

**Independent review:** One medium defect reported and fixed failing-test-first.

The first draft of `teamBound` published `{ maxChars, controlChars: false, urls: false }`. This was wrong on two counts:
1. **Incomplete.** The client's real check (`teamPromptViolation`) allows tab and newline but refuses far more than control characters and URLs — code fences, role-header lines, tags, marker text, IP addresses, stacked combining marks, mixed scripts, 9-10 digit numbers, invisible spaces. A portal taking the published rules literally would reject what the client accepts.
2. **Unsafe to narrow.** Publishing a partial copy of a rule set looks complete and is worse than publishing nothing. An admin would believe they can enforce it and be wrong.

Fixed by publishing `{ maxChars }` only and documenting in the field's JSDoc that the client may still refuse other content. This is the right shape: publish only what the other side can check exactly.

**Lesson:** A test that compares a published field with the function that produced it is circular and useless. Pin literal values per class, as the new test does. Also: always read the consuming side's actual implementation before publishing what it should accept.

## Deliberate narrowing (per task brief)

The original brief item 3 asked for `teamBound` to carry `{ maxChars, controlChars, urls }`. Independent review narrowed it to `{ maxChars }` only, approved in the task doc status section. The decision was sound and the record is there.

## Portal side (not done here)

The portal has not yet read the field. When it does (tracked on the portal side):

- Parse `teamRule` as an optional string (not an enum, so a future class won't invalidate old documents)
- Show denied settings disabled with the reason, refuse them on write
- Limit `false-only` and `true-only` controls to their allowed values
- Say "a team may only lower this" for `lower-only`
- Say "a team may only raise this" for `raise-only`  
- Say "a team may only narrow this" for `narrow-roots`
- Check `maxChars` on `bounded-text` keys
- Honor `teamEnforceable: false` (never apply `!important` at team origin)
- Delete `TEAM_ORIGIN_DENIED` (the one-key list)

Until then the portal keeps its existing one-key list and a schema without the field must degrade gracefully.

## Contract and versioning

The schema is **unversioned**. Every consuming side implements:
- Missing field → unknown (never assume settable)
- New field → skip it (forward compatibility)
- Unrecognised value → treat as unknown

Changing the field name or shape is a breaking change. No field may be added lightly.

## Verification

- `golem verify` exit 0
- 6059 passed / 8 skipped
- Test: every setting control has `teamRule` equal to `teamRule(dotted)`
- Test: every setting is classified in `TEAM_POLICY` (no silent fallback)
- Test: one key per class publishes the exact rule (not derived from `teamRule()`)

## See also

- [[Team Layer]] — how team policy reaches a machine
- [[Settings Cascade]] — the seven origins, two bands, and how `!important` works
- `docs/decisions/ADR-0008-settings-cascade-and-importance.md` — settings importance and origin order
