---
task: DUSTSEC.10
title: "Restore asking the human at PermissionRequest: remove the unconditional R12.12 hard deny (USER decision 2026-10-09)"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R8 (USER, 2026-10-08); SUMMARY.md contradiction R8; ADR-0002; R12.12, R12.13; src/hooks/permission-request.ts header"
gate: "With the hard deny removed, a destructive or outward call reaches Claude Code's own permission dialog (the hook returns no decision for those classes); `allow` is still NEVER emitted for them (ADR-0002 invariant 5); the other classes behave as before; a regression test fails on the current code (it denies) and passes after; ADR-0002 is amended with a dated note recording the restored behaviour and the open R12.13 question (does a connected channel relay now get notified when the dialog opens: unconfirmed); golem verify exit 0; an independent read-only review before merge, because this is the autonomy gate."
touches: [src/hooks/permission-request.ts, src/autonomy/gate.ts, src/autonomy/index.ts, docs/plan/verification-notes.md, tests]
created: 2026-10-08
---

## DECIDED (USER, 2026-10-09)

Back to ask the human. The recommendation was to accept the unconditional deny and amend ADR-0002; the user chose to restore asking instead. The 2026-10-08 verify step found no signal for a connected relay at this hook, so the conditional version is not possible: remove the hard deny at `PermissionRequest` for the destructive and outward classes so the native dialog appears again. Consequence to record in ADR-0002: with a permission-relay channel connected, the relay may be notified when the dialog opens (the very thing R12.12 prevented); R12.13 (does it) stays unconfirmed. See `docs/plan/audit/dust-1/DECISIONS.md` R8.

## What this is (original brief, superseded by the decision above)

ADR-0002 promises destructive/outward → `ask` (a human decides). R12.12 added a hard `deny` at
`PermissionRequest` so a connected channel's permission relay is never triggered — but it denies
for everyone, so a human at the terminal is never offered the dialog.

**USER decision (verbatim, R8):** the R12.12 hard deny at `PermissionRequest` applies ONLY when a
relay channel is connected. First task step: VERIFY a "relay connected" signal exists at that
hook; R12.13 (does the deny pre-empt the relay) is still unconfirmed, so record that in the task.

## Recorded caveats

- **R12.13 is unconfirmed.** Nobody has observed live whether the `PermissionRequest` deny
  pre-empts the relay (R12.13 is `owner: user`, queued, needs a real interactive session).
  SUMMARY's hygiene list says "R12.13's blocker is resolved" — that is the R12.12-shipped half of
  its blocker, not the live confirmation.
- **Planner pre-check (2026-10-08): no such signal was found in `src/`.** `grep` for a
  channel/relay-connected flag finds only prose in `src/hooks/permission-request.ts:7-15` and
  `src/autonomy/gate.ts:70`; the hook payload subset it reads carries no channel state. Step 1
  must confirm against the live hooks reference (`code.claude.com/docs/en/hooks`, the
  `PermissionRequest` input schema) and the channels reference, and record the finding with a date
  in `docs/plan/verification-notes.md`.

## The work

1. **Verify** (above). Candidate signals to check, in order: a field on the documented
   `PermissionRequest` input; an env var Claude Code sets when `--channels` is active; a state file
   Golem's own channel/pairing server writes while connected (`src/remote`, device pairing). A
   Golem-owned "connected" marker is acceptable ONLY if it is written on connect and cleared on
   disconnect/crash (stale-marker case tested).
2. If no reliable signal exists: STOP. Record it in verification-notes, leave the deny as is, and
   report back — the user decides next.
3. If one exists: make `decidePermissionRequest` deny only when connected; otherwise emit no
   decision (native flow). Unknown/unreadable signal → keep denying (fail safe toward the relay
   not firing).
4. Tests: connected / not connected / stale marker / unreadable.

## Hard rules

- No path ever emits `allow` (R12.12 SAFETY comment).
- Redaction untouched.

## Out of scope

- R12.13's live confirmation (owner: user). ADR-0002 amendment text (DUST2.3).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.
