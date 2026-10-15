---
task: DUSTSEC.25
title: "A permission-relay answer to a destructive or outward prompt is ignored unless the Decision 61 setting is on and the answer was freshly re-authenticated"
state: queued
owner: agent
size: M
discipline: code
design: "ADR-0007 item 3 (a device answering destructive/outward) and spec Decision 61 (the setting, and 61(c) the constraints that are not optional). DUSTSEC.10 (2026-10-09, USER decision) removed the unconditional R12.12 deny at PermissionRequest, so a destructive or outward call now opens the native dialog and a connected permission-relay channel may be notified of it (R12.13 unconfirmed). Nothing on Golem's side now stops a relay answer from approving such a call. This task closes that gap on the ANSWER side: Golem does not own the dialog, so it must refuse to honour a relayed answer instead of refusing to open the dialog."
gate: "A relayed answer to a destructive or outward prompt has no effect unless the Decision 61 setting is on AND that answer carried a fresh user-factor re-authentication; every other combination is ignored and logged; read/write/unknown answers are unchanged; allow is never emitted by any Golem hook for destructive/outward; each of the three cases (setting off, setting on without re-auth, setting on with re-auth) asserted by its own test; golem verify exit 0; an independent read-only review before merge, because this is the autonomy gate."
depends_on: [R13.9]
touches: [src/autonomy/, src/hooks/, src/config/, src/remote/, tests, docs/decisions/ADR-0002-autonomy-approval-gates.md]
created: 2026-10-09
---

## What this is

With the R12.12 deny gone, the class line (destructive/outward are never approved remotely) is no longer enforced by Golem against a permission-relay answer. R13.9 builds the gate-map setting for item 3 (default off, fresh re-authentication per answer, loudly logged, kill switch); this task wires it so a relay answer to a destructive/outward prompt is ignored unless that setting is on and the answer was freshly re-authenticated.

## Open question (decide first, record in verification-notes)

Where can Golem intercept the answer? R12.13 (does the relay fire at all when the dialog opens) is unconfirmed and owner: user. If the relay path is not interceptable from a hook, record that and stop; the user decides next.

## Hard rules

- No path emits `allow` for destructive/outward (ADR-0002 invariant 5).
- Redaction untouched. The PreToolUse bypass guard and the `golem off`/`bypass_all` deny are separate and stay.

## Out of scope

- R12.13's live confirmation (owner: user). Hosted sessions (their gate refuses outright, ADR-0007 invariant 2).
