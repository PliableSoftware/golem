---
task: DUSTSEC.8
title: "Plugin redaction rules apply on every redaction path — hook, vibe and join-queue as well as proxy and MCP"
state: done
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R6 (USER, 2026-10-08); SUMMARY.md S14, Gaps 1.1/r046; ADR-0005"
gate: "Probe: with a plugin contributing a rule for an org-private token format, that token is redacted by (a) the PostToolUse/web-fetch hook path, (b) the vibe store write, (c) join-queue enqueue — each forwarded/stored it raw before. Proxy and MCP behaviour unchanged. golem verify green by exit code."
depends_on: [DUSTSEC.7]
touches: [src/hooks/redact.ts, src/hooks/post-tool-use.ts, src/hooks/web-fetch.ts, src/vibe/store.ts, src/session/join-queue.ts, src/plugins, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:11.526Z
---

## What this is

Plugin rules are appended only in the proxy and MCP processes. Hook redaction
(`src/hooks/redact.ts:34`, `pipelineRedact = redactStandaloneText`), vibe
(`src/vibe/store.ts:31,141`) and join-queue (`src/session/join-queue.ts:170`) run in other
processes and use built-ins only.

**USER decision (verbatim, R6):** plugin redaction rules apply on EVERY redaction path (hook,
vibe, join-queue as well as proxy and MCP); amend ADR-0005 to name all paths. ADR text is DUST2.3.

## The work

1. Find how proxy/MCP load plugin rules (`src/plugins/loader.ts`, `src/plugins/index.ts`,
   `src/pipeline/redaction.ts:143-144`). Give the other processes the same loader, so there is ONE
   way to build the effective rule list.
2. Hooks are short-lived processes on the hot path: measure the added latency of loading plugins
   per hook invocation and report it. If it is material, propose a cached compiled list keyed on
   plugin file mtimes — do not silently skip plugins to save time.
3. Plugin load failure on these paths: built-ins still run; the failure is surfaced the way
   `golem plugin` surfaces it. Never fall back to "no redaction".
4. Enumerate every other `redactStandaloneText`/redaction call site in `src/` and list it in the PR
   with "plugin rules: yes/no" — the decision says EVERY path.

## Hard rules

- Redaction never weakened or reordered: built-ins first, plugins append only.
- Prefix stability: deterministic output for fixed input + fixed plugin set.

## Out of scope

- Vibe `sources.json`/`candidates.jsonl` coverage (DUSTSEC.9).
- S8/S13 (in-place body mutation, `wiki_upsert`) — Phase 3.

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
