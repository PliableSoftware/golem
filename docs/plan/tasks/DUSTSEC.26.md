---
task: DUSTSEC.26
title: Card rule misses a card preceded by digits and a space
state: done
owner: agent
size: M
discipline: code
design: Found during DUSTSEC.24 (#304); the credit-card rule and `isCreditCardLike` in src/pipeline/redaction-rules.ts; Redaction Stage wiki page
gate: A failing-first test shows a card preceded by digits and a space (for example '12 4111 1111 1111 1111') is currently NOT redacted and is redacted after the change, while every existing card, hex-dump, hash and irregular-grouping case keeps its current result; rule order and ids unchanged; a differential against the previous rule over seeded random and adversarial texts shows no previously redacted span becomes unredacted; an independent review of the redaction change; golem verify green by exit code.
depends_on: []
touches: [src/pipeline]
created: 2026-10-15
updated: 2026-10-20T07:01:15.210Z
---

## What this is

A card number that is preceded by digits and a single space, for example `12 4111 1111 1111 1111`,
is swallowed whole by the card pattern: the match starts at the leading `12`, so the candidate is
the whole digit run with its separators. That run is then rejected by the grouping check in
`isCreditCardLike` as irregularly grouped, so nothing is redacted and the real card is missed.

This is present in the original rule as well as after DUSTSEC.24 (#304), which found it and left it
alone as out of scope. It is a hard-rule change (redaction), so it needs an independent review and a
differential test against the old rule. The hard rule applies: redaction must never be weakened, and
a leak loses to idempotence.

## Out of scope

- The DUSTSEC.24 hex-dump exemption and its accepted weakenings.
- Any new card network or grouping scheme beyond the current ones.

## Outcome

shipped: card suffix retry, reviewed
