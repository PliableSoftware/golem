---
title: Redaction Linearity Tests Stop Flaking on Loaded Runners
type: debrief
tags: [redaction, tests, flake, windows, ci]
sources: [docs/plan/tasks/redaction-linearity-test-windows-flake.md, tests/unit/pipeline/redaction-review-fixes.test.ts]
created: 2026-10-23
updated: 2026-10-23
---

# Redaction Linearity Tests Stop Flaking on Loaded Runners

The linear-time guards in `tests/unit/pipeline/redaction-review-fixes.test.ts` failed once on a loaded Windows CI leg (PR #331, a diff that touched no redaction code). They now measure with the minimum of several runs and keep the lowest of up to four ratio attempts. Tests only; no redaction source or rule changed.

## What shipped

- `timed()` returns the minimum of 5 runs. Noise only adds time, so the minimum is the cleanest sample.
- `linearRatio(small, big)` measures big/small up to 4 times and keeps the lowest ratio. The big input is timed first, so warmup raises the ratio and cannot cause a false pass.
- `LINEAR_LIMIT` stays 24. No test skipped, no assertion deleted.

## Proof it still has teeth

A deliberately quadratic wrapper around `redactIdentifierText` turned every linearity test red (ratios 26.9 to 62), and 20 consecutive runs under four busy loops had no failures. Independent review reproduced the mutation in a scratch copy.

## Known limits

- The ratio cannot catch n^1.5 (8^1.5 is about 22.6, under 24). Only the 10s absolute bound in the shapes test does. That was true before this change.
- The `Math.max(small, 1)` clamp turns the ratio into an absolute time on fast machines. It errs toward passing; a true quadratic at these sizes is far above the limit anyway.
- Best-of-N makes a borderline regression (true ratio near 25 to 30) slightly more likely to pass than a single median did.
- Not reproduced on Windows locally; CI is the evidence.

## Lessons

- Time the big input first: warmup then inflates the ratio, which fails safe.
- A flaky timing test needs a mutation proof, or "stable" can quietly mean "can no longer fail".

## See also

- [[Redaction Stage]]
