---
task: DUSTSEC.22
title: "A secret in an unbroken run longer than 128 characters is never a high-entropy sweep candidate, so it can leak whole"
state: queued
owner: agent
size: M
discipline: code
design: "Found by the independent review of DUSTSEC.20 (2026-10-08). src/pipeline/redaction-rules.ts lines ~284-290: the entropy sweep matches only unbroken runs of 32 to 128 characters (ENTROPY_CANDIDATE_RE with a ceiling in ENTROPY_MAX_CANDIDATE_CHARS), so a run longer than 128 characters is never a candidate. A named rule that needs a word boundary does not fire when the secret is glued onto the end of another token with no boundary. Failing input class: an API object id (33 characters) immediately followed by a 120 character lowercase-prefixed secret with no separator, 141 characters in all; the named prefix rule requires a boundary before the prefix, and the sweep ignores the whole run, so the secret reaches the upstream. Pre-existing; not introduced by DUSTSEC.19 or DUSTSEC.20."
gate: "A failing-first test with runtime-built values shows an over-length unbroken run containing a named-prefix secret, and a plain over-length random run, are redacted (or the secret inside is), through process and the redactOnly fail-safe, on the messages path and the generic JSON walker; legitimate long values that must survive (very long base64 image data, signatures, hex digests) are decided deliberately: list which are exempt and why, with tests; the DUST2.24 level<=1 recorded-shape suite passes untouched; golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change."
depends_on: []
touches: [src/pipeline/redaction-rules.ts, src/pipeline/redaction.ts, tests]
created: 2026-10-08
---

## What this is

A redaction gap, but a design question hides in it: base64 image or document payloads and thinking signatures are legitimately long unbroken runs and must not be rewritten (that would corrupt requests, like the API-id problem in DUSTSEC.20). Decide how to chunk or scan an over-length run (for example scan inside it for named-prefix secrets rather than redacting the whole run), measure the effect on real request shapes, and write the decision down before changing behaviour.

## Out of scope

- The API-id exemption (DUSTSEC.20, merged).
- Encoded and non-JSON bodies (DUSTSEC.21).
