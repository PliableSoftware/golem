---
task: DUSTSEC.20
title: "The redaction walker rewrites 33 and 34 character API ids (server tool, batch and container ids), and the API rejects the placeholder"
state: done
owner: agent
size: M
discipline: code
design: "Found by the independent review of DUSTSEC.19 (2026-10-08). redactRequestBody has no exempt fields. The long-token rule matches unbroken runs of 32 to 128 characters, so API ids in that length band are replaced with a placeholder: measured on generated ids, a server tool use id was replaced about 93 percent of the time and a message batch id about 97 percent. The API rejects a placeholder because it breaks the id pattern, so a request that carries such an id fails. This ALREADY happens on POST /v1/messages on development; DUSTSEC.19 extended the same behaviour to the token-count and batches routes. Short ids (tool use and message ids, under 32 characters), metadata user ids, and long signatures or base64 (runs over 128 characters, or hex) are not affected; short signature or redacted-thinking values under 128 characters would be."
gate: "A failing-first test per id family shows the id survives redaction unchanged on messages, token-count and batches bodies; a secret that merely LOOKS like an id is still redacted: an exemption matches the strict anchored id shape only (known prefix, then base62 of the exact length the API uses), never a field name and never a bare length; the DUST2.24 level<=1 recorded-shape suite passes untouched; golem verify exit 0; an independent read-only review of the exemption before merge, because it is a redaction change."
depends_on: []
touches: [src/pipeline/redaction.ts, src/pipeline/redaction-rules.ts, tests]
created: 2026-10-08
updated: 2026-10-08T23:21:58.865Z
---

## What this is

A redaction false positive that breaks real requests. The fix must not weaken redaction: exempt only values that match a strict, anchored id pattern, and keep redacting anything else, including a secret placed in an id-named field. Check the real id formats against the Anthropic API documentation rather than guessing lengths, and record the dated finding in `docs/plan/verification-notes.md`.

## Out of scope

- Exempting fields by name.
- The gzip and byte-order-mark gap and the body size cap (DUSTSEC.21).

## Outcome

shipped; see the Phase 4 and 5 debrief
