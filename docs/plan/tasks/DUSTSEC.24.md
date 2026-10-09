---
task: DUSTSEC.24
title: "Named redaction rules overflow the stack on pathological input, and the credit-card rule rewrites digit runs inside hex dumps"
state: queued
owner: agent
size: M
discipline: code
design: "Two pre-existing defects found during DUSTSEC.22 (2026-10-09), neither introduced by it. (1) Several named rules in src/pipeline/redaction-rules.ts throw RangeError (maximum call stack size exceeded) on 10 MB of repeated sk-ant- or of sk- ending in +; the same input also throws through redactIdentifierText. The proxy turns the throw into a 502 (src/proxy/server.ts around the pipeline call), so nothing is forwarded, but any client can make a request fail by sending such a body, and the fail-safe path cannot redact it. Consecutive ghp_ keys also scale worse than linearly (50,000 keys took 7.4 s), identically on development. (2) The credit-card rule rewrites Luhn-valid runs of 13 or more digits, including inside long hex dumps, which corrupts legitimate values."
gate: "Failing-first tests: 10 MB of repeated sk-ant-, of sk- ending in +, and of ghp_ keys complete in linear time with no RangeError through process and redactOnly and produce the same placeholders as a chunked equivalent; a long hex dump containing a Luhn-valid digit run is not altered by the credit-card rule, while a real card number with ordinary separators or in prose is still redacted (decide the boundary rule, write it down, and test both sides); rule order and every other rule unchanged; tests/contract/ passes untouched; golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change."
depends_on: []
touches: [src/pipeline/redaction-rules.ts, src/pipeline/redaction.ts, tests]
created: 2026-10-09
---

## What this is

A regex that recurses or backtracks on adversarial input, and a rule that is too eager in one context. Find the exact patterns that overflow before changing them (probe each named rule with a 10 MB repeated-prefix input under a timeout), fix by bounding or rewriting the patterns, and measure.

## Out of scope

- The over-length run scan itself (DUSTSEC.22, merged) and the request-size limit (DUSTSEC.21, merged).
