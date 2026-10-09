---
task: adr-p3-p4-amendments
title: "Record the P3 and P4 decisions in the spec and the ADRs: Decision 61 reaches hosted sessions; teams may set security settings (USER decisions)"
state: queued
owner: agent
size: S
discipline: write
design: "docs/plan/audit/dust-1/DECISIONS.md P3 and P4 (USER, 2026-10-09; both chose the less restrictive option against the recommendation); docs/golem-spec.md Decisions 59, 60(d), 61 and the open-contradictions section; docs/decisions/ADR-0006 (remote steering) and ADR-0008 (the team layer); docs/wiki/concepts/Team Layer.md, Hosted Session.md and Device Authentication.md."
gate: "Dated amendment notes (never a rewrite of the decision text) record: Decision 61's opt-in setting applies to hosted sessions too, so Decision 60(d) is amended; REMOTE_DENIED_SETTINGS gains no security.* key and teams may set security.* settings; the combined consequence is stated plainly (once the phone-approval setting exists in R13.9, a team push or a compromised portal could switch it on for every member; the user accepted this); the open-contradictions section of the spec moves P3 and P4 from OPEN to DECIDED with the date; R13.9's task doc gains a line that it must honour both decisions; the wiki pages that listed P3 and P4 as open are updated; golem wiki check and golem verify exit 0."
depends_on: []
touches: [docs/golem-spec.md, docs/decisions, docs/wiki/concepts, docs/plan/tasks/R13.9.md]
created: 2026-10-09
---

## What this is

Two security decisions recorded in the documents that carry them. No code changes: today `REMOTE_DENIED_SETTINGS` contains no `security.*` key and the phone-approval setting is not built (R13.9 is queued), so the decisions describe the intended behaviour for when it is built.

## Out of scope

- Building R13.9.
- Reopening either decision.
