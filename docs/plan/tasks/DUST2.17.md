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

## Notes from review (2026-10-14)

- **Sticky binding is dead in production.** `createRouteResolver` is built in `proxy-runtime.ts` without `conversationKeyOf`, so conversation bindings never fill and `sticky` is never true. That predates this task. The selection log therefore carries no `sticky` field; if bindings are ever wired up, add it then.
- **Follow-up: two rotation copies.** `src/shared/selection-log.ts` and `src/session/host-log.ts` each carry a near-identical rotate-by-rename routine (both now with the re-stat + inode guard). Extract one shared helper in its own task; deliberately not done here.
- `target` rule, one for every path: the registry target id when the target has one, else `accountId ?? provider`. The shim logs `shim: resolver not installed` as its reason.
