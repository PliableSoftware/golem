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

## Design decision (2026-10-09, revised after review)

Scan inside over-length runs; never redact a whole run. `applyEntropy` (`src/pipeline/redaction.ts`)
runs `applyOverlengthRuns` over each unbroken run longer than 128 chars (found with a plain loop,
not a regex), then the unchanged 32-128 sweep. `redactText` repeats the whole stage while the
in-run scan finds something (hard bound 16 passes; reaching it throws `RedactionBoundExceeded`, so redaction fails closed), so fragments left by a cut are handled and
redact(redact(x)) equals redact(x). `findEmbeddedSecrets` (`src/pipeline/redaction-rules.ts`):

- Anywhere in the run: `sk-ant-` (tail bounded 512), `github_pat_`, `sk_live_`, `nsec1`
  (class derived from the named rule, bounded), `AccountKey=` value. Per-position chance rates are
  below 1e-12 and none occur in hex or base32.
- At the run's start or end only (300-char window), re-checked on every piece a cut leaves:
  the AWS family (skipped when the run is all uppercase alphanumerics, which is hex or base32
  data), `ghp_` family (exactly 36), `xox*-`, `AIza`+35, `sk-proj-`/`sk-svcacct-`/`sk-admin-`, and
  `sk-` + 48 alphanumerics. Touching spans keep their own placeholder kind.
- Placeholder kinds reuse the named rule's id and the same per-value table, so numbering is stable.

Why not a blanket rule: base64 images, thinking signatures and hex digests are legitimate long runs,
and a rewrite corrupts the request (the DUSTSEC.20 lesson). Why not "redact unless base64/hex": a
random key IS base64. Why AWS is edge-only: scanning it anywhere corrupted uppercase hex (6.6% of
4096-char dumps) because `ACCA` and `A3T` are valid hex and base32; measurements in
`docs/plan/verification-notes.md`. No rule order change, no named-rule change, `bypass_all` untouched.

Residual, pinned by tests: a plain over-length run with no named prefix; an edge-shape secret with
junk glued on both sides (or an AWS key glued to uppercase-only junk); a JWT whose prefix is glued
on. Follow-up, pre-existing and unrelated: the named rules overflow V8's regex stack on a 10 MB run
starting with `sk-ant-`/`sk-`; the `credit-card` rule rewrites Luhn-valid 13+ digit runs in hex dumps.

### Glued-shape matrix (final)

| Shape | key at end | key at start | key in middle |
| --- | --- | --- | --- |
| sk-ant, github_pat, sk_live, nsec1 | redacted | redacted | redacted |
| xoxb, sk-proj, sk-svcacct | redacted | redacted | redacted |
| AKIA, ghp_, gho_, sk- + 48, AIza | redacted | redacted | leaks (edge-only) |
| sk-None-, sk- + 51 | leaks | redacted | leaks |
| ya29. | redacted | leaks | redacted |

"End" is 100 junk chars + a documented-shape API id + the key; "start" is the key + id + 100 junk;
"middle" is 80 junk chars each side. Every run is over 128 chars. Measured on the final code with
`redactStandaloneText`, secret absent from the output = redacted. The same matrix on
`origin/development` leaked EVERY cell except: key-at-start for sk-ant, github_pat, nsec1,
sk-proj, sk-svcacct, sk- + 48, sk-None- and sk- + 51 (a run-start key has a word boundary), and
ya29. at end and in the middle (its dot ends the run). So this change is a strict improvement:
no cell is worse, and every glued shape in the first three rows is now closed at the end.
ya29. at the start leaks on both (not touched: the dot splits the run, and a short-prefix scan
there would chance-match).

**Residuals (known residual, not a feature), each pinned by a test:** an id plus an `sk-None-` style
key; an id plus an `sk-` key that is not 48 chars (a 51-char `sk-` key is only caught at the start);
an id plus a `ghp_` key with junk glued after it; an id, a `ghp_` key and junk in the middle of a
run; an `AIza` key in the middle of a run; a plain over-length run with no named prefix. Plus a
small false-positive rate: an uppercase base32 run holding one `-` or one lowercase character
loses the all-uppercase exemption, so an AWS-shaped edge can fire (measured over 2M random
512-char runs with one such character mid-run: `-` 6.95e-5 per run, one lowercase 7.55e-5 per run);
`sk-` + 48 alphanumerics at the edge of random base64url, about 2 x 64^-3 x (62/64)^48 = 1.7e-6 per
300-char run (derived).

**Fail closed at the pass bound:** `redactText` re-runs the stage while the in-run scan finds
something. If the bound (16) is reached with the scan still finding something, it throws
`RedactionBoundExceeded`; the proxy answers a pipeline throw, and a `redactOnly` throw, with a 502
and forwards nothing. Normal inputs need at most 2 passes (1200 random mixtures run at a bound of 3
without a throw).

**Pre-existing, found on the way, NOT fixed here:** (1) the named rules throw `RangeError: Maximum
call stack size exceeded` on 10 MB of repeated `sk-ant-` or `sk-` ending in `+` (greedy `{16,}` /
`{32,}` over a multi-megabyte run; verified with `redactIdentifierText`, unchanged code; the proxy
turns it into a 502). (2) the `credit-card` rule rewrites Luhn-valid digit runs of 13 or more
inside hex dumps.
