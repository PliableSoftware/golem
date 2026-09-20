---
title: Buzz Integration
type: concept
tags: [r14, r14-2, r14-3, r14-4, buzz, agents, orchestration, personas, acp, harness, nostr, rate-limits, lanes, nesting]
sources: ["https://buzz.xyz", "https://github.com/block/buzz", "https://github.com/block/buzz/blob/main/crates/buzz-acp/README.md", "https://github.com/block/buzz/blob/main/crates/buzz-acp/src/config.rs", "https://github.com/block/buzz/blob/main/crates/buzz-acp/src/scope.rs", "https://github.com/block/buzz/blob/main/crates/buzz-acp/src/pool.rs", "https://github.com/block/buzz/blob/main/ARCHITECTURE.md", "https://github.com/block/buzz/blob/main/crates/buzz-cli/README.md", "https://agentclientprotocol.com", "https://agentclientprotocol.com/protocol/prompt-turn", "https://github.com/agentclientprotocol/claude-agent-acp/blob/main/docs/session-failure-extension.md", "https://engineering.block.xyz/blog/configuring-agents-in-buzz", "https://engineering.block.xyz/blog/run-your-own-buzz-relay", "docs/plan/verification-notes.md", "src/inference/personas.ts", "src/inference/persona-lane.ts", "src/inference/target-dispatcher.ts", "src/cli/persona-sync.ts", "src/hooks/spawn-gate.ts", "src/proxy/limit-prediction.ts", "src/hooks/snooze-nudge.ts", "https://raw.githubusercontent.com/agentclientprotocol/typescript-sdk/main/README.md", "https://unpkg.com/@agentclientprotocol/claude-agent-acp/package.json", "https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts", "https://github.com/agentclientprotocol/claude-agent-acp/blob/main/examples/simple-client.ts", "https://agentclientprotocol.com/protocol/schema", "https://docs.claude.com/en/docs/claude-code/cli-reference", "docs/plan/tasks/R14.2.md", "docs/plan/tasks/R14.3.md", "docs/plan/tasks/R14.4.md"]
updated: 2026-09-20
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
(2026-09-19) resolves everything §17 and §18 left open, **§20** (2026-09-19)
adds the rate-limit/usage-cap behaviour, the setup and distribution picture, the
session-scope flag, and one correction to §19, and **§21** (2026-09-20) settles
lane-transparent dispatch — whether a worker-lane persona can be as addressable
in Buzz as an agent-lane one, and what it takes to borrow an agent loop by
nesting ACP. Those sections are the authority on wire-level facts; this page
carries the design and the decisions. Where they ever disagree, the notes are
right and this page is stale.

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

## Lane-transparent dispatch: one identity, either lane

USER requirement (2026-09-19): *"a Golem worker should be a Buzz agent, the same
way as a Claude subagent… this should be almost invisible to the end user, and
the rules used to route to the ideal target should appear the same in Buzz, but
route to the relevant lane, with the same prompt from the relevant
`.golem/personas/` .md and with the model specified in the `inference.personas`
map."*

Golem's bench has two lanes, resolved by `resolvePersonaLane()`
(`src/inference/persona-lane.ts`): a **registry target** puts a persona on the
**worker** lane, which Golem dispatches to itself as a bounded single-shot; a
plain **model id** puts it on the **agent** lane, where the *harness* runs a
subagent. That split is visible today — `resolveDesiredAgents()` in
`src/cli/persona-sync.ts:92` generates `.claude/agents/golem-<id>.md` only for
agent-lane personas, so a worker-lane persona is absent from the roster rule
entirely and reached by a different mechanism (the `coder` MCP tool). In Buzz
that asymmetry must not exist.

### Separate the three things the word "lane" is doing

The requirement is achievable, but only once three axes are pulled apart. They
have different answers, and conflating them is what makes the problem look
harder than it is:

1. **Addressability** — identity, `@mention` handle, provisioning, roster.
   **Must be lane-agnostic, and already can be.** R14.2 provisions one Nostr
   identity per *staffed* persona, and staffing is a lane-independent property.
2. **Framing** — which prompt and which model the turn runs with.
   **Must be lane-agnostic**, from `resolvePersonaPrompt()` and
   `inference.personas.<id>.model`. Two real defects block this today; see below.
3. **Execution capability** — does the turn get a tool-use loop?
   **Cannot be equalised by fiat**, because it is a property of the *model*, not
   of Buzz. A 4B local model cannot drive an agent loop wherever it runs. This
   axis is reported honestly, never hidden.

The user's requirement binds axes 1 and 2. Axis 3 is an honest capability
difference — and the right shape for it is that the Buzz human never sees a
*different kind of thing*, only a persona that answers conversationally rather
than one that opens files.

### Why Buzz removes the constraint that created the split

`persona-lane.ts:11-15` records the reason the agent lane exists: *"an MCP
server exposes tools to its client and cannot invoke the client's own tools, so
there is no call that spawns a subagent."* That is a fact about Golem's **MCP
server**, not about Golem. `golem acp` is a process Buzz spawns directly over
stdio — a top-level process, free to spawn children of its own. The barrier is
gone.

What does *not* dissolve is the fact underneath it: **Golem owns no agent loop.**
Buzz does not create one; it only removes the barrier to **borrowing** one.

### Borrowing a loop: nested ACP, confirmed viable

`golem acp` can be an ACP **Agent** upward to `buzz-acp` and an ACP **Client**
downward to a nested `@agentclientprotocol/claude-agent-acp`, relaying
`session/update` up the chain. Verified 2026-09-20 —
`verification-notes.md` §21 carries the evidence and the caveats:

- **No new dependency.** `@agentclientprotocol/sdk`, already settled on in
  R14.3, ships both halves: `agent({name})` + `connect(stream)` and
  `client({name})` + `connectWith(stream, …)`. (Stay on ACP **v1**; v2 lives
  behind an `experimental/v2` import and warns it may break in any release.)
- **Nesting is a supported use, not a trick.** The adapter ships its own
  reference client that spawns `dist/index.js` over piped stdio and relays
  `session/update` — exactly this shape.
- **The persona prompt injects cleanly.** `_meta.systemPrompt` on `session/new`
  takes a string (full replacement) or `{"append": …}` (the
  `--append-system-prompt` equivalent), so `resolvePersonaPrompt()`'s text goes
  in directly. The model goes in via `_meta.claudeCode.options.model`, or at
  runtime via `session/set_config_option` with `configId: "model"`.
- **Claude Code is *not* a separate prerequisite.** The adapter depends on
  `@anthropic-ai/claude-agent-sdk`, which ships the native `claude` binary as a
  platform-specific optional dependency; it never consults `PATH`. One npm
  install brings everything. Because that binary *is* a heavyweight native dep,
  it must be an **optional add-on**, never part of the default `golem-run`
  tarball.
- **Golem's pipeline still applies — this is the mechanism the adapter is built
  around.** `authenticate` with `methodId: "gateway"` sets the nested session's
  `ANTHROPIC_BASE_URL` to Golem's own proxy and `ANTHROPIC_AUTH_TOKEN` to a
  literal `"acp-proxy"` whose in-source comment is *"Bypass local Claude login
  checks"* — so the proxy holds the real credential and **no `claude login` is
  needed**. The adapter even re-asserts that route into the programmatic
  settings tier so a user's `settings.json` cannot silently restore a different
  base URL. Redaction, compression, limit prediction and telemetry therefore
  reach a nested turn on the same footing as a worker-lane one.

One thing the obvious design cannot do: **`_meta` cannot select the main-thread
agent.** The adapter deletes `agent` (singular) on purpose, so Golem cannot
point a nested session at its own generated `.claude/agents/golem-<id>.md` and
say *"be that one"*. Injecting the prompt via `_meta.systemPrompt` is the
answer — and it is the better one, because both lanes then read
`resolvePersonaPrompt()` directly instead of one lane parsing a file the other
lane generated. (`claude -p --agent <name>` *can* do main-thread selection; it is
the documented fallback, not the preference.)

Note too that `settingSources` defaults to `["user","project","local"]`, so a
nested session loads the repo's `CLAUDE.md` and `.claude/agents/` from its
`cwd`. Wanted, probably — but it also makes `golem-<id>` definitions available
as *subagents* of the nested session, so a persona could dispatch a persona.
Decide that deliberately rather than discover it.

### What ships when

Three layers, deliberately ordered so the research-gated one moves the least:

| | Scope | Gated on |
|---|---|---|
| **A. Addressability** | one Buzz identity per staffed persona, whatever its lane | nothing — R14.2 as written |
| **B. One-shot execution** | *either* lane runs a bounded single-shot on its configured model with its persona prompt | a `model?:` field on `DispatchRequest` |
| **C. Borrowed loop** | agent-lane turns nest `claude-agent-acp` for real tool use | the permission decision below |

**B is the right scope for R14.3, and not a consolation prize.** R14.3's stated
scope is already *"the plain-conversation case only"* — and for conversation a
one-shot is the *correct* execution mode, not a degraded one. Someone asking
`@golem-reviewer` what they think of an approach wants an answer, not a file
edit. **B handles conversation; C handles work.** That makes C a natural
follow-on task rather than scope creep inside R14.3, and it keeps the executor
behind one interface so swapping B for C changes a single module.

### Two defects that block axis 2 today

Both are local, both are real, and neither was visible before this requirement:

- **No worker-lane dispatcher calls `resolvePersonaPrompt()`.** The only one
  that exists (`src/mcp/coder-tools.ts:133`) hardcodes `resolveCoderPrompt()`
  and never reads `.golem/personas/coder.md`; the agent lane calls
  `resolvePersonaPrompt()` for every persona *but* special-cases `coder` to
  `resolveCoderPrompt()` when nothing explicit is set. The lanes genuinely
  disagree about the coder's prompt right now. "The prompt always comes from
  `resolvePersonaPrompt()`" is a **change**, not a citation — and the
  `inference.coder_prompt` precedence collision needs an explicit rule.
- **`DispatchRequest` has no model override**, so an agent-lane model id — which
  names no registry target *by definition* — cannot be dispatched by Golem at
  all today, even as a one-shot. One optional field, in the file R14.3 already
  opens.

### Resolve the lane per turn, and record which one ran

The persona is bound at spawn (`--persona <id>` arrives in
`BUZZ_ACP_AGENT_ARGS`, and `buzz-acp` respawns with the same environment), so
identity cannot drift. The **lane** can: it is derived from
`inference.personas.<id>.model`, which a settings edit changes live — exactly
what happened to `coder` on 2026-09-19.

Read it **at turn start, once per turn**. No file watcher: `persona-watcher.ts`
exists to regenerate *artifacts*, and a headless daemon that consumes the value
at turn start gains only a race by watching. Caching it for the turn is the part
that matters — a settings edit must never make a single turn change execution
style halfway through.

**Then record the resolved lane in R14.4's thread state.** A thread deferred
under one lane and resumed after a settings change would otherwise switch
execution style silently mid-sequence. Pin the lane for the sequence, or say in
the channel that it changed; do not let it happen quietly.

### Rate limits interact with the lane, and C is not B

R14.3's policy — bounded in-turn retry, then post once and `end_turn` — holds
unchanged for the worker lane *and* for B, since both go through
`target-dispatcher.ts`. A **nested** turn is different in four ways:

- **Golem never sees the 429.** It happens inside the child, so the planned
  `RateLimitedError` at Golem's dispatch boundary cannot fire. Golem reads the
  child's `stopReason` and its `_meta` failure instead. Note the inversion: the
  `sessionFailure` `_meta` extension is **dropped** by `buzz-acp` going up (which
  is why the channel message exists) but is **load-bearing** coming down.
- **No in-turn retry.** A nested turn is not idempotent — it may already have
  written files or run commands — so retrying the whole turn can duplicate side
  effects. The ≤60s budget is right for a one-shot and wrong here: detect, kill
  the child, defer, post once, `end_turn`.
- **The pre-flight gate matters more, and already exists.** A nested spawn *is* a
  subagent spawn in the sense [[Spawn Headroom Gate]] means, so gate it with the
  existing pure `decideSpawnGate()` rather than a second rule, alongside
  [[Usage Limit Park]]'s `decideSnoozeNudge()`.
- **Both timeouts bite for real.** The child's `session/update` must be relayed
  as it arrives — buffering kills the parent turn at the 620s idle timeout — and
  Golem must impose its own child timeout below `BUZZ_ACP_MAX_TURN_DURATION`
  (7200s) and kill the child, or `buzz-acp` kills the parent and orphans a
  grandchild. `session/cancel` must be forwarded down, which the `steer` default
  makes routine rather than rare.

### The open decision, stated plainly

Nesting means **an unattended agent, woken by a chat mention, writing into a real
repository.** The adapter puts that entirely in the parent's hands: every tool
call round-trips through `session/request_permission`, there is no silent
bypass, and `permissionMode` / `allowDangerouslySkipPermissions` are the
parent's to set. The upstream reference client answers every request
`allow_once` — full unattended write access.

That is a **user decision, not a research gap**; no further reading resolves it.
Tier C should not ship until it is taken explicitly, default-deny, and surfaced
in `golem buzz status`.

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
- **A new @mention cancels the turn in flight, by default.**
  `--multiple-event-handling` / `BUZZ_ACP_MULTIPLE_EVENT_HANDLING` defaults to
  `steer` (cancel + re-prompt, framed as a message that arrived mid-task).
  Batched draining into one prompt is the non-default `queue` mode. So a turn
  must survive being cut off part-way through its own posting, not only being
  handed two events at once.
- Unprocessed mentions are **replayed on harness startup**, so the same event
  can arrive twice.
- Session scope is selected by `--session-policy` / `BUZZ_ACP_SESSION_POLICY`
  (`channel` default, `thread` available but shipped dark).

So the orchestrator is a **state machine across turns**, resuming from durable
per-thread state, never a loop inside one. This is R14.4's central constraint.

An optional `--heartbeat-interval` (≥10s) does fire a prompt on an idle agent,
so mention-triggering is not the *only* wake — but it is dropped when busy and
never queued, which makes it a safety net rather than a mechanism. Golem's
orchestrator runs with one anyway (R14.4), because the rate-limit design below
needs *some* unattended wake; the honest framing is that it makes resumption
likely, never certain.

## Rate limits and usage caps: end the turn, say so in the channel

Golem's usage-limit protection ([[Usage Limit Park]], [[Spawn Headroom Gate]])
is a Claude Code `PreToolUse` hook — it denies the next *tool call* and
redirects an *interactive* session to call `snooze`. **None of it reaches a
`golem acp` turn**, which has no tool-call loop and no human present. Nor does
`.golem/state/limit-state.json` get written by it: that file is a side effect of
traffic through Golem's **proxy**, and Golem's in-process dispatcher throws away
response headers and reports a 429 as an unclassified error
(`verification-notes.md` §20 item 1).

Decision (2026-09-19): a rate-limited turn **posts an honest status message with
`buzz messages send`, records the thread as deferred, and returns
`stopReason: end_turn`** — with a small bounded in-turn retry (≤ ~60s) first, so
ordinary per-minute throttling never becomes a channel message. Waiting out the
window inside the turn is not an option worth weighing: `buzz-acp` allows one
prompt in flight per channel, so a parked turn deadlocks the channel its own
resume must arrive through, and a 5-hour Anthropic window outlives
`BUZZ_ACP_MAX_TURN_DURATION` (7200s) regardless.

The channel message is not a stylistic choice — it is **the only path to a
human**. `buzz-acp` never posts a `stopReason` (every value is a `tracing::warn!`
and nothing more), and it drops every `_meta` key it does not already handle, so
the `sessionFailure` extension `@agentclientprotocol/claude-agent-acp` uses for
this exact condition would be swallowed. `end_turn` is also the only safe
stopReason: `max_tokens` and `max_turn_requests` make `buzz-acp` discard the ACP
session, and `refusal` misreports a transient external condition as policy.

What *is* reused from snooze is its **decision**, not its mechanism:
`decideSnoozeNudge()` is already a pure function of a `LimitPrediction`, so Buzz
turns and Claude Code sessions park on the same threshold instead of drifting
apart, and `persistSnoozeNote()` files an operator breadcrumb into
`golem task list`. `runSnooze()` — the part that blocks — is exactly what must
not be reused. Detail and evidence: `verification-notes.md` §20 items 1-3;
build split in R14.3 (detect, retry, post, end) and R14.4 (defer, resume).

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
| `resolvePersonaPrompt(id, …)` | the role prompt, applied by Golem's own runtime — Buzz's "agent instructions" field is not needed for a tier-3 runtime. **Not** the `.claude/agents/golem-<id>.md` body: that file exists only for agent-lane personas, so reading it would reintroduce the asymmetry this design removes |
| `inference.personas.<id>.model` | **stays on Golem's side** — read at turn time, never written to Buzz. Decides the *lane*, and so the execution mechanism, but never the identity |
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

**There are no prebuilt CLI binaries** — every asset of the latest release
(`desktop-v0.5.23`, 2026-09-05) is a Buzz Desktop installer, and there is no
Homebrew tap or npm distribution, so the documented path is `cargo build
--release -p <crate>`. Two shortcuts are real and worth surfacing in tooling:
`buzz-admin` ships inside the relay container image (`docker run --rm
--entrypoint /usr/local/bin/buzz-admin ghcr.io/block/buzz:main generate-key`),
so key-minting needs no Rust toolchain; and the relay itself can be stood up
with `just setup && just build` + `just relay`, a one-click Railway template, or
a Block-hosted community at `<name>.communities.buzz.xyz` (three per account).
Hosted relays are per-user communities, not a shared public relay.

**Claude Code is not on this list, and that is a confirmed finding rather than
an omission** (§21 item 9). The nested agent-lane path (tier C above) needs
`@agentclientprotocol/claude-agent-acp`, which depends on
`@anthropic-ai/claude-agent-sdk`, which ships the native `claude` binary as a
platform-specific **optional dependency** and never consults `PATH`. One npm
install brings the whole tree, so there is no "install Claude Code first" step
and — via the `gateway` auth method pointing at Golem's own proxy — no
`claude login` step either.

What it *is* is a **heavyweight native dependency**, which `CLAUDE.md` forbids
in the default install. So it must be an **optional add-on** that `golem buzz
status` reports as present or absent, installed on demand for tier C only.
Worker-lane and tier-B personas need none of it.

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
- **Tier C (nested `claude-agent-acp`) is out of scope for R14.3**, which ships
  tiers A and B. It is confirmed viable rather than built, it carries a native
  optional dependency and an unsettled permission decision, and folding it into
  an already size-M task would make neither half reviewable. It wants its own
  task doc.

## Still unverified

See `verification-notes.md` §19 item 11, §20 and §21 for the full list. §20
closed two of the three that mattered — the session-scope flag is
`--session-policy` / `BUZZ_ACP_SESSION_POLICY`, and there is no npm client to
wrap instead of shelling out to `buzz`. What remains, design-first:

- **Whether tier-3 BYOH works against a hosted community.** It reads as a
  client-side runtime seam and so should be relay-agnostic, but nothing says so.
  The headless `buzz-acp` path does not care either way.
- **Whether a hosted community's owner can register an agent pubkey** without
  the relay's signing key. An in-app invite UI is implied by `block/buzz#4209`
  but nobody has walked it. Needs a live account.
- **`thread` session scope on a real relay** — implemented but shipped dark, so
  it deserves observation rather than trust.
- **How `goose acp` and `codex-acp` handle a provider rate limit**, which would
  be corroboration for the design above rather than a dependency of it. Neither
  could be sourced without reading their source directly.
- Everything else that needs a live relay to observe: the NIP-42 handshake, a
  real end-to-end turn, and whether `golem acp` satisfies `buzz-acp` in practice.

Added by §21, all of them tier-C concerns that do not block R14.3:

- **`@agentclientprotocol/claude-agent-acp` was read from `main`, not from the
  `0.79.0` tag** — the published tarball ships only compiled `dist/`. Every
  `_meta` key above is an extension point rather than spec surface, so pin the
  version and re-verify against the pinned build before depending on one.
- **Whether the SDK's `Read`/`Write`/`Edit` tools route through `fs/*`**, and
  whether `terminal/*` client methods are ever called. Two passes disagreed on
  the second; both agree `terminal: false` works and that terminals surface as
  tool-call content. Resolving it means reading `src/tools.ts` in full.
- **The permission posture is a user decision, not a research gap** — no further
  reading resolves it, and tier C should not ship before it is taken.
