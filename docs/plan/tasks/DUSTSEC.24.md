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

## Findings (2026-10-09, probe on branch fix/dustsec24-rules-stack)

Method: each named rule's pattern run over input repeated or padded to 1, 2 and 10 MB, one process per case, 40 s timeout; then the whole stage (`redactStandaloneText`, which `process` and `redactOnly` both call per string) and the rule-only path (`redactIdentifierText`). "Single run" = one unbroken 10 MB run of the rule's own charset after its prefix.

| Rule | Input | Before | After |
| --- | --- | --- | --- |
| anthropic-key | repeated `sk-ant-`, or `sk-ant-` + 10 MB tail (single run) | RangeError at 10 MB (ok at 4 MB) | 25 ms, one placeholder |
| openai-key | `sk-` + 10 MB tail, ending in `+` or `-` | RangeError at 10 MB | 30-45 ms |
| slack-token | `xoxb-` + 10 MB | RangeError | 50 ms |
| jwt | `eyJ` + 10 MB in any of the three segments | RangeError | 55-260 ms |
| nostr-secret-key | `nsec1` + 10 MB | RangeError | 70 ms |
| private-key | `-----BEGIN ... PRIVATE KEY-----` repeated, no END | quadratic: timeout at 1 MB (> 40 s) | 375 ms at 10 MB |
| email | `a.a.a.` (no `@`) | quadratic: timeout at 1 MB | linear, 0.75 s/MB (bounded local part) |
| connection-password | `a.a.a.` (a legal scheme alphabet, no `://`) | quadratic: 80k units 4.6 s, 4x the input 16x the time. Found while writing the tests; the first probe missed it | 29 ms, ratio 4.0 |
| github-token | 50,000 keys (36-char body), newline, space or glued; identical and distinct; also 10 MB | linear: 100-230 ms per 50,000 | unchanged |
| aws-key, aws-secret-key, google-api-key, stripe-key, gcp-oauth-token, azure-account-key, credit-card | repeated prefix, single run | linear, no throw | unchanged |

Not reproduced: the 7.4 s for 50,000 consecutive `ghp_` keys in the design note. Tried 36/40/60/255/300-char bodies, distinct and identical keys, separators of newline, space and none, through `redactStandaloneText`, `process` and `redactOnly`: all linear, at most 0.9 s for 10 MB. The probe cannot say what shape produced 7.4 s, so the ghp_ tests below pin linearity for those shapes and the finding stays open if someone has the original input.

Cause of the RangeError: V8 spends one backtrack-stack entry per character on a counted greedy loop `[class]{n,}`, and overflows at roughly 5 million. `[class]+` and `[class]*` are executed by a loop that does not (a 10 MB `[^\s@/]+` password and `[A-Za-z0-9._%+-]+` local part were fine).

## What changed

- anthropic-key, openai-key, slack-token, jwt (each segment), nostr-secret-key: `X{n,}` is now `X{n}X*`. Same language, and the engine tries the same lengths in the same order, so every input matches exactly what it did before. The in-run nostr pattern is derived from the rule's class, and a test pins its source.
- private-key: new optional `scanEnd` on `RedactionRule`; the rule runs on `text.slice(0, scanEnd(text))`, which ends just past the last `-----END ` header. Every BEGIN before it has an END after it, so each start stops at the next END; BEGIN lines after the last END cannot match and are not scanned. No match changes (6000 random BEGIN/END soups compared, plus the existing corpus).
- email: local part `{1,128}` (was `+`). RFC 5321 caps it at 64. Cost per start is at most 128, so a dense `a.a.a.` costs 0.75 s/MB.
- connection-password: scheme `{0,127}` (was `*`). Only the password is redacted, so a shorter scheme match changes nothing.
- credit-card: new optional `validateAt(text, start, end)` hook (runs after `validate`, in `applyRule`), used for the boundary rule below.
- Rule ORDER and the id of every rule are unchanged; no rule was removed or loosened except the credit-card boundary below.

## Credit-card boundary rule (decided)

A Luhn-valid digit run is NOT redacted when it is glued, with no separator, onto a hex-only token: take the alphanumeric characters `[A-Za-z0-9]` touching the run on the left and on the right (at most 64 each side). If at least one exists and every one is in `[0-9A-Fa-f]`, the run is part of a hex token and is left alone. A side that fills the 64-character window with hex counts as hex.

Why this and not "any adjacent letter": a hash, a hex-encoded blob or a memory dump holds a Luhn-valid 13-19 digit run by chance (about 1 in 10 runs). Requiring the whole touching token to be hex keeps `Visa4111...`, `4111...USD`, `xyzab4111...` redacted (a non-hex letter anywhere in the token), where "any adjacent letter" or "adjacent a-f" would not. The window is bounded so a 10 MB hex dump costs a constant per candidate.

Shapes still redacted (before and after, all tested through process, redactOnly, redactStandaloneText, redactRequestBody and the rule-only path): contiguous 13, 16 and 19 digits; 4-4-4-4 groups with single spaces or single dashes; in prose; after `:` `=` `"` `(` tab or newline; before a comma; glued to a non-hex word before or after; after `_`; after a hex-looking word and a space (`deadbeef <card>`); grouped between hex words (`cafe <4-4-4-4> babe`).

Shape no longer redacted (the only one): a Luhn-valid run touching a hex-only alphanumeric token, e.g. `e<card>f`, `<hex dump><card><hex dump>`, `<card>cd`.

Not covered before or after (pre-existing, unchanged): a card directly followed or preceded by `.` or `-` (the pattern's lookarounds exclude them, so `Charge <card>.` is not redacted); non-uniform groupings such as 4-4-4-4-3; space-separated hex dumps (`xxd` style) whose groups are all digits are indistinguishable from a card. A real card glued to hex-only letters (`cc<card>`, `<card>abc`) is the residual the boundary rule trades away.

## Residual risks

- email: a local part longer than 128 characters with no `.`, `+`, `-` or `%` in it is no longer matched (the pattern needs a word boundary to start); with one, it is redacted from the first boundary within 128 characters of the `@`. connection-password has the same shape of residual for a scheme over 128 characters (password still redacted when any boundary lies within 128 of `://`).
- Dense adversarial text is still 0.75-1.1 s/MB for email (bounded, linear), not milliseconds.
- credit-card: see above.
- `validateAt` and `scanEnd` are new optional fields on `RedactionRule` (src/pipeline, not src/interfaces); plugin rules do not get them.
