---
title: "DUSTSEC.26: a card preceded by digits and a space is now redacted"
type: debrief
tags: [dust, dustsec, redaction, credit-card, hard-rule]
sources: [docs/plan/tasks/DUSTSEC.26.md, src/pipeline/redaction.ts, src/pipeline/redaction-rules.ts, tests/unit/pipeline/redaction-card-prefix.test.ts]
created: 2026-10-20
updated: 2026-10-20
---

# DUSTSEC.26: card preceded by digits and a space

Follow-up to DUSTSEC.24 (#304). Rule context on [[Redaction Stage]].

## Outcome

- A card written after a short digit group (`12 <card>`) was swallowed by the greedy card pattern, rejected whole by `isCreditCardLike` as irregularly grouped, and left in the clear. It is now redacted and the leading digits stay.
- New optional `retryStarts` on a redaction rule. When the full match is rejected by `validate` or `validateAt`, `applyRule` retries the suffixes after each separator (longest first). The credit-card rule supplies `cardSuffixStarts`.
- Rule order and ids are unchanged. The retry runs only for a match the old rule skipped, so a span redacted before is never changed.

## Known limit

The pattern caps a match at 19 digits and must end before a separator or a non-digit. A prefix long enough that the card falls past that cap (for example `2026 10 20 <card>`, 24 digits) is split into two matches and the card is still missed. Out of scope here; a follow-up would extend the retry beyond the match end.

## Lessons

- Redaction by exact span: retrying a sub-span is safe only because it is gated on the old rule's rejection.
- Uniform-grouping check can now accept a chance Luhn-valid uniform suffix of a byte dump; the dump itself, irregular, stays untouched (tested).

## Tests

`tests/unit/pipeline/redaction-card-prefix.test.ts`: failing-first cases for the miss, guards (byte dump, Luhn-invalid, hex-glued), and a seeded differential showing no card placeholder is lost against the old rule.
