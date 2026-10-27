---
title: writeSettings Low Edges and the Project-List Budget
type: debrief
tags: [config, portal, team, timeout, review]
sources: [docs/plan/tasks/write-settings-low-edges.md, src/config/write-setting.ts, src/portal/client.ts, tests/unit/config/write-settings-batch.test.ts, tests/unit/portal/client-projects.test.ts]
created: 2026-10-22
updated: 2026-10-22
---

# writeSettings Low Edges and the Project-List Budget

Three small defects left over from `golem team link` project picking are fixed. All three were reproduced on current code before any fix.

## What shipped

- **Alias collision.** One `writeSettings` call carrying a retired key and its live replacement now writes one deterministic value: the live key beats a retired alias, and between aliases the first by name wins. The loser is reported through an optional `onShadowed(dropped, kept)` callback. A losing value is still validated.
- **Empty `changes`.** Returns the path without reading, creating or rewriting the file. It used to create `{}` in a fresh scope and reformat an existing file.
- **Project-list budget.** The 10s timer in `client.projects()` now starts when a request is sent, not before the token refresh. Each send gets a fresh `AbortController`; the budget is disarmed before a 401 refresh and before a re-link, so neither spends it. A timeout is reported only if the timer fired, and a failed refresh keeps its `not_linked` error.

## Review

Independent review found one medium defect in the first fix: one shared `AbortController` stayed aborted once the first timer fired during a slow 401 refresh, so the retry went out pre-aborted and the user saw "timed out after 10000 ms" again. Fixed failing-test-first with a fresh controller per send. A re-review of the fix followed.

## Lessons

- A timer fix that re-arms the timer but reuses the aborted signal fixes only the case the test covers. Test the retry path, not only the pre-emptive refresh.
- A mock fetch that ignores the abort signal cannot fail a timeout test. Make the mock throw when the signal is already aborted, as real fetch does.
- A report callback nobody calls is not a report. No production caller writes multiple keys from user input today, so none was wired; the test pins the callback for the first one that does.

## See also

- [[Team Layer]]
- [[Settings Cascade]]
