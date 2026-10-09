---
title: "2026-10-09 User Decisions: estimates, blocked metadata, permissions, session contracts, and team policy"
type: debrief
tags: [decision, team-layer, autonomy, session, cleanup, policy]
sources: [docs/plan/tasks/readme-estimates-claim.md, docs/plan/tasks/adr-p3-p4-amendments.md, docs/plan/tasks/blocked-is-metadata.md, docs/plan/tasks/session-dropframe-seq-and-hostlog.md, docs/plan/tasks/team-layer-everywhere.md, docs/plan/tasks/DUSTSEC.10.md, docs/plan/tasks/DUSTSEC.25.md]
created: 2026-10-09
updated: 2026-10-09
---

# 2026-10-09 User Decisions: five decision records and the team layer shipped

Five user decisions landed in PRs #283–#287: two rewrites (estimates and blocked), two frozen-contract changes (permissions and session), and one application of the team layer everywhere. This batch is the user-decision backlog, cleared on 2026-10-09.

## Outcome

- **Estimates claim reworded** (#283): savings and token counts from the code are documented as char/4 estimates; only the cache report uses billed API usage. README, spec, and wiki pages corrected.
- **Blocked field clarified** (#284): a task's `blocked:` is metadata on a queued state, not a state itself. Parsing keeps compatibility; docs and types align.
- **Permission dialog restored** (#285): the R12.12 unconditional deny at `PermissionRequest` is removed so destructive/outward calls open the native dialog. A connected relay channel may be notified (unconfirmed); ADR-0002 amended with that gap.
- **Session drop frame** (#286): when a subscriber closes for backpressure, a `SessionDroppedFrame` with no `seq` and no SSE `id:` line is sent (not a `SessionEvent`). Host log rotates by rename at 5 MiB. Frozen contract amended with dated note.
- **Team layer everywhere** (#287): one `loadEffectiveConfig` entry point routes all settings readers—`golem status`, config, TUI, VS Code, hooks, MCP, hot-reload—through the team layer. Default-deny policy table at `src/config/team-policy.ts` with 78 leaves; only `security.*` keys permitted (tightening only, per P4 amendment).

## Default rules applied

No default rule decided any of these: all five touched frozen interfaces, hard-rule changes, or user-requested wording. Every choice was reviewed and decided before code changed. Team policy's 78-leaf table required four independent review passes, each finding real gaps.

## Open exceptions

Two decision gaps remain open and marked for follow-up:

- **R12.13 (unconfirmed)**: Does the relay notify when the dialog opens after R12.12 is removed? Not observed in live sessions; recorded in ADR-0002 as an open question, owner: user.
- **Relay answer to destructive/outward** (DUSTSEC.25): A relay channel can now answer (the deny is gone), but should such answers be ignored by Golem unless Decision 61 is on and the answer was freshly re-authenticated? Task filed for R13.9 (when the setting ships).

## What review caught

Four review rounds on the team policy table (PRs #287):

1. **First round**: deny-list cannot be completed key by key (a key with no declared stricter direction was denied, but whose job is to decide that?). Switched to default-deny with a full type describing allowed keys.
2. **Second round**: member-relative refusals in the sync report (a member's team-set value marked `[pending]` when the team's value will override it). Not yet shipped (relative to member layer).
3. **Third round**: invalid values from the portal must hide details (show the key, not the value or Zod's rejection). Member-layer invalids still show detail.
4. **Fourth round** (the ship): honest reporting—`team.applied` reconciled against what the loader resolved, policy refusals omitted from `unknown_keys`, the `false`-only keys (`knowledge.repo_map_enabled`, `knowledge.syntax_aware_chunking`) enforced.

Session dropframe (#286): a second reviewer found a regression in the restart/shutdown sequence (the closed bus refusing late subscribers) and a missing `epoch` guard on the attached event when a resume rebuilds the bus under the same session id.

## Lessons

- **Deny tables don't answer the hard questions.** A deny-list approach shifts every refusal decision to the code that reads it, scattering policy logic. Default-deny with a type describing what IS allowed is auditable: one table, not a grep.
- **Four reviews on one change is not excessive.** Each round on the policy table found a real gap the previous fixes had left open. A pattern worth repeating: define the structure first (the type), make it pass code review as a standalone thing, THEN wire it everywhere.
- **"Stricter only" has edges.** What direction is "stricter" for a setting with no clear ordering? `phone_approval` (a new setting, not yet built) has none, so teams cannot enable it even when R13.9 lands. That is the intended behaviour, and it is worth calling out rather than letting it confuse later.
- **A second reviewer's job is to break it.** Session dropframe landed because a first author's own tests did not run the restart scenario. The second reviewer ran it and found both the regression and the missing guard.

## Follow-ups filed

- **DUSTSEC.25**: A relay answer to destructive/outward should be ignored unless Decision 61 is on and the answer was freshly re-authenticated (depends on R13.9).
- **team-security-stricter-only** remaining items: raise-only class for keys that can never be loosened (a stricter-only tightening that never widens), and member-relative refusals in the team sync report.
- **R12.13**: Live confirmation of whether a relay is notified when the native dialog opens (unconfirmed, owner: user).

## Related pages

[[Team Layer]] — the one loader entry point and default-deny policy table. [[Settings Cascade]] — where team sits relative to user and member layers. [[Autonomy Gate]] — the restored ask-the-human behaviour and ADR-0002 amended. [[Hosted Session]] — Decision 61 and its three constraints now documented to apply there. [[Device Authentication]] — the hosting case covered. [[Session Transport]] — the drop frame contract, amended. [[Plan Tasks]] — blocked as metadata instead of a state.
