---
task: DUST2.23
title: "Redaction invariants: path-like tokens (§49) and a policy that cannot represent redaction-off"
state: queued
owner: agent
size: M
discipline: code
design: "ADR-0004 ('unrepresentable'); verification-notes §49; SUMMARY.md Gaps 1.1/r011 (P) HR, 1.1/r095 (P) HR; DUST1.1 rows 'path-like tokens' and 'Unrepresentable'"
gate: "Probe 1: a secret inside a path-like token containing `=`/`+` chunks is redacted (before: chunk disqualified it, DUST1.1 headline 9). Probe 2: a caller-built policy can no longer express `redaction: false` for a non-bypass request — a type or runtime check rejects it (before: `pipeline.ts:478`, `:603` obeyed it). golem verify green by exit code."
touches: [src/pipeline, src/compression/policy.ts, src/interfaces, tests]
created: 2026-10-08
---

## What this is

Two partial HR rows. §49 path-like tokens: `redaction.ts:351-373` disqualifies chunks with
`=`/`+`. "Unrepresentable": `StageConfig.redaction: boolean` (`policy.ts:131`) lets any caller-built
policy turn redaction off; only `bypass_all` should.

## Hard rules

- Redaction never weakened or reordered — both changes strengthen it.
- If `StageConfig` is (or is mirrored) under `src/interfaces/`: frozen contract — update contract
  tests and flag every dependent in the PR.
- Prefix stability: output for unchanged inputs must not change (measure on the recorded fixtures).

## Out of scope

- S9 object keys, S10 idempotence — Phase 3.

## Decisions (2026-10-14, agent draft, pending independent review)

**Reading of probe 1.** DUST1.1 headline 9 is over-redaction: a chunk with `=`/`+` failed the
alpha/numeric/hex test, the token lost the exemption, and long varied ordinary paths
(`OUT_DIR=/Users/Alice/.../lib`, `sort=Name+Desc+/Users/...`) were redacted. Secrets were never
leaked by it. So the fix necessarily EXEMPTS more (a narrow, accepted behaviour change: fewer false
positives), and the work is making that exemption unable to hide a secret.

**Exemption rule** (`isPathLikeToken`, `src/pipeline/redaction-rules.ts`):
- `=` and `+` are chunk delimiters, like `/ _ -`. A token without them takes exactly the old path.
- A token containing `=` or `+` ("strict mode") is path-like only if it has >= 3 chunks (so
  `key=<one run>` never qualifies) and every letters-only chunk longer than 3 characters is
  word-shaped: lower, UPPER, Capitalized or CamelCase with every hump >= 3 letters
  (`STRICT_WORD_RE`). Numeric chunks and the hex allowance (>= 3 chunks) are unchanged.
- Rule order, ids, the 32-128 candidate window, the pure-hex and 2-of-3-class exclusions: unchanged.

**Evidence** (`tests/unit/pipeline/redaction-path-delimiters.test.ts`): 7 realistic values
byte-identical; 8 secret shapes x 25 seeds redacted; differential vs a frozen copy of the old
function: 30000 random tokens without `=`/`+` give identical verdicts; 20000 random word-path tokens
with `=`/`+` never redacted (old rule redacted > 500 of them); 200000 random base64 tokens with
`=`/`+`, every one the old rule redacted is still redacted (0 newly exempt).

**Probe 2 design.** `StageConfig.redaction` is the literal `true` (frozen-contract amendment dated
2026-10-14 in `src/interfaces/policy.ts`, tests in `tests/contract/policy.contract.test.ts`). The
runtime check `assertRedactionOn` (`src/pipeline/policy-guard.ts`) THROWS `RedactionPolicyError`
when `stages.redaction !== true`; it does not coerce, so a bug is loud. Fail closed: the proxy
answers a pipeline throw by running `redactOnly` (which never reads a policy) on the original
request, and 5xx if that fails (`src/proxy/server.ts` ~358-390). Both former redaction-off branches
(`pipeline.ts` non-Messages and stage 1/re-run) now redact unconditionally. `proxy.bypass_all`
is untouched.
