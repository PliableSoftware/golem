---
task: DUSTSEC.10
title: "R12.12 PermissionRequest deny applies only when a relay channel is connected — verify the signal first"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R8 (USER, 2026-10-08); SUMMARY.md contradiction R8; ADR-0002; R12.12, R12.13; src/hooks/permission-request.ts header"
gate: "Step 1 report exists: whether a 'relay channel connected' signal is observable from the PermissionRequest hook, with evidence. If yes: with no channel connected a destructive/outward call reaches the native permission dialog (before: denied, the human never asked); with a channel connected it is still denied. If no: the task stops after step 1 and records the gap — it does not invent a heuristic. golem verify green by exit code."
touches: [src/hooks/permission-request.ts, src/autonomy/gate.ts, src/autonomy/index.ts, docs/plan/verification-notes.md, tests]
created: 2026-10-08
---

## What this is

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
