---
task: DUSTSEC.4
title: "Bind the portal access token to its issuer origin — https only, never sent or re-sent to another host"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md P5/S4 (USER, 2026-10-08); SUMMARY.md S4; DUST1.10 D1"
gate: "Probe: a project file committing team.org_id + team.portal_url: \"https://attacker.example\" with a stored token for the real issuer — `golem team sync`, `golem init` and the team-skills sync send NO Authorization header to attacker.example (before: Bearer token sent). An http:// portal URL is refused. A 401 refresh never re-sends to a host other than the issuer. golem verify green by exit code."
touches: [src/portal/binding.ts, src/portal/client.ts, src/portal/config.ts, src/cli/commands/init.ts, src/cli/commands/team.ts, tests]
created: 2026-10-08
---

## What this is

A cloned repo can exfiltrate the member's portal token by committing `team.portal_url`.

**USER decision (verbatim, P5/S4):** BIND the portal token to its issuer origin: send only to the
issuing host, require https, never re-send a refreshed token to a different host. Covers
`binding.ts:131-135`, `client.ts:118-126,159-165,187-193`, `config.ts:46-70`.

## Evidence (SUMMARY S4)

Path: `binding.ts:131-135` → `init.ts:563` / `team.ts:692` → `client.ts:159-165`. Token looked up
by issuer, not matched to the API host (`client.ts:118-126`). 401 → refresh → re-send
(`:187-193`). No https check on either URL (`config.ts:46-70`). `REMOTE_DENIED_SETTINGS` does not
help: the vector is the committed project file. (Confirm the exact directory of these files —
`src/portal/` is assumed; grep `binding.ts`.)

## The work

1. Record the issuer origin (scheme + host + port) with the stored token; compare it to the
   request origin with an exact origin match before attaching `Authorization`.
2. Refuse non-https portal and issuer URLs (decide and document a loopback exception for tests
   only, if any test needs it — never on by default).
3. On 401: refresh only against the issuer; send the refreshed token only to the same origin.
4. Mismatch → no request with credentials, a clear error naming both origins, exit non-zero.
5. Tests for each probe in the gate.

## Hard rules

- Credentials never on a settings/log surface (ADR-0003): the error names origins, never the token.
- `src/interfaces/` frozen: update contract tests and flag dependents if a type changes.

## Out of scope

- S17 (`security.*` on `REMOTE_DENIED_SETTINGS`) — left open for the user (DECISIONS.md P4).
- Dropping `team.portal_url` (not the decision).
- Wiki page edits (DUST2.6 cites this task).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.
