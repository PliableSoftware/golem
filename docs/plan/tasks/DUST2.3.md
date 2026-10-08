---
task: DUST2.3
title: "ADR amendment notes for the drifted ADRs (0001–0008) and the 2026-10-08 decisions"
state: queued
owner: agent
size: M
discipline: write
design: "SUMMARY.md drift groups ADR-0001..ADR-0007 (:306-339) and contradictions K1, P1, P2, P7; DECISIONS.md R2, R3, R5, R6, R8, R10, R12, G2"
gate: "Each listed ADR carries a dated amendment note (or a new superseding ADR where named) that resolves its SUMMARY drift rows and applies its DECISIONS.md items; no ADR body text is rewritten (ADRs are immutable except status + amendments); docs/wiki/WIKI.md / the ADR index lists any new ADR. golem wiki check green by exit code."
depends_on: [DUST2.1]
touches: [docs/decisions]
created: 2026-10-08
---

## What this is

ADRs are immutable except for status. Each drifted ADR gets an **amendment note** appended
(dated 2026-10-08, citing DECISIONS.md and the SUMMARY row ref), or a superseding ADR.

## Per ADR

| ADR | change | source |
|---|---|---|
| ADR-0001 file watcher | **New superseding ADR** recording the polling watcher that actually ships; ADR-0001 status → Superseded | 1.4/r089, K1 (default rule) |
| ADR-0002 approval gates | Amendment: destructive/outward → `ask`, with the R12.12 `PermissionRequest` deny applying only when a relay channel is connected (pending DUSTSEC.10's signal verification; R12.13 unconfirmed). Newline-classification fix (DUSTSEC.5) | 1.7/r017, r019, R8 |
| ADR-0003 credentials | Amendment: invariant 4 → "keys never enter model context or tool output"; model-chosen `coder` target stays (D27/D35). Rows on invariant 1 and account→gateway selector | 1.2/r020, r021, r034, R10 |
| ADR-0004 retire slider | Amendment: `/__golem/pipeline/false` and `x-golem-bypass` removed (DUSTSEC.2), so `bypass_all` is again the only redaction-off path; agent Bash denied `golem off` (DUSTSEC.3); R12 scope of "no tool call can change pipeline depth" | 1.1/r094, R2, R3, R4, R12 |
| ADR-0005 plugin seams | Amendment: "structurally" → "cannot via the API; a plugin has process authority anyway" (R5); plugin rules apply on every redaction path — proxy, MCP, hook, vibe, join-queue (R6) | R5, R6 |
| ADR-0006 remote steering | Amendment notes for what superseded §2, §3a, §4, §7, §8; mTLS pairing row | 1.10/r005, P7 (default rule) |
| ADR-0007 hosted sessions | Amendment: `host.ts` follows §3a (multi-turn stream-json), superseding Revision 2's "do not attempt"; map the code/wiki "invariant 8" to the ADR's numbering | 1.10/r012, P1, P2 (default rule) |
| ADR-0008 settings cascade | Amendment: invalid team value warns and skips the team layer (DUSTSEC.14) | G2 |

Where an amendment describes code a DUSTSEC task has not landed yet, say "decided 2026-10-08,
implemented by DUSTSEC.n" — do not claim it ships.

## Out of scope

- The spec (DUST2.2), wiki concept pages (DUST2.4–2.8).
- Open exceptions (P3, P4) — note them as open if an ADR touches them; do not decide.

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.
