---
task: device-interrupt-remote-teardown-flake
title: "device-interrupt-remote integration test leaves an unhandled ENOENT when its tmp dir is removed under a pending host-registry write"
state: queued
owner: agent
size: S
discipline: code
design: "Seen once, 2026-10-21, in a full `golem verify` on task/team-portal-projects-code (diff touched nothing under src/session): vitest reported 'Errors 1 error' with all 5965 tests passing and the check exited 1. Error: ENOENT mkdir '/tmp/golem-interrupt-*/t-*/.golem/state', thrown from writeAtomic (src/config/file-io.ts:68) via write (src/session/host-registry.ts:81) and updateHostSession (host-registry.ts:139), 'originating in tests/integration/device-interrupt-remote.test.ts'. The file passed 3 of 3 alone and the very next full run was green."
gate: "Find which async host-registry write outlives the test (an un-awaited updateHostSession after the interrupt) and make the test or the code wait for it deterministically, never swallow the error or raise a timeout alone. A regression test that removes the tmp dir while a write is pending reproduces the unhandled error on the old code. golem verify exit 0 on several consecutive full runs."
depends_on: []
touches: [tests/integration/device-interrupt-remote.test.ts, src/session]
created: 2026-10-21
---

## What this is

An unhandled rejection after the test body finishes. Vitest counts it as an error and fails the run even though every assertion passed. Check whether the write is a real fire-and-forget in production code (a turn-end or interrupt handler that does not await its registry update) before treating it as test-only.

## Out of scope

- Skipping the test or filtering the error in vitest config.
