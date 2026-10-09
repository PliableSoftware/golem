---
task: proxy-errors-test-flake
title: "tests/integration/proxy-errors.test.ts timed out once on Ubuntu (silent upstream and connection refusal): find whether it is a flake or a regression"
state: done
owner: agent
size: S
discipline: code
design: "CI evidence, 2026-10-09: run 37909601065 (the docs-only PR 280) failed test / ubuntu-24.04 / node 22 / shard 10: 'proxy upstream error mapping > with a silent upstream' and 'maps upstream connection refusal to 502 with an Anthropic-shaped body' timed out at 20003 ms, and two later tests in the file failed behind them. The re-run passed, and it is the only failure of this file in the last 60 CI runs. It sits near the request-body work merged on 2026-10-09 (DUSTSEC.21: the in-flight reservation, the body limit and the refusal paths in src/proxy/server.ts and src/proxy/request-body.ts)."
gate: "Either a root cause is found and fixed (for example a reservation or socket left behind by the 'silent upstream' test that starves the next test, or a port reuse race), with a failing-first test, or the test is shown stable over 50 consecutive runs under CPU load (record the method and the numbers) and the cause is recorded as environmental in docs/plan/verification-notes.md; no timeout is simply raised; golem verify exit 0."
depends_on: []
touches: [tests/integration/proxy-errors.test.ts, src/proxy]
created: 2026-10-09
updated: 2026-10-09T14:17:33.260Z
---

## What this is

A one-off timeout that could be a real regression. Check first whether the 'silent upstream' test leaves a held request or an unreleased in-flight reservation (DUSTSEC.21) that the next test inherits within the same server instance, and whether the connection-refusal test depends on a port that another test may have just released.

## Out of scope

- Windows flakes (separate tasks).

## Outcome

shipped; see SHIPPED.md and the 2026-10-09 dead-code-and-flakes debrief
