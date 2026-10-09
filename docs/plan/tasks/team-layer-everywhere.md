---
task: team-layer-everywhere
title: "Apply the team layer on every surface that reads settings, through one loader (USER decision G3)"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md G3 (USER, 2026-10-09); SUMMARY.md contradiction G3; ADR-0008; docs/wiki/concepts/Team Layer.md and Settings Cascade.md. golem status loads the team layer; config, the TUI, VS Code, hooks, MCP and the hot-reload do not."
gate: "Every code path that reads effective settings gets the team layer through ONE loader entry point (no surface rebuilds its own settings view without it): golem status, golem config, the TUI, the VS Code extension's settings read, the hooks, the MCP server and the settings hot-reload; a test per surface family shows a team-set value is visible and enforced there, and that the REMOTE_DENIED_SETTINGS floor still applies; an invalid team value still warns and is skipped and never stops the proxy, a hook or the MCP server (ADR-0008, DUSTSEC.14); a hook must not slow down noticeably (the team layer comes from a cache, measure the added latency per hook call and state it); a project with no team binding behaves exactly as before; golem verify exit 0; an independent read-only review before merge, because it changes what policy is enforced where."
depends_on: []
touches: [src/config, src/portal/team-layer.ts, src/hooks, src/mcp, src/tui, src/cli, vscode-extension, tests]
created: 2026-10-09
---

## What this is

The user decided team policy must apply everywhere, so a member cannot bypass it by using a different command. Find every call site that builds settings without the team layer (grep for `loadConfig` and for any direct reads of the settings files), route them through the shared loader, and prove it with tests. Be careful with hooks: they run on every tool call, so the team layer must come from the local cache and never from a network call on the hook path.

## Out of scope

- Deciding which keys a team may set (see the P4 decision: teams may set `security.*`; the floor stays as it is).
- The portal sync itself.
