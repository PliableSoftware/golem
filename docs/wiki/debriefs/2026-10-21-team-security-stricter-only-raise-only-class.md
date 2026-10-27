---
title: Team Security — raise-only class and security direction enforcement
type: debrief
tags: [team, security, policy, enforcement]
sources: [docs/plan/tasks/team-security-stricter-only.md, docs/plan/tasks/team-layer-everywhere.md, docs/decisions/ADR-0008-settings-cascade-and-importance.md, docs/wiki/concepts/Team Layer.md, docs/wiki/concepts/Settings Cascade.md, src/config/team-policy.ts, tests/unit/config/team-policy.test.ts]
created: 2026-10-21
updated: 2026-10-21
---

# Team Security — raise-only class and security direction enforcement

A team may set security settings only to stricter values, never loosen a member's machine. This task completed the enforcement by adding the `raise-only` class for numeric settings where higher is stricter, and adding a test gate that fails when a new security key lacks a declared direction.

## What shipped in team-layer-everywhere (not this task)

The heavy lifting: per-direction enforcement logic, test suites for each direction type (false-only, true-only, lower-only, narrow-roots), member-relative value comparison at load time, and the warning path when a team tries to loosen a member's value. Every security and non-security key was classified.

## What this task added

**`raise-only` class.** A numeric setting where higher values are stricter. The team value must be ≥ the value the member would otherwise have, judged at load time like `lower-only`. Applied to `knowledge.local_answer_min_confidence`: a higher floor means fewer local answers are generated (stricter), so a team cannot lower it.

**`SECURITY_DIRECTIONS` test.** A table in `tests/unit/config/team-policy.test.ts` enumerates every security.* key and its declared direction. The test fails if:
- A new `security.*` key exists in the schema but has no entry in the table
- A stale entry remains for a deleted key
- A key's table direction mismatches `TEAM_POLICY` in `src/config/team-policy.ts`

Fail-closed: a key with no declared direction is denied.

**Security classification (final).** Eight security keys classified:

| Key | Stricter direction | Reasoning |
|---|---|---|
| `security.write_port` | none (denied) | A port has no value ordering |
| `security.write_lan` | false-only | `true` exposes the write surface to LAN |
| `security.unlock_window_minutes` | lower-only | Shorter unlock window is stricter |
| `security.idle_relock_minutes` | lower-only | Relocks sooner |
| `security.step_up_max_age_minutes` | lower-only | Fresher step-up required |
| `security.device_cert_days` | lower-only | Shorter cert lifetime |
| `security.join_injection` | false-only | `true` widens what a join can inject |
| `security.origination_roots` | narrow-roots | Empty means all roots; a subset is stricter |

## Review findings (independent read-only)

No blocking defects found. Reviewer confirmed:
- Raising `knowledge.local_answer_min_confidence` to a higher floor reduces local answers (confirms the stricter direction)
- Worst-case team enforcement: raising to 1.0 (same effect as `local_answer_enabled: false`)
- `SECURITY_DIRECTIONS` test will catch accidental omission of new security keys

## Verification

`golem verify` exit 0: **5979 passed / 8 skipped**

One commit-time verify run failed with an unidentified timing anomaly (load-flake pattern, not confirmed). The same commit passed in isolation and on re-run. No test flake was reproducible in `test:serial`.

## Known gaps

`golem team sync` report cannot show member-relative refusals (`lower-only`, `raise-only`, `narrow-roots`) because it lacks access to the member's own value. Visible only as load-time warnings and in `team.skipped` list. Candidate follow-up task.

Existing behaviour (not changed): a malformed team value skips the entire team layer, including its tightenings. Candidate follow-up task.

## See also

- [[Team Layer]] — how team settings reach a machine and are enforced
- [[Settings Cascade]] — the seven origins and importance rules
- ADR-0008 `docs/decisions/ADR-0008-settings-cascade-and-importance.md` — the cascade model and what "stricter" means per direction
