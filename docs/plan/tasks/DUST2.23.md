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
