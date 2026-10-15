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
  dispatch `system` field only (NOT the generated subagent body or the ACP turn, see below). The read
  side strips control characters and caps again, since local/env values skip the team gate.
- **Per field, project outranks team:** an ordinary leaf, so a project or user value replaces the
  team's (empty string = off), while a project's persona prompts are untouched; both apply.
- **Redaction:** nothing new exempt. A `coder` dispatch to a non-local target is redacted at the
  target's trust floor; subagent traffic crosses the proxy's redaction.
- **Visibility:** accepted value shows in config get/list, status and control surface with layer `team`.
- Tests: `tests/unit/config/team-prompt.test.ts`, `tests/unit/inference/team-prompt.test.ts`,
  leak test in `team-policy.test.ts` extended to the neighbours, dispatch test in
  `tests/integration/mcp-server.test.ts`.

## Orchestrator decisions (2026-10-15) and what they changed

- **Q1** One global team note is enough. No per-persona team prompts.
- **Q2** A team may NOT enforce `inference.team_prompt` (`REMOTE_NEVER_ENFORCED` in
  `team-policy.ts`, applied in `buildObjectLayer`). A `team!` declaration is ignored with one
  warning naming the key and the rule (never the text); the value still applies as an ordinary
  team value that a project or user value replaces. `user!`/`local!` are unchanged.
- **Q3** NOT delivered to generated `.claude/agents` bodies (system prompts by construction);
  `persona-sync.ts` no longer touches it. Delivered ONLY on the dispatch `system` field of the
  `coder` MCP tool. ACP is EXCLUDED (orchestrator ruling): the ACP turn's only slot for it is the
  dispatch `system` field, i.e. system authority, so `src/buzz/acp-turn.ts` does not call
  `withTeamPrompt`. Revisit if a user-level slot exists.
- **Q4** Kept: the URL ban is a `scheme://` heuristic. KNOWN LIMITATION: a bare domain, an IP, a
  file path or "fetch example dot com" written in prose passes. The label and the bound are the
  defence, not the heuristic.

### Redaction trace (A)
`coder` tool -> `dispatcher.dispatch({system})`
builds messages with `buildDispatchMessages`, then `redactReversibleTexts` over EVERY message
(system included) before any non-local dispatch or spawn. The only unredacted branch is a target
that certifies `trust: "local"` on a real loopback endpoint (stays on the machine); the
no-dispatcher `inference.chat` fallback is the local tiered service. Pinned by
`tests/unit/buzz/team-prompt-redaction.test.ts`: a secret-shaped value built at runtime inside a
team prompt is absent from the recorded bytes for a coder dispatch; a second case proves an ACP
turn does not carry the team text at all. The same file pins the closed delivery list by source
scan: nothing in the proxy, hooks or agent generator reads the setting, so it can never reach a
proxied request body.

### Raw team payload (B), follow-up
`team.teamLayer.settings` is the team's raw payload. Probing found no surface serialising it
(`tests/unit/config/team-payload-surfaces.test.ts`, which also pins the readers of `.teamLayer`).
`loadEffectiveConfig` now drops refused keys from the object it hands out (`withoutRefusedValues`
in `effective.ts`). FOLLOW-UP: the structural risk remains for values that are ACCEPTED but
sensitive-shaped (none today: every accepted team class is a boolean, a number, a level, a root list or
the bounded team prompt). A cleaner fix is to stop carrying the raw payload on the resolution at all
and hand `loadConfig` the layer by a separate channel.
