---
task: windows-handrolled-rename-sweep
title: "About 17 modules hand-roll a temp file plus a bare rename and still fail on Windows under contention"
state: done
owner: agent
size: M
discipline: code
design: "Residual from the Windows lock and rename fix (2026-10-08, PR 272): src/shared/win-fs-retry.ts now retries a rename on win32 for EPERM, EACCES and EBUSY, and the shared writer replaceViaTemp in src/config/file-io.ts, the vector-store driver flush and the join-queue enqueue use it. The author's grep found about 17 other modules that build their own `${file}.${pid}.tmp` and call a bare rename: spawn-gate, delegation-ledger, session-state, snooze-nudge, conversation-store, tasks/store and others (the list is in docs/plan/verification-notes.md under the 2026-10-08 Windows entry). Each is the same transient sharing violation waiting to happen on Windows."
gate: "Each module either routes through replaceViaTemp or renameWithRetry, or has a recorded reason it does not need to; a failing-first test per module family injects an EPERM-then-success rename (the helper's seam) and shows no throw; no behaviour change on non-win32; golem verify exit 0 and windows-latest CI green."
depends_on: []
touches: [src/hooks, src/session, src/tasks, src/cli, src/shared, tests]
created: 2026-10-08
updated: 2026-10-09T07:36:55.809Z
---

## What this is

Mechanical, one module per commit. Prefer one shared helper over seventeen copies: if the call sites differ (fsync, mode, cleanup on failure), extend `replaceViaTemp` to cover them rather than adding another variant.

## Out of scope

- Changing lock semantics (the lock acquisition fix is merged).
- The proxy-runtime webcache test flake (separate task, may be unrelated).

## Outcome

shipped (PR 275)
