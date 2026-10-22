---
task: write-settings-low-edges
title: "writeSettings and team link: three low edges left after review"
state: queued
owner: agent
size: S
discipline: code
design: "Found in review of PR #331 (team-link-project-picker), left unfixed as low. src/config/write-setting.ts writeSettings; src/cli/commands/team.ts link action."
gate: "Each edge has a failing-first test and a fix: (1) one call carrying both a retired key and its live replacement writes one value, deterministically, and reports it, not last-wins by object order; (2) writeSettings with an empty changes object does not rewrite or create the file; (3) the 10s project-list timer in golem team link starts after token refresh, not before, so a slow refresh cannot spend the list budget. golem verify exit 0."
depends_on: []
touches: [src/config, src/cli, tests]
created: 2026-10-22
---

## What this is

Three small defects. None loses data today. Each one is a silent surprise, and a silent no-op is worse than an error.

## Out of scope

- Changing which keys exist or their validation.
