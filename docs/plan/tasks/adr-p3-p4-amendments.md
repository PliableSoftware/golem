---
task: adr-p3-p4-amendments
title: "Record the P3 and P4 decisions in the spec and the ADRs: Decision 61 reaches hosted sessions; teams may set security settings only toward stricter values (USER decisions)"
state: queued
owner: agent
size: S
discipline: write
design: "docs/plan/audit/dust-1/DECISIONS.md P3 and P4 (USER, 2026-10-09; both chose the less restrictive option against the recommendation); docs/golem-spec.md Decisions 59, 60(d), 61 and the open-contradictions section; docs/decisions/ADR-0006 (remote steering) and ADR-0008 (the team layer); docs/wiki/concepts/Team Layer.md, Hosted Session.md and Device Authentication.md."
gate: "Dated amendment notes (never a rewrite of the decision text) record: Decision 61's opt-in setting applies to hosted sessions too, so Decision 60(d) is amended (P3: consistent with local sessions; Decision 61's safeguards of off by default, fresh re-authentication per answer, a loud log and a kill switch apply there too); a team may set a security.* key only toward a STRICTER value and can never loosen one, with a key that has no declared stricter direction denied remotely (P4, revised 2026-10-09; consistent with the existing proxy.bypass_all ban), so a team cannot enable phone approval even once R13.9 exists; the open-contradictions section of the spec moves P3 and P4 from OPEN to DECIDED with the date; R13.9's task doc gains a line that it must honour both decisions; the wiki pages that listed P3 and P4 as open are updated; golem wiki check and golem verify exit 0."
depends_on: []
touches: [docs/golem-spec.md, docs/decisions, docs/wiki/concepts, docs/plan/tasks/R13.9.md]
created: 2026-10-09
---

## What this is

Two security decisions recorded in the documents that carry them. The P4 rule needs code, carried by `team-security-stricter-only`; this task only records both decisions. The phone-approval setting is not built (R13.9 is queued), so P3 describes the intended behaviour for when it is built.

## Out of scope

- Building R13.9.
- Reopening either decision.
