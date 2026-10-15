---
task: DUSTSEC.6
title: "Buzz keygen parser: drop the `g` flag on HEX64_RE so the secret key can never be written as the pubkey"
state: done
owner: agent
size: S
discipline: code
design: "SUMMARY.md S6; DUST1.10 D2"
gate: "For `secret: <S>\\npublic: <P>` (and the reversed order, and positional-only output) the parser returns pubkeyHex = P, secretHex = S (before: pubkeyHex = S). A test asserts the committed manifest written by provisionBuzz never contains the secret. golem verify green by exit code. R14.2 lists this task in depends_on."
depends_on: []
touches: [src/buzz/identity.ts, src/buzz/provision.ts, tests/unit/buzz]
created: 2026-10-08
updated: 2026-10-08T10:26:10.459Z
---

## What this is

HIGH but not reachable today. `HEX64_RE = /\b[0-9a-f]{64}\b/gu` (`src/buzz/identity.ts:59`) is
reused with `.exec` (`:115-116`), so `lastIndex` makes the labelled branch fail and the
positional fallback (`:121`) swaps the keys. The secret then lands in the committed
`.golem/buzz/agents.json` (`provision.ts:224-235`). No CLI reaches `provisionBuzz` yet; R14.2
adds one, so **R14.2 must not ship before this** (its `depends_on` names DUSTSEC.6).

## The work

1. Remove the `g` flag (or use a fresh non-global regex per match); check every other use of the
   constant.
2. Make the positional fallback refuse ambiguous output rather than guess (error, nothing written).
3. Defence in depth: before writing the manifest, assert the pubkey is not the secret.
4. Tests for each gate case.

## Hard rules

- Secrets never written to a committed file or log (ADR-0003).

## Out of scope

- R14.2 itself (`golem buzz provision`).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
