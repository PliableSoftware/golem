---
task: device-sessions-windows-eperm
title: "device-sessions test fails on Windows with EPERM renaming hosted-sessions.json — an atomic-write race"
state: queued
owner: agent
size: S
discipline: code
design: "CI evidence, 2026-10-08: PRs #209, #216 and #219 each failed windows-latest / node 24 / shard 4 on tests/integration/device-sessions.test.ts, 'resumes after the runner process exits, and the restart sees earlier turns as context' (waitFor timed out, then EPERM: operation not permitted, rename '...hosted-sessions.json.<id>.tmp' -> '...hosted-sessions.json'). Each passed on re-run."
gate: "The test passes 20 consecutive runs on windows-latest, or the cause is shown to be the test and not the writer. A fix to the writer (retry on EPERM/EBUSY with backoff) carries a unit test that injects the error."
touches: [src/session/device-sessions.ts, src/session, tests/integration/device-sessions.test.ts]
created: 2026-10-08
---

## What this is

A Windows-only flake that has now cost three CI re-runs. The writer renames a temp file over `hosted-sessions.json`, and on Windows that can fail with `EPERM` when another handle is open on the destination (antivirus, or the restarting runner reading it).

## Out of scope

- Rewriting the session store.
- Skipping the test on Windows, which hides a real race.
