---
title: Buzz Integration
type: concept
tags: [r14, r14-2, r14-3, r14-4, buzz, agents, orchestration, personas, acp, harness]
sources: ["https://buzz.xyz", "https://engineering.block.xyz/blog/configuring-agents-in-buzz", "https://github.com/block/buzz", "src/inference/personas.ts", "docs/plan/tasks/R14.2.md", "docs/plan/tasks/R14.3.md", "docs/plan/tasks/R14.4.md"]
updated: 2026-09-19
created: 2026-09-19
---

# Buzz Integration

Design for making Golem itself a **first-class ACP harness** inside
[Buzz](https://buzz.xyz) — Block's open-source (Apache-2.0,
`github.com/block/buzz`) Nostr-based chat workspace where humans and AI agents
share channels — and for exposing Golem's persona bench ([[Persona Registry]])
and Golem's own orchestrator as addressable agents running on that harness.
Captured 2026-09-19 from a planning conversation; implementation tracked as
R14.3 (Golem as a harness), R14.2 (identity provisioning on top of it), and
R14.4 (orchestrator dispatch behavior).

## What Buzz actually is (verified 2026-09-19, see `verification-notes.md`)

- A channel-based chat workspace. Participants are humans or **agents**:
  autonomous processes with their own cryptographic identity (keypair), own
  channel memberships, own audit trail — "the same affordances as a human
  teammate, a different keypair."
- Agents are **reactive, not autonomous pollers**: an agent sits idle until an
  event addressed to it — almost always an `@mention` — lands in a channel. It
  takes one or more turns, replies, goes quiet again. There is no push/spawn
  API from Buzz's side; the only way to wake an agent is to post a message
  that mentions it.
- Each agent is configured with: a **harness** (`goose`, `claude` = Claude
  Code, `codex`, or Buzz's own `buzz-agent`; anything speaking the **Agent
  Client Protocol**), a **provider** (auto-detected or explicit), a **model**,
  an **effort** level, and **agent instructions** (free-text system prompt).
  These are injected every session in a fixed order: built-in base prompt →
  agent instructions → team instructions → core memory (a persistent,
  agent-authored "save file" of durable facts/preferences) → per-turn channel
  context.
- A `respond-to` setting (`Only me` / `Selected people` / `Anyone`) gates who
  can wake the agent. An agent's own other agents count as "me" once
  cryptographically verified — so one owner's agents can hand work to each
  other without opening the channel publicly.
- Configuration is done through Buzz's own Settings UI or by asking an
  existing agent to draft one for review; **no documented file-based or REST
  schema was found** during this pass (2026-09-19) — see the open
  verification item below before implementation starts.

## Golem as its own harness, not a `claude`-harness passenger

USER decision (2026-09-19, superseding an earlier draft of this doc): Golem
should appear in Buzz as its **own peer harness** — `golem`, alongside
`goose`, `claude`, `codex` in the Loadout picker — not as a Claude Code
session that happens to run underneath the existing `claude` harness with
Golem's proxy in front of it. Choosing harness `golem` on a Buzz agent means
Buzz spawns Golem's own runtime (redaction, compression, routing, local
tools, telemetry — this repo's full pipeline), which decides internally
whether to run as the orchestrator or as a given persona.

This is the foundational piece (task R14.3, "Implement Golem as its own ACP
harness") — persona identities, the orchestrator identity, and dispatch
behavior (R14.2, R14.4) are all built assuming harness `golem` already exists
and can complete a turn. It also means every mapping and mechanism below that
says "harness = `claude`" in an earlier draft is superseded: it is `golem`
throughout, for personas and for Golem's own orchestrator identity alike.

## Why this doesn't map onto Claude Code's `Agent` tool directly

Golem's current persona dispatch ([[Persona Registry]],
`.claude/rules/golem-prefer-persona-agents.md`) is **synchronous**: the
orchestrating session calls the `Agent` tool, blocks, and gets a tool result
back in the same turn. Buzz has no equivalent call — an agent is summoned by
posting a chat message and *resumes the orchestrator* only when some reply
message later mentions it back. The dispatch primitive changes from a
function call to a **chat turn with an asynchronous, mentioned-triggered
reply**.

Decision (2026-09-19, USER): keep this asymmetry rather than papering over it.
Golem's orchestrator, when operating inside Buzz, does not try to force a
synchronous call — it **posts the same dispatch content it already builds for
`Agent()` as an `@mention` message**, and treats a reply that mentions it back
in the same thread as the tool-result equivalent. The dispatch prompt content
(task, files, constraints, gate) is unchanged; only the transport and the
completion signal change. This preserves "Golem raises the task the same way
it does today" while fitting Buzz's actual execution model — the alternative
(keep Agent-tool dispatch as the real mechanism and use Buzz only as a
read-only mirror) was rejected because it makes Buzz cosmetic and leaves
humans unable to intervene in the channel where the work is actually visible.

## Identity and scoping

- Each persona gets its **own Buzz agent identity** (own keypair), matching
  Buzz's security model — a shared identity across personas would defeat the
  audit trail Buzz gives each agent.
- Identities are provisioned **per project**, not globally: a persona
  identity is bound to the Buzz channel/workspace tied to that project's repo,
  the same way `.claude/agents/golem-<id>.md` is generated per project today.
  Two different Golem projects staffing `golem-coder` get two distinct Buzz
  agents, not one shared across repos.
- Golem CLI provisions and owns these identities (USER, 2026-09-19) — not a
  manual per-agent setup in the Buzz UI. `golem init` / the existing
  persona-sync path ([[Persona Registry]]) is extended to also create/update a
  Buzz agent per staffed persona.
- **Auto-sync** (USER, 2026-09-19): whenever `inference.personas` changes and
  the existing sync regenerates `.claude/agents/golem-<id>.md`, it also pushes
  the current model + agent-instructions to the matching Buzz agent config, so
  the two never drift.

## Mapping: persona → Buzz agent config

| Golem persona field | Buzz agent field |
|---|---|
| persona id (`coder`, `planner`, `reviewer`, `scribe`) | agent name / `@mention` handle |
| `.claude/agents/golem-<id>.md` body (role prompt) | Agent instructions |
| `inference.personas.<id>.model` | Model |
| — (not currently modeled) | Effort — new field Golem needs to carry per persona, or leave at model default |
| fixed: `golem` | Harness — Golem's own runtime, not a passenger on `claude` (R14.3) |
| `Only me` initially, project owner as trust root | `respond-to` |

Open question carried into R14.2: Golem has no per-persona "effort" dial
today ([[Persona Registry]] models id → model only); decide whether to add one
or leave every persona at the model's shipped default.

## The reverse direction: Golem as an addressable orchestrator

A human or another agent `@mention`s **Golem** itself in a project's Buzz
channel (e.g. `@Golem ship task R14.2`). Golem's own orchestrator process —
running as a Buzz agent with harness `golem` (R14.3), its own identity —
wakes, resolves the request the same way it does today (task doc lookup,
ambiguity grilling, etc.), then dispatches by `@mention`-ing the appropriate
persona agent(s) in-thread, using the same dispatch-prompt content it would
pass to `Agent()`. It watches the thread (a reply mentioning Golem wakes it
again), sequences work across personas exactly like `golem-planner` →
`golem-coder` → `golem-reviewer` → `golem-scribe` do inline today, and posts
a final summary back to the human in-channel.

A human or another agent can also `@mention` a persona **directly** —
`@golem-coder`, skipping Golem's orchestrator entirely — because R14.2 gives
each persona its own independently addressable Buzz identity with the project
owner already inside its `respond-to` trust boundary. Orchestration through
Golem is the common path, not the only path.

Example flow (illustrative, not literal transcript):

```
@Golem "ship task R14.2"
  -> Golem (orchestrator agent) claims it, posts an ack
  -> @golem-planner <dispatch prompt for R14.2> — planner replies with a plan
  -> @golem-coder <dispatch prompt + plan> — coder replies with diff/PR link
  -> @golem-reviewer <dispatch prompt + diff> — reviewer replies with findings
  -> Golem posts final summary, mentions the human
```

This dispatch behavior is scoped as R14.4, separate from R14.3 (Golem
speaking ACP as its own harness) and R14.2 (identities provisioned on that
harness) — R14.4 assumes both already work and only adds the sequencing
logic on top.

## Out of scope for this design

- Buzz's own skill system (`.agents/skills/*.md`) — orthogonal to persona
  dispatch; not needed for R14.2, R14.3, or R14.4.
- Voice/huddle, canvas, and other Buzz surfaces beyond channel `@mention` text.
- Self-hosting Buzz's relay vs using the hosted `buzz.xyz` — a deployment
  choice for the user, not a Golem design question.

## Open verification items (before implementation)

Recorded in `verification-notes.md` (§ dated 2026-09-19):

1. Buzz's actual agent-config **schema and provisioning API** (file-based?
   REST? Nostr event kind?) — the public engineering post documents the UI
   fields, not a machine-writable config surface. `golem init` cannot
   provision an identity/config it cannot write.
2. Exact Agent Client Protocol (ACP) surface Buzz expects a harness to
   implement (message shapes, session lifecycle, registration/spawn contract)
   — needed to implement `golem` as a peer harness (R14.3), not merely to
   reuse `claude`.
3. Whether per-agent `effort` is settable outside the UI, needed for the
   persona → Buzz-agent mapping table above.
