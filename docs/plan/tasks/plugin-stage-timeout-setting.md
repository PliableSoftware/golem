---
task: plugin-stage-timeout-setting
title: "plugins.stage_timeout_ms setting for the plugin stage timeout"
state: queued
owner: agent
size: S
discipline: code
design: "DUST2.11 (#313) follow-up, recorded in docs/plan/tasks/DUST2.11.md; PLUGIN_STAGE_TIMEOUT_MS in src/plugins/stage-runner.ts; Plugin Seams wiki page"
gate: "A `plugins.stage_timeout_ms` setting overrides the 5 s default of PLUGIN_STAGE_TIMEOUT_MS for plugin stages on the proxy path; it is in the config schema, the UI model and the generated config-schema, classified in team-policy.ts (so the table stays total), and covered by the existing drift tests; an out-of-range value is rejected or clamped with a stated bound; tests cover the default, an override and a rejected value; golem verify green by exit code."
depends_on: []
touches: [src/config, src/plugins, src/cli, tests]
created: 2026-10-15
---

## What this is

DUST2.11 bounded every plugin stage with a fixed 5 s timeout (`PLUGIN_STAGE_TIMEOUT_MS`, a snapshot,
restore and a circuit breaker after three consecutive timeouts). Users with a legitimately slow stage
cannot raise it, and users who want a tighter bound cannot lower it. The DUST2.11 task doc recorded a
`plugins.stage_timeout_ms` setting as a follow-up because it needs a schema change, a UI model change
and drift-test changes, which that PR did not take on.

Decide the bounds (a floor and a ceiling) in the task, and have the team-policy table classify the new
key explicitly; an unclassified key is denied.

## Out of scope

- The `setup()` timeout (10 s) and the `golem plugin` deadline (30 s).
- A synchronously blocking stage still cannot be interrupted.
