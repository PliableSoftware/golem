---
task: redaction-linearity-test-windows-flake
title: redaction-review-fixes linearity-ratio tests fail on a loaded Windows runner
state: done
owner: agent
size: S
discipline: code
design: Seen once, 2026-10-22, on the first CI run of PR #331 (a diff that touched no redaction code): a linearity-ratio assertion in tests/unit/pipeline/redaction-review-fixes.test.ts failed on a Windows leg only; the re-run was green. The linear-time tests are at lines 165, 181, 406 and 491 of that file.
gate: The tests still fail on a genuinely quadratic regex (prove it: a deliberately quadratic pattern turns them red) but no longer fail from runner noise. Prefer a measure that does not depend on wall time (step or backtrack counts, or an input-size doubling compared over several repeats with the minimum taken) over a larger tolerance alone. No test is skipped and no assertion is deleted. golem verify exit 0 on several consecutive full runs, Windows included.
depends_on: []
touches: [tests/unit/pipeline/redaction-review-fixes.test.ts]
created: 2026-10-22
updated: 2026-10-23T00:16:43.278Z
---

## What this is

The file guards redaction against catastrophic backtracking by timing a run at two input sizes and asserting the ratio stays near linear. A wall-clock ratio is sensitive to a loaded shared runner, so it flakes without any change to redaction.

## Hard rules

- Redaction is never weakened or reordered. This task changes how the test measures, not any rule.
- Do not widen the tolerance so far that a quadratic pattern passes. Show it still fails on one.

## Out of scope

- Changing any redaction rule or its performance.

## Outcome

shipped
