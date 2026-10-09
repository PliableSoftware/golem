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

## Design decision (2026-10-09)

Scan inside over-length runs; never redact a whole run. `applyEntropy` (`src/pipeline/redaction.ts`)
first runs `applyOverlengthRuns` over each unbroken run longer than 128 chars, then the unchanged
32-128 sweep (fragments left by a cut are swept in the same pass, so redaction stays idempotent).
`findEmbeddedSecrets` (`src/pipeline/redaction-rules.ts`) returns spans:

- Anywhere in the run: `sk-ant-`, `github_pat_`, `sk_live_`, AWS `AKIA`-family + 16, `nsec1` (class
  derived from the named rule), `AccountKey=` value. Chance occurrence per position is ~1e-10 or less.
- At the run's start or end only (window of 300 chars, never the middle): `ghp_`-family, `xox*-`,
  `AIza`+35, `sk-`. Short prefixes that chance-match about once per MB of base64url.
- Placeholder kinds reuse the named rule's id and the same per-value table, so numbering is stable.

Why not a blanket rule: base64 images, thinking signatures and hex digests are legitimate long runs,
and a rewrite corrupts the request (the DUSTSEC.20 lesson). Why not "redact unless base64/hex": a
random key IS base64. No rule order change, no named-rule change, `bypass_all` untouched.

Linear: literal-prefix patterns plus a 300-char window; 1 MB runs of repeated prefixes finish in
under 60 ms (a 1 MB run with a key glued on the end: about 280 ms, test-bounded at 3 s).

Residual, pinned by a test: a plain over-length run with no named prefix; a short-prefix secret with
junk glued on both sides; a JWT with a glued prefix and a segment over 128 (dots end the run). A
random base64url blob has roughly a 1e-3 chance of a false edge match on `sk-` per run, which is
rare in practice (signatures and images are standard base64, which has no `-`).
