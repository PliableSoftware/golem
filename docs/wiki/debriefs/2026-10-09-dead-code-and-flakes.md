---
title: "2026-10-09 Dead-code deletions and two flaky-test investigations"
type: debrief
tags: [dead-code, cleanup, frozen-interfaces, windows, flake, ci]
sources: [docs/plan/tasks/dead-code-delete-rows.md, docs/plan/tasks/proxy-errors-test-flake.md, docs/plan/audit/dust-1/DECISIONS.md]
created: 2026-10-09
updated: 2026-10-09
---

# Dead-code deletions and two flaky-test investigations

Closes `dead-code-delete-rows` (PRs #289, #291, #293, #294) and `proxy-errors-test-flake`. The audit that produced the delete rows is recorded in [[Dust Method]] and the earlier debrief for Phase 3 of the Dust refactor.

## Outcome

- **Ten of the 25 audit rows were executed**, as one pull request per area: CLI and test-only exports (rows 15, 16, 17, 21), config (13, 9), frozen interfaces (7, 8), inference (10, 11). Every row was re-verified against current code before anything was deleted; row 6 (the `slider` prompt) was already gone and was dropped. The keep rows are recorded in the task as deliberately kept.
- **`knowledge.vector_db_url` was deprecated, not retired.** The audit said to retire it, but retiring makes an old key raise on load, and the task forbids a hard failure on an old settings file. The key is accepted with any value, ignored, and warned about once per settings file per load, including the environment spelling. The value is never echoed.
- **Frozen interface changes** (`StageConfig.semanticCache`, the `SemanticCache` type, the `low_relevance` mode) carry a dated amendment in `src/interfaces/policy.ts`. The redaction rows of the level table are unchanged.
- **`proxy-errors-test-flake`:** no repo regression found. 50 of 50 runs passed under heavy CPU load, each test builds its own proxy, and nothing leaks between tests. The most likely cause is a stalled CI worker. One assertion was added that the in-flight reservation returns to zero after an upstream failure.

## Default rules applied

The default rule (doc follows shipped code) decided nothing here: the work was user-decided deletion. Where the audit table and the task's own rule disagreed (retire versus never hard-fail), the task's rule won and the choice is written in the task.

## Open exceptions

- The inference pull request was not independently reviewed, because it touches no hard rule, frozen interface or user-facing setting.
- A second Windows flake in the torn-cache test could still appear; see below.
- Removal of `knowledge.vector_db_url` is due next release: move it to the retired table, drop it from the schema, and delete its team-policy entry and test line together.

## What review caught

- **Config review:** the environment spelling of the deprecated key produced no warning and a malformed value no longer failed, the spec still said the key throws, a comment said the value was not applied when it was, and the warning named a task id instead of a release.
- **Interfaces review:** the dials text still told users level 2 adds a semantic cache, a living wiki page still described the removed mode, and the contract test checked the removed key at one level only. The grep proof had searched identifiers but not phrases.
- **CLI review** found nothing, but the reviewer ran a generator script it took for a check, which rewrote files in the worktree. It restored them, and the worktree was verified clean.

## Windows CI: two failed attempts

A test from the team-layer work (#287) rewrote a cache file 60 times while a reader looped on it. On Windows, a rename over a file a reader has open fails, so the writer's retry budget ran out, an error escaped, the reader loop never ended, and the shard hit the 20 second timeout. The first fix (pace the reader, #290) was not enough and was merged as if it were complete; the same failure came back on the next pull request. The second fix (#292) ends the reader loop in a `finally`, counts Windows rename contention as contention rather than a torn file, and keeps the assertion about the thing under test: a reader never sees a torn or missing cache.

## Lessons

- Search for phrases, not just identifiers, when deleting a feature: user-facing text and living wiki pages keep promising it.
- A test loop that depends on a flag set by code that can throw must set the flag in `finally`; otherwise one error becomes a timeout.
- A first fix for a platform-specific flake needs the failing platform to pass before it is called a fix. A re-run that passed once is not that.
- A "known load flake" can be self-inflicted: while the flake investigation ran 16 CPU burners, my own verify runs timed out on a different test. Run verifies alone, and read the exit code of the rerun.
- Never chain a push to a verify without checking its exit code. One PR was opened before its verify had passed (a re-run later did).

## Follow-ups filed

None new. Still open from earlier: DUSTSEC.23, DUSTSEC.24, DUSTSEC.25, `team-security-stricter-only`, `skill-opt-out-sticks`, and the Windows flake tasks.
