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
- **Team layer everywhere** (#287): one `loadEffectiveConfig` entry point routes all settings readers—`golem status`, config, TUI, VS Code, hooks, MCP, hot-reload—through the team layer. Default-deny policy table at `src/config/team-policy.ts` classifies all 78 settings leaves as settable, false-only, true-only, lower-only, narrow-roots or denied; an unclassified key is denied, and a team may only tighten (P4 amendment, revised from "teams may set any security setting" to "stricter only" on discussion).

## Default rules applied

No default rule decided any of these: all five touched frozen interfaces, hard-rule changes, or user-requested wording. Every choice was reviewed and decided before code changed. Team policy's 78-leaf table required four independent review passes, each finding real gaps.

## Open exceptions

Two decision gaps remain open and marked for follow-up:

- **R12.13 (unconfirmed)**: Does the relay notify when the dialog opens after R12.12 is removed? Not observed in live sessions; recorded in ADR-0002 as an open question, owner: user.
- **Relay answer to destructive/outward** (DUSTSEC.25): With the deny gone, nothing enforces Decision 61's off-by-default for a relay answer to a destructive or outward prompt. DUSTSEC.25 makes such answers ignored until the setting is on and the answer was freshly re-authenticated; it depends on R13.9 and has an open question on whether a hook can intercept the relay answer at all.

## What review caught

Four review rounds on the team policy table (PRs #287):

1. **First round**: a team could still loosen plugins, endpoints, gateways, personas, LSP servers, compression and numeric limits, and one hostile cache row crashed every reader. A deny-list cannot be completed key by key, so the design became default-deny over a table that is a total type over the schema.
2. **Second round**: the table was only a start. Gaps found: `plugins.enabled=false` would drop org redaction plugins; `compression.level` and `force_semantic_on_caching` could force lossy compression; the timeouts, `brevity.level` and several knowledge toggles were misclassified.
3. **Third round**: `narrow-roots` accepted roots the consumer treats as different roots, a cap of 0 meant no cap, and refused-key warnings leaked a URL password and an API key prefix.
4. **Fourth round**: no way to loosen anything was found. Remaining defects were honesty ones: status reported rows as applied after a whole layer was skipped, a skip warning echoed the team's value, an overridden row still showed as applied.

Session dropframe (#286): the first review found that the new duplicate check dropped live events after a bus restarted under the same session id, and that host shutdown was shown as a backpressure drop, so the page reconnected forever. The second review found residuals: `attached` still sent `id: 0`, shutdown published `ended` twice, and three tests passed on the old code.

## Lessons

- **Deny tables don't answer the hard questions.** A deny-list approach shifts every refusal decision to the code that reads it, scattering policy logic. Default-deny with a type describing what IS allowed is auditable: one table, not a grep.
- **Four reviews on one change is not excessive.** Each round on the policy table found a real gap the previous fixes had left open. A pattern worth repeating: define the structure first (the type), make it pass code review as a standalone thing, THEN wire it everywhere.
- **"Stricter" depends on the key.** For `plugins.enabled`, false looks stricter but weakens redaction; for `auto_index_max_files`, 0 means no cap. Direction has to be decided per key, against what the key does.
- **A reviewer's job is to break it.** The session fix's own tests did not run the restart or shutdown scenarios; the reviewers reasoned through them and found both regressions.

## Follow-ups filed

- **DUSTSEC.25**: A relay answer to destructive/outward should be ignored unless Decision 61 is on and the answer was freshly re-authenticated (depends on R13.9).
- **team-security-stricter-only** remaining items: a raise-only class for numbers where higher is stricter, and member-relative refusals in the team sync report.
- **R12.13**: Live confirmation of whether a relay is notified when the native dialog opens (unconfirmed).

## Related pages

[[Team Layer]] — the one loader entry point and default-deny policy table. [[Settings Cascade]] — where team sits relative to user and member layers. [[Autonomy Gate]] — the restored ask-the-human behaviour and ADR-0002 amended. [[Hosted Session]] — Decision 61 and its three constraints now documented to apply there. [[Device Authentication]] — the hosting case covered. [[Session Transport]] — the drop frame contract, amended. [[Plan Tasks]] — blocked as metadata instead of a state.
