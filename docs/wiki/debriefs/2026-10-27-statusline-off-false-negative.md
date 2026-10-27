---
title: Statusline showing "off" while the proxy runs
type: debrief
tags: [statusline, proxy, hooks, cwd]
sources: [src/cli/fast-path.ts, src/cli/statusline.ts, src/config/paths.ts, src/cli/proxy-daemon.ts, tests/unit/cli-statusline-subdir.test.ts]
created: 2026-10-27
updated: 2026-10-27
---

# Statusline showing "off" while the proxy runs

The status line intermittently drew `Golem off` while `golem status` and a `golem statusline` run from another terminal were fine. Two defects found; the second is a hardening, not a confirmed root cause for every report.

## Outcome

- **Raw cwd as project dir.** `golem statusline` used the host's `workspace.current_dir` as the project directory. It follows every `cd` the session makes, so in a subdirectory `.golem/proxy.pid` was not found and the proxy read as stopped. Fixed with `projectDirFor()` (`src/config/paths.ts`, walks up to the nearest `.golem/settings.json`, falls back to the raw dir). Applied to the five hook entry points that had the same `payload.cwd ?? process.cwd()` pattern (pre-tool-use, post-tool-use, session-hooks, web-fetch, host-gate), which would otherwise read config and write session state under the subdirectory.
- **Pid file as the only liveness signal.** `proxyStatus` (what `golem status` reads) falls back to a port probe when the pid file is missing, unreadable or names a dead pid. The status line did not, so any pid-file hiccup showed "off" while `golem status` was green. The status line now probes the configured port, only when the pid check says not running, with a 300 ms bound.

## Lessons

- Two surfaces answering "is the proxy running" from different sources will disagree exactly when something is wrong. Use one source of truth or the same fallback chain.
- A user saying "it worked before, and it comes and goes" is evidence against a deterministic cause. The cwd bug was real and reproducible but did not fit that pattern; the first diagnosis was stated too confidently.
- Not reproduced on the maintainer machine: pid file stable, no daemon restarts in `proxy.log`, no leaked statusline processes, 150 consecutive root-dir renders healthy.

Related: [[Configuration Surfaces]] (where the status line and `golem status` sit).

## Open

If "off" recurs after this, capture `.golem/proxy.pid` and the statusline stdin payload at that moment.
