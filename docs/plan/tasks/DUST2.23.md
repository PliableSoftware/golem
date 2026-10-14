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

## Decisions (2026-10-14, orchestrator-directed, pending independent review)

**Probe 1: no change to redaction.** DUST1.1 headline 9 is over-redaction, not a leak: a chunk with
`=`/`+` fails the alpha/numeric/hex test, so a long varied path such as `OUT_DIR=/Users/.../lib` is
redacted. That is the safe direction, and under "redaction never weakened" and "output for unchanged
inputs must not change" it is LEFT AS IS. `isPathLikeToken` is byte-identical to `development`. A first
draft that exempted `=`/`+` tokens under a stricter rule was reverted. If a future change wants to stop
this over-redaction it needs its own USER decision and a differential test against the old behaviour.
Pinned in `tests/unit/pipeline/redaction-path-delimiters.test.ts`: the test named "accepted
over-redaction: DUST1.1 headline 9" asserts the current (redacted) output; 8 secret-in-path shapes x
25 seeds and 4000 seeded base64 secrets with `=`/`+` are all redacted.

**Probe 2 design.** `StageConfig.redaction` is the literal `true` (frozen-contract amendment dated
2026-10-14 in `src/interfaces/policy.ts`, tests in `tests/contract/policy.contract.test.ts`). The
runtime check `assertRedactionOn` (`src/pipeline/policy-guard.ts`) THROWS `RedactionPolicyError`
when `stages.redaction !== true`; it does not coerce, so a bug is loud. Both former redaction-off
branches in `pipeline.ts` (non-Messages, and stage 1 plus the post-plugin re-run) now redact
unconditionally. `proxy.bypass_all` is untouched.

**Fail-closed paths checked** (a thrown `RedactionPolicyError` never reaches a raw forward):
- `GolemProxy` has ONE call site of `pipeline.process`, `src/proxy/server.ts:365`, for every route
  (messages, count_tokens, batches, anything else). It sits in a try/catch: the catch runs
  `redactOnly` on the original request (never reads a policy), or answers 502 if that throws or is
  absent. Only `RequestBodyRefusal` is answered directly (4xx, nothing forwarded).
- Translating upstream path: translation runs AFTER that block (`forward` is already the
  redacted result), so it cannot see the raw body.
- Shim (`src/cli/proxy-runtime.ts`): `SHIM_POLICY = policyFor("off")` goes through the same proxy
  and pipeline; its `redaction` is `true`.
- `proxy.bypass_all`: `pipelineEnabled: false` skips the block entirely (the single, deliberate,
  CLI-only redaction-off path); existing "constructor pipelineEnabled:false" test still passes.
- No other caller of `process`/`redactOnly` exists under `src/` (grep).
- Tests: `tests/unit/pipeline/policy-guard.test.ts` (pipeline level, messages and non-messages) and
  `tests/integration/proxy-no-redaction-off-doors.test.ts` (through the proxy, messages and
  count_tokens, upstream body asserted redacted).
