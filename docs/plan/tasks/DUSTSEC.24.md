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
| email | `a.a.a.` (no `@`) | quadratic: timeout at 1 MB | 10 MB: 50 ms rule-only, 200 ms whole stage |
| connection-password | `a.a.a.` (a legal scheme alphabet, no `://`) | quadratic: 80k units 4.6 s, 4x the input 16x the time. Found while writing the tests; the first probe missed it | 1 MB: 5 ms |
| github-token | 50,000 keys (36-char body), newline, space or glued; identical and distinct; also 10 MB | linear: 100-230 ms per 50,000 | unchanged |
| aws-key, aws-secret-key, google-api-key, stripe-key, gcp-oauth-token, azure-account-key, credit-card | repeated prefix, single run | linear, no throw | unchanged |

Not reproduced: the 7.4 s for 50,000 consecutive `ghp_` keys in the design note. Tried 36/40/60/255/300-char bodies, distinct and identical keys, separators of newline, space and none, through `redactStandaloneText`, `process` and `redactOnly`: all linear, at most 0.9 s for 10 MB. The probe cannot say what shape produced 7.4 s, so the ghp_ tests below pin linearity for those shapes and the finding stays open if someone has the original input.

Cause of the RangeError: V8 spends one backtrack-stack entry per character on a counted greedy loop `[class]{n,}`, and overflows at roughly 5 million. `[class]+` and `[class]*` are executed by a loop that does not (a 10 MB `[^\s@/]+` password and `[A-Za-z0-9._%+-]+` local part were fine).

## What changed (after the independent review; supersedes the first revision)

- anthropic-key, openai-key, slack-token, jwt (each segment), nostr-secret-key: `X{n,}` is now `X{n}X*`. Same language, same lengths tried in the same order. Their leading `\b` is unchanged; no other rule lost a `\b`.
- private-key: optional `scanEnd` on `RedactionRule`. The bound is the end of the last COMPLETE END line, found by trying the rule's own END pattern (`-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----`) at each `-----END ` occurrence. A trailing `-----END CERTIFICATE-----` or an unterminated END no longer counts (the first revision bounded at the last `-----END ` text and stayed quadratic on those). The original rule redacted nothing for a BEGIN with no END after it, and so does this one (bound 0 with no complete END). `applyRule` clamps the bound: anything that is not an integer in `[0, length]` scans the whole text.
- connection-password: no leading `\b` (it made a scheme glued onto word characters unmatchable, so the password leaked). Anchored on the colon with an UNBOUNDED look-behind, `:(?<=[a-zA-Z][a-zA-Z0-9+.-]*:)//...`: the original's scheme test minus the `\b`, so it adds matches and removes none. (A bounded `{0,127}` look-behind missed `a` + 200 digits before `://`; fixed.) The colon is outside the scheme class, so each look-behind walks only its own run: linear. The userinfo and password part, including the lookahead that skips a password that is EXACTLY a connection-password placeholder (S10), is restored exactly as on origin/development. An earlier revision widened that lookahead to other placeholder kinds and to any password starting with one; that hid a real password after placeholder-looking text (`email:1]hunter2` in the password position) and was removed: a leak loses to idempotence.
- email: the pattern matches `@domain` only and a new optional `extendStart(text, start, floor)` hook reaches back over the local part: at most 128 characters, not past the end of the previous redaction, beginning at the first word character (where the original's `\b` fell, including the case of resuming right after a match). A local part over 128 characters has its last 128 characters and the whole domain redacted; only the head beyond that stays. Real addresses are at most 64.
- credit-card: new optional `validateAt(text, start, end)` hook; the hex-token exemption applies to SEPARATOR-FREE runs only.
- Rule ORDER and rule ids are unchanged.

## Credit-card boundary rule (decided)

A Luhn-valid run is NOT redacted when it is separator-free (digits only) and glued onto a hex-only token: the `[A-Za-z0-9]` characters touching it on the left and right (at most 64 each side, at least one in all) are all in `[0-9A-Fa-f]`. A run with a space or dash inside is never exempt: it cannot be a hex token.

Shapes still redacted, every path (process, redactOnly, redactStandaloneText, redactRequestBody, rule-only): contiguous 13, 16, 19 digits; 4-4-4-4 groups with single spaces or dashes, including with hex-looking text touching them (`a<groups>b`, `cafe<groups>`, `<groups>D`, `cc<groups>ab`); in prose; after `:` `=` `"` `(` tab or newline; before a comma; `Visa<card>`, `<card>USD`, `id_<card>`, `ID=xyz<card>`, `pan=<card>gh`, `x<card>`, `card <card>`, `cafe <card>`.

ACCEPTED WEAKENING (for the hard-rule review): separator-free Luhn-valid runs glued to a hex-only token are no longer redacted. Tested: `a<card>`, `<card>f`, `cc<card>`, `cafe<card>`, `B<card>`, `<card>D`, `ID=abc<card>`, `pan=<card>ab`. This is the task gate (hex dumps hold such runs by chance, about 1 in 10) and the cost of it.

Pre-existing and unchanged: a card next to `.` or `-`, non-uniform groupings such as 4-4-4-4-3, and spaced all-digit hex dumps are not redacted before or after.

## Differential and fuzz results (against the ORIGINAL patterns from origin/development, `tests/unit/pipeline/redaction-review-fixes.test.ts` and `redaction-pathological.test.ts`)

- anthropic, openai, slack, jwt, nostr (`X{n}X*`): 6,000 random texts each, identical matches (30 to several hundred texts per rule contain a match; the test asserts the generator reaches it).
- private-key: 8,000 random BEGIN/END mixes including CERTIFICATE, PUBLIC KEY, RSA, ENCRYPTED, BLOCK, unterminated and four-dash ENDs, glued ENDs: identical matches to the original (over 500 with a match).
- connection-password, whole text corpus including placeholders and the adversarial shapes (placeholder glued onto the user, placeholder as the user, a password that starts with a kind and number, a made-up kind, `connection-password:12345]hunter2`), 4 seeds x 50,000 texts, original vs this branch: password spans 11,833 / 11,987 / 11,880 / 11,850 (original) vs 14,169 / 14,229 / 14,232 / 14,144 (branch); leaks (a span the original matched that the branch does not) 0 on every seed; whole stage, a `hunter2` the original removed and the branch kept: 0 on every seed. The suite repeats the span check at 4 x 50,000 with no skipped texts, and has explicit regression cases for each adversarial shape. A separate 12,000-text fuzz with scheme runs up to 600 characters: 0 leaks.
- email: 2,100 generated realistic texts (7 contexts x 300 addresses): identical output to the original. 8,000 fuzz texts with class runs up to 128 (over 1,000 with a match): identical output, including the resume-after-a-match case. Long shapes (129, 200, 5000 alphanumeric; 129 and 400 dotted): the last 128 characters and the domain are redacted, the head beyond stays.
- card: 6,000 random texts, the new rule's matches are a subset of the old rule's and every dropped match is a separator-free run touching a hex-only token.

## Performance (final)

| Input | Time |
| --- | --- |
| `a.` x 10 MB, rule table only / whole stage | 50 ms / 200 ms |
| 10 MB of one letter, rule table only | 84 ms |
| 10 MB of 127 digits + `:` | 127 ms |
| 320,000 `-----BEGIN PRIVATE KEY-----` lines + `-----END CERTIFICATE-----` | 55 ms |
| same + unterminated `-----END PRIVATE KEY` | 57 ms |
| 10 MB single runs (sk-ant-, sk-, xoxb-, jwt payload, nsec1) through every path | 25-570 ms |
| 50,000 distinct keys (ghp_, sk-ant-, sk-...+) | 100-230 ms |

10 MB connection-password stress shapes (rule table / whole stage, ms; re-measured on the final pattern): one colon after a digit run 81 / 251; `1`x127+`:` repeated 91 / 210; `1`x999+`:` repeated 82 / 282; `a:` repeated 54 / 199; `1:` repeated 112 / 256; `a1:` repeated 53 / 200; `:` x 10 MB 104 / 236; `://` repeated 98 / 241; `a://` repeated 98 / 234; `a://u:` repeated 95 / 236; `a.` repeated 67 / 211. The suite keeps an 8x-input time-ratio test over these shapes.

Corrections to the first revision's numbers: its email bound measured about 0.75 s/MB (7.6 s at 10 MB) on `a.` x N, and the review measured about 1.2 s/MB (about 12 s at 10 MB) on a loaded machine. That was linear but blocked the event loop for the duration; DUSTSEC.23 owns event-loop stalls on large bodies. Anchoring email on `@` and connection-password on `:` removed the cost rather than bounding it, so the stall no longer applies to these two rules. The earlier statement that the connection-password and email fixes cost "a constant per start" is superseded by this table.

## Accepted weaknesses (for the hard-rule review)

1. Card: separator-free Luhn-valid runs glued to a hex-only token are not redacted, including the single-hex-letter neighbours `cc<card>`, `<card>a`, `a<card>`, `<card>f`, `B<card>`, `<card>D`, `cafe<card>`, `ID=abc<card>`, `pan=<card>ab`. This is broader than hashes: a real card typed right after `cc` or a stray `a` is not redacted. Still redacted: any run with a space or dash inside, and runs next to non-hex letters, `_`, punctuation, whitespace.
2. Email: a local part longer than 128 characters keeps its head beyond the last 128 characters (RFC 5321 caps real local parts at 64). The last 128 characters and the whole domain are redacted.
3. Pre-existing, unchanged: the card rule's pattern swallows a card preceded by digits and a space (`12 4111 1111 1111 1111`) as one run and rejects it as irregularly grouped, so that card is missed before and after this change.

## Residual risks

- email: only the part of a local part beyond 128 characters stays (RFC 5321 max is 64). A local part consisting only of `.%+-` characters is not an address and is not matched, as before.
- connection-password: matches a SUPERSET of the original (a scheme glued onto word characters now matches); every password span the original matched is matched with the same span (0 leaks, counts above). Idempotence is NOT claimed for all text: a glued scheme, or a placeholder followed by trailing characters in the password position, is a password, so a second pass can redact more (over-redaction only; nothing is revealed). The original is non-idempotent in the same way for plain schemes. Measured on one corpus (the one above, per 50,000 texts): original 111-144 non-idempotent, branch 1-4. The reviewer's heavier glued-scheme corpus measured about 8,500 (original) and about 3,500 (branch before this revision) per 50,000; this revision's pattern is the original's apart from the look-behind. The second-pass no-op assertion holds, and is only asserted, on a corpus where every URL starts after a space and no placeholders are fed in. Cross-rule ordering (connection-password runs before the card rule) is unchanged.
- credit-card: the accepted weakening above.
- `validateAt`, `scanEnd` and `extendStart` are optional fields on `RedactionRule` (src/pipeline, not src/interfaces); plugin rules do not get them.
- The ghp_ 7.4 s in the design note still could not be reproduced.
