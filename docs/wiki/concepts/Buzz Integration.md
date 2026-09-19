---
title: Buzz Integration
type: concept
tags: [r14, r14-2, r14-3, r14-4, buzz, agents, orchestration, personas, acp, harness, nostr]
sources: ["https://buzz.xyz", "https://github.com/block/buzz", "https://github.com/block/buzz/blob/main/crates/buzz-acp/README.md", "https://github.com/block/buzz/blob/main/ARCHITECTURE.md", "https://github.com/block/buzz/blob/main/crates/buzz-cli/README.md", "https://agentclientprotocol.com", "https://engineering.block.xyz/blog/configuring-agents-in-buzz", "docs/plan/verification-notes.md", "src/inference/personas.ts", "docs/plan/tasks/R14.2.md", "docs/plan/tasks/R14.3.md", "docs/plan/tasks/R14.4.md"]
updated: 2026-09-19
created: 2026-09-19
---

# Buzz Integration

Design for making Golem a **first-class agent runtime** inside
[Buzz](https://buzz.xyz) — Block's open-source (Apache-2.0,
`github.com/block/buzz`) Nostr-based chat workspace where humans and AI agents
share channels — and for exposing Golem's persona bench ([[Persona Registry]])
and Golem's own orchestrator as addressable agents there. Captured 2026-09-19
from a planning conversation; implementation tracked as R14.3 (the runtime),
R14.2 (identity provisioning), R14.4 (orchestrator dispatch).

**The protocol research is complete**: `docs/plan/verification-notes.md` §19
(2026-09-19) resolves everything §17 and §18 left open. That section is the
authority on wire-level facts; this page carries the design and the decisions.
Where the two ever disagree, §19 is right and this page is stale.

## Architecture, as confirmed

The relationship runs the opposite way from this page's first draft. In the
**Agent Client Protocol** — a real public protocol from Zed Industries, JSON-RPC
2.0 over stdin/stdout, spec at `agentclientprotocol.com` — the *Client* is the
host and the *Agent* is the AI process it spawns. Buzz's `buzz-acp` crate is
the ACP **Client**. Golem is the ACP **Agent**:

```
Buzz Relay ──WS──→ buzz-acp ──stdio(ACP/JSON-RPC)──→ golem acp
                                                         │
                                                    buzz-cli
                                                 (messages send, …)
```

What Buzz's UI calls a **harness** is simply that subprocess command: `goose` is
`goose acp`, `claude` is the npm adapter `@agentclientprotocol/claude-agent-acp`,
`codex` is `@agentclientprotocol/codex-acp`. Nothing registers *inside* Buzz,
and nothing needs contributing to `block/buzz`.

`buzz-acp` requires exactly four things of an agent: accept `initialize`;
accept `session/new` with `mcpServers` and return a `sessionId`; accept
`session/prompt` and stream `session/update` notifications; return a
`stopReason`. Everything else in ACP is optional and capability-gated.

## Golem as its own runtime, not a `claude`-harness passenger

USER decision (2026-09-19): Golem appears in Buzz as its **own peer runtime** —
`golem`, alongside `goose`, `claude`, `codex` — not as a Claude Code session
running under the existing `claude` harness with Golem's proxy in front of it.
Choosing `golem` means Buzz spawns Golem's own runtime (redaction, compression,
routing, local tools, telemetry — this repo's full pipeline), which decides
internally whether it is acting as the orchestrator or as a given persona.

The decision stands unchanged. Research only made it **cheaper**: it means
shipping a `golem acp` subcommand and pointing `BUZZ_ACP_AGENT_COMMAND` at it,
not writing Rust or forking `buzz-acp`. Two ways to select it:

- **Headless** — set `BUZZ_ACP_AGENT_COMMAND=golem`, `BUZZ_ACP_AGENT_ARGS=acp`
  in the environment of a `buzz-acp` process. No Buzz-side registration at all.
- **Buzz Desktop** — drop a tier-3 "Bring Your Own Harness" JSON at
  `<app-data>/custom_harnesses/golem.json` and `golem` becomes a selectable
  runtime in the picker. The `golem` id is confirmed available: the reserved
  namespace is tier-1 (`goose`, `claude`, `codex`, `buzz-agent`) plus the
  tier-2 presets.

## Inference stays Golem's business

Buzz agent config carries **provider**, **model** and **effort**. Those only
steer tier-1 runtimes whose launch flags Buzz knows. For a tier-3 custom
runtime Buzz spawns `command` + `args` + `env` and nothing more — so a `golem`
runtime reads its model from `inference.personas.<id>.model` and decides effort
through its own routing. Golem never has to write a model or an effort level
into Buzz.

This closes the open question this page previously carried: **Golem does not
need a per-persona `effort` field.** If one is ever wanted it must be justified
on Golem's own routing merits, not as a mirror of a Buzz field that cannot
reach us.

## Why this doesn't map onto Claude Code's `Agent` tool directly

Golem's current persona dispatch ([[Persona Registry]],
`.claude/rules/golem-prefer-persona-agents.md`) is **synchronous**: the
orchestrating session calls the `Agent` tool, blocks, and gets a tool result in
the same turn. Buzz has no equivalent call. An agent is summoned by an event
carrying its pubkey in a `p` tag, takes a turn, and goes quiet.

Decision (2026-09-19, USER): keep the asymmetry rather than papering over it.
Golem's orchestrator **posts the same dispatch content it already builds for
`Agent()` as an `@mention` message**, and treats a reply mentioning it back in
the same thread as the tool-result equivalent. The dispatch prompt content
(task, files, constraints, gate) is unchanged; only the transport and the
completion signal change. The alternative — Agent-tool dispatch as the real
mechanism with Buzz as a read-only mirror — was rejected because it makes Buzz
cosmetic and leaves humans unable to intervene where the work is visible.

### The turn boundary is real, and the orchestrator must respect it

An earlier draft said Golem "watches the thread". It cannot:

- `buzz-acp` holds **at most one prompt in flight per channel**, so blocking on
  a reply deadlocks the channel the reply must arrive through.
- `BUZZ_ACP_IDLE_TIMEOUT` (620s default) cancels a quiet turn; it resets only on
  agent stdout activity, which makes streaming `session/update` the keepalive.
- Queued events are **drained into one batched prompt**, so two replies can
  arrive together, in one turn.
- Unprocessed mentions are **replayed on harness startup**, so the same event
  can arrive twice.

So the orchestrator is a **state machine across turns**, resuming from durable
per-thread state, never a loop inside one. This is R14.4's central constraint.

An optional `--heartbeat-interval` (≥10s) does fire a prompt on an idle agent,
so mention-triggering is not the *only* wake — but it is dropped when busy and
never queued, which makes it a safety net rather than a mechanism.

## Identity and scoping

- Each persona gets its **own Nostr keypair**. This is Buzz's own instruction,
  not a Golem preference: *"Running multiple agents? Mint a separate keypair for
  each. Every agent needs its own identity."*
- **One `buzz-acp` process per persona.** All subprocesses behind a single
  `buzz-acp` authenticate as the same identity — `--agents N` is a throughput
  dial, not a roster.
- Identities are provisioned **per project**, bound to that project's Buzz
  workspace, the same way `.claude/agents/golem-<id>.md` is generated per
  project. Two Golem projects staffing `golem-coder` get two distinct Buzz
  agents.
- Golem CLI provisions and owns them (USER, 2026-09-19) — `golem buzz provision`,
  wired into the existing persona-sync path so a roster change updates them
  without manual re-entry.
- **Golem mints keypairs; the user registers them.** Relay membership needs
  `buzz-admin add-member --pubkey <hex>` with the relay's own signing key in
  `BUZZ_RELAY_PRIVATE_KEY` — a credentialed operator act. Golem prints the
  command and stops.
- **Secrets never touch the repo.** `BUZZ_PRIVATE_KEY` lives in Golem's
  credential store and is injected at spawn; only pubkeys are committed.

## Mapping: persona → Buzz agent

| Golem persona field | Buzz side |
|---|---|
| persona id (`coder`, `planner`, …) | the agent's Nostr identity + display name; `@mention` resolves by `p` tag |
| `.claude/agents/golem-<id>.md` body | the role prompt, applied by Golem's own runtime — Buzz's "agent instructions" field is not needed for a tier-3 runtime |
| `inference.personas.<id>.model` | **stays on Golem's side** — read at turn time, never written to Buzz |
| effort | **not modelled, deliberately** — unreachable for a tier-3 runtime (see above) |
| fixed: `golem` | `BUZZ_ACP_AGENT_COMMAND` (headless) or the `custom_harnesses/golem.json` id (Desktop) |
| project owner as trust root | `BUZZ_ACP_RESPOND_TO=owner-only` (the default, and the floor Golem sets) |

`owner-only` has a sharp edge worth surfacing in tooling: an agent whose owner
has not resolved responds to **nothing**, which reads as a hang rather than a
permission denial.

## The reverse direction: Golem as an addressable orchestrator

A human or another agent `@mention`s **Golem** in a project's channel (e.g.
`@Golem ship task R14.2`). Golem's orchestrator — its own `buzz-acp` process
with its own identity — wakes, resolves the request the way it does today (task
doc lookup, ambiguity grilling), posts an ack, dispatches by `@mention`-ing the
appropriate persona in-thread with the same content it would pass to `Agent()`,
and **ends its turn**. A reply mentioning Golem wakes it again; it reads its
durable thread state, sequences the next persona, and eventually posts a
summary back to the human.

Personas are also addressable **directly** — `@golem-coder`, skipping the
orchestrator — because each has its own identity with the project owner already
inside its trust boundary. Orchestration through Golem is the common path, not
the only one.

```
@Golem "ship task R14.2"
  -> Golem acks, dispatches @golem-planner with the R14.2 brief, ends its turn
  -> planner replies with a plan, mentioning Golem
  -> Golem wakes, dispatches @golem-coder with brief + plan, ends its turn
  -> coder replies with a diff/PR link
  -> Golem wakes, dispatches @golem-reviewer, ends its turn
  -> reviewer replies with findings
  -> Golem posts the final summary, mentioning the human
```

Posting is done by shelling out to **buzz-cli**, not by an ACP method:
`buzz messages send --channel <uuid> --reply-to <root> --mention <pubkey>
--content -`. `buzz-acp` pre-injects `BUZZ_RELAY_URL`, `BUZZ_PRIVATE_KEY` and
`BUZZ_AUTH_TAG`, so the CLI is already authenticated as that agent. Use
`--mention`, never an inline `@Name` — Buzz matches on the `p` tag, and an
inline handle changes the message body (which is also why the harness's
`!cancel` / `!rotate` / `!shutdown` owner commands need the mention passed
separately).

## External prerequisites Golem cannot ship

`buzz-acp`, `buzz-admin` and `buzz` (buzz-cli) are Rust binaries from
`block/buzz`, and a relay needs Docker Postgres + Redis. Golem detects them on
PATH and reports what is missing; it must not try to build or bundle them, per
`CLAUDE.md`'s no-heavyweight-deps rule. This is what keeps R14.3's live gate an
`owner: user` step.

## Out of scope for this design

- **Buzz persona packs** (`--persona-pack` / `--persona` / `--workdir`,
  per-persona MCP servers, `.agents/skills/`) — the spawn wiring is PR #7359,
  **open and unmerged** as of 2026-09-19. Orthogonal to persona dispatch, and
  not safe to build on yet.
- Buzz's forum, voice/huddle and canvas surfaces beyond channel `@mention` text.
- Writing to Buzz Desktop's `managed-agents.json` — undocumented private state;
  `block/buzz#4869` tracks the control API that would make it legitimate.
- Self-hosting the relay vs using hosted `buzz.xyz` — a deployment choice for
  the user. Note only that tier-3 custom harnesses are documented for **Buzz
  Desktop**; the headless path works either way.

## Still unverified

See `verification-notes.md` §19 item 11 for the full list. The ones that affect
design rather than detail: whether BYOH exists on hosted `buzz.xyz`, the flag
that selects `thread` rather than `channel` session scope, and everything that
needs a live relay to observe.
