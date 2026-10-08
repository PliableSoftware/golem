---
task: DUSTSEC.2
title: "Remove the redaction-off side doors: POST /__golem/pipeline/false and the x-golem-bypass header"
state: done
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R2, R3/S2 (USER, 2026-10-08); SUMMARY.md S2, S7; ADR-0004"
gate: "Probe 1: POST /__golem/pipeline/false (with Origin: https://evil.example) no longer disables anything — the next request's AWS key arrives upstream redacted (before: 200 and raw key forwarded). Probe 2: a request carrying `x-golem-bypass: 1` is redacted (before: forwarded untouched). The golem-bypass skill names only `bypass_all`. golem verify green by exit code."
depends_on: [DUSTSEC.1]
touches: [src/proxy/server.ts, src/proxy/headers.ts, src/proxy/types.ts, src/cli/proxy-runtime.ts, src/cli/skills/basics.ts, .claude/skills/golem-bypass/SKILL.md, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:08.348Z
---

## What this is

Out-of-band HIGH security fix, lands before Dust Phase 3. Two per-request/unpersisted ways to
turn redaction off exist besides `bypass_all`, both invisible to every status surface.

**USER decisions (verbatim):**
- R3/S2: REMOVE `POST /__golem/pipeline/false` (`src/proxy/server.ts:206-211`). Redaction-off exists only as `bypass_all` (persisted, CLI-only, surfaced loudly).
- R2: REMOVE the per-request `x-golem-bypass` header; fix the `golem-bypass` skill to point at `bypass_all`.

## Evidence

- Endpoint: `src/proxy/server.ts:206-211` flips `#pipelineEnabled`; the skip is at `:350`. No auth, no Origin check, no persistence; nothing reads `pipelineEnabled()` (SUMMARY S2, probed).
- Header: `BYPASS_HEADER` `src/proxy/types.ts:26`; `isBypassRequest` `src/proxy/headers.ts:83-91`; used at `server.ts:316`, `:350` (SUMMARY S7).
- Skill text: `src/cli/skills/basics.ts` (generates `.claude/skills/golem-bypass/SKILL.md`) presents the header as milder than `compression off`.

## The work

1. Remove the `/__golem/pipeline/false` route. Its twin `/__golem/pipeline/true` and the
   `#pipelineEnabled` field have no purpose once `false` is gone: remove them too, and grep every
   caller (`src/cli/proxy-runtime.ts`, any `pipeline-switch`, tests). If something outside the
   proxy still calls `/true`, report it rather than keep the field.
2. Remove `BYPASS_HEADER`, `isBypassRequest` and every consumer. The header must no longer change
   behaviour; decide (and say in the PR) whether it is stripped before forwarding — it must never
   reach upstream as a Golem control signal.
3. Rewrite the skill source in `src/cli/skills/basics.ts` to point only at `bypass_all`
   (`golem off` / the CLI, run by the human in their own terminal). Regenerate the skill file the
   way the repo does (do not hand-edit the generated copy only).
4. Tests: the two probes in the gate, plus removal of tests that pinned the old behaviour.

## Hard rules

- Redaction never weakened or reordered; this task only removes off-switches.
- `bypass_all` stays persisted, CLI-only and surfaced loudly (ADR-0004).
- If any removed symbol lives under `src/interfaces/`, update its contract tests and flag dependents.

## Out of scope

- The PreToolUse deny for `golem off` (DUSTSEC.3).
- S11/S12 (status surfaces hiding `bypass_all`) — Phase 3.
- ADR-0004 amendment text (DUST2.3).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
