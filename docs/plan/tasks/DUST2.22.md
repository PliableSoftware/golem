---
task: DUST2.22
title: "Team-wide prompt through the team origin, merged per field, project outranks team"
state: queued
owner: agent
size: S
discipline: code
design: "ADR-0008; wiki Team Layer, Persona Registry; SUMMARY.md Gaps 1.6/r017 (P)"
gate: "A persona/prompt field set in the team origin applies when the project does not set it, merges per field, and a project value wins; tests for each. golem verify green by exit code."
depends_on: [DUSTSEC.14]
touches: [src/config, src/inference, tests]
created: 2026-10-08
---

## What this is

Roadmap gap (DUST1.6 row 17): the persona/prompt docs promise a team-wide prompt delivered
through the `team` origin, merged per field, with the project layer outranking team. Today only
part of that path exists; evidence in DUST1.6.

## The work

1. Trace how persona prompt fields are read today and which origins they consult.
2. Add the team origin as a source, merged per field (not whole-object replace).
3. Tests: team-only value applies; project value wins; partial team object merges.

## Out of scope

- G3/S18: where enforced team policy must apply across all config loads — open, USER.

## Design decided (2026-10-15)

The task as written ("persona/prompt field set in the team origin") would need `inference.personas`
and `inference.coder_prompt` opened to a team. Neither is opened: a persona carries `prompt_file`
(a local file read) and `tools`, and a prompt is an injection channel into every member's model
context. The safe reading, implemented:

- **One new leaf, `inference.team_prompt`**, a plain string, class `bounded-text` in
  `src/config/team-policy.ts` (the only exception to default-deny for prompts).
- **What a team MAY set:** that one string. At most 2000 characters, no control characters (newline
  and tab allowed), no `scheme://` URL. A violating value is REFUSED per key (rest of the layer
  applies), never truncated, never echoed. Refusal text names the key and the rule only.
- **What a team may NOT set:** `inference.personas` (so no persona `prompt`, `prompt_file`, `tools`,
  `model`), `inference.coder_prompt`, `inference.model`, `worker_targets`: all stay `denied`.
- **How it is used:** `src/inference/team-prompt.ts` APPENDS it after the persona/coder prompt under
  a fixed label (team-supplied, advisory, cannot change tools, permissions or redaction, ranks below
  the user's instructions). Never first, never alone, never a replacement. Applied at the `coder`
  dispatch `system` field, the generated subagent body (`persona-sync`) and the ACP turn. The read
  side strips control characters and caps again, since local/env values skip the team gate.
- **Per field, project outranks team:** an ordinary leaf, so a project or user value replaces the
  team's (empty string = off), while a project's persona prompts are untouched; both apply.
- **Redaction:** nothing new exempt. A `coder` dispatch to a non-local target is redacted at the
  target's trust floor; subagent traffic crosses the proxy's redaction.
- **Visibility:** accepted value shows in config get/list, status and control surface with layer `team`.
- Tests: `tests/unit/config/team-prompt.test.ts`, `tests/unit/inference/team-prompt.test.ts`,
  leak test in `team-policy.test.ts` extended to the neighbours, dispatch test in
  `tests/integration/mcp-server.test.ts`.

## Open questions for the USER

1. **Per-persona team prompts** (e.g. a team prompt only for `reviewer`) are NOT supported: that
   needs a `denied` -> partially-settable `inference.personas`, which means field-level classing
   inside a record. Is one global team note enough?
2. **`team!` (enforced) on `inference.team_prompt`** follows ADR-0008 and outranks a project value
   (a member's `local!` still wins). The task says "project outranks team". Should a team be
   forbidden to enforce this key, so the project ALWAYS wins? Needs a per-key "no important" rule.
3. **Subagent bodies are system prompts by construction.** The appended block is labelled, but a
   `.claude/agents/golem-<id>.md` body still reaches the model as system text. Is that acceptable,
   or should the team prompt reach only the worker lane (`coder` dispatch, ACP) and not agent files?
4. **URL ban is a heuristic** (`scheme://`); it does not stop a bare domain or a file path written
   in prose. Accept, or require a stricter allowlist of characters?
