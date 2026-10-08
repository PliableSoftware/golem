---
task: DUST2.17
title: "Log every request's (gateway, provider, reason) selection durably, single-target included"
state: queued
owner: agent
size: S
discipline: code
design: "ADR-0003 invariant 5; SUMMARY.md Gaps 1.2/r019 (P), r022 (P); DUST1.2 row 19"
gate: "Every proxied request appends its (gateway, provider, reason) selection to a durable log under .golem/state/ that survives daemon restart, single-target included; no credential ever appears in it; tests for each. golem verify green by exit code."
depends_on: [DUSTSEC.15]
touches: [src/cli/proxy-runtime.ts, src/shared/proxy-log.ts, src/providers, tests]
created: 2026-10-08
---

## What this is

Roadmap gap. Selection is logged only with >1 target (`proxy-runtime.ts:321-331`), to
`.golem/proxy.log`, truncated on every daemon start (`proxy-daemon.ts:93-98`). r022 "no silent
cross-account fallback" is closed in behaviour by DUSTSEC.15; this task makes it auditable.

## Hard rules

- Credentials never on a log surface (ADR-0003 invariant 1). S21 (Gemini `?key=` on `ProxyRoute`) is a Phase 3 item — make sure this log never serialises a route URL with a query key.
