---
task: proxy-runtime-webcache-windows-flake
title: "proxy-runtime webcache substitution test times out on Windows (waitFor never became true)"
state: queued
owner: agent
size: S
discipline: code
design: "CI evidence, 2026-10-08: PR 255 failed windows-latest / node 24 / shard 5 on tests/unit/cli/proxy-runtime.test.ts, 'buildProxyFromSettings - R2.2 context-substitution wiring > substitutes a webcache-known page and records an avoided...' with 'Error: waitFor: predicate never became true'. A re-run of that job passed. A second recurring Windows flake after device-sessions-windows-eperm."
gate: "The test passes 20 consecutive runs on windows-latest, or the cause is shown to be the test and not the code: find what the waitFor predicate waits on (an async write of the avoided-token record, a file watcher, a rename) and make that deterministic, never raise the timeout alone. golem verify exit 0."
depends_on: []
touches: [tests/unit/cli/proxy-runtime.test.ts, src/cli, src/compression]
created: 2026-10-08
---

## What this is

A Windows-only flake. Check whether it shares a cause with device-sessions-windows-eperm (a file rename or watcher race on Windows) before treating it as separate.

## Out of scope

- Skipping the test on Windows.
