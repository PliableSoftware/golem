---
title: Hosted Session
type: concept
tags: [r13, adr-0007, session-host, autonomy, mtls, refusal]
sources: ["docs/decisions/ADR-0007-remote-conversation-and-hosted-sessions.md", "docs/plan/verification-notes.md §142", "docs/plan/verification-notes.md §147", "docs/plan/tasks/R13.3.md"]
updated: 2026-10-08
created: 2026-08-29
---

# Hosted Session

An agent session **Golem owns**: Golem spawned the process, chose its settings,
supervises it, and can refuse what it tries to do. Not the session on the
developer's screen — see below, because ADR-0007 §2 makes telling them apart a
documentation obligation, not just a UI one.

```
golem session host start "your first turn"
golem session host list
golem session host log
golem session host explain Bash -- "rm -rf build"
golem session host stop <id>
golem session host forget <id>
golem session host serve "an optional first turn"
```

Subcommands (`src/cli/commands/session-host.ts:77-485`): `start` (the default),
`serve` (start AND serve to paired devices over mTLS, `:203`), `list`, `log`,
`stop`, `forget` (drop a record and its transcript, `:469`) and `explain`.

Shipped-behaviour notes (DUST1.10 rows 19, 39):

- `start` is described as relaying "one or more messages" (`:78`), but the runner's
  stdin is closed on the first `result` event (`hosted.end()`, `:144`), so only the
  first turn completes. UNVERIFIED whether a multi-message `start` is exercised;
  hosted-session gaps are DUST2.19's.
- `stop` calls `process.kill(found.pid)` on the recorded pid (`:453`), which is the
  supervising CLI. Whether that takes the `claude` child with it on Windows is
  UNVERIFIED (suspected, not run).

## How it differs from the session on your screen

|  | your session | a hosted session |
|---|---|---|
| who owns the loop | Claude Code | Golem |
| Golem's role | a guest hook | the host |
| strongest move on a bad call | **ask** — insist a question be asked | **deny** — refuse outright |
| who answers a question | you, at the terminal | whoever is attached; **nobody attached is a refusal, not a wait** |
| where the gate is wired | the project's `.claude/settings.json` | injected by the host at spawn, via `--settings` |

Both run through the proxy. A hosted session gets the same redaction, the same
telemetry and the same limits, no exemption, no side door. That is ADR-0007 §5
invariant **7** ("a hosted session is not a privileged session"); invariant 8 in
that ADR is local-only enrolment. The code comment at `src/session/host.ts:21-25`
and older text here call it "invariant 8" — an ADR numbering mismatch the ADR-0007
amendment is to record (DUST2.3).

## Two enums, on purpose

`GateEmission` is `"allow" | "ask" | null` and stays that way. That union is an
honest description of what a *guest* can do: Golem is a bystander in someone
else's session and the strongest thing a bystander can do is insist a question be
asked. `null` means "the human's own permission flow governs", which only means
anything when there is a human at that terminal.

`HostDecision` is `"allow" | "ask" | "deny"`. **Widening `GateEmission` to add
`deny` would tell every existing hook call site that refusal is on the table for
the guest path**, which it is not.

The matrices are not duplicated: `decideHostGate` **derives** from `decideGate`
and translates, so the two cannot drift.

| `decideGate` | host | why |
|---|---|---|
| `ask` on destructive/outward | **`deny`** | the whole point |
| `allow` | `allow` | the matrix auto-approved it |
| `null` (defer) | `allow` | "Golem adds no restriction; the runner's flow governs" — **not** "ask a human", which at `manual` would deny every read |
| `ask` on `unknown` | `ask` | the one genuine question; unanswered, it refuses |

`allow` is expressed by the host hook emitting **nothing** — which is literally
"the runner's own flow governs". Emitting `allow` would *remove* prompts the
runner would otherwise raise.

## Where the host enforces, and why it is not where R12.12 enforces

The host gates **`PreToolUse`**, not `PermissionRequest` — the opposite of
[[Autonomy Gate]]'s guest path, for a measured reason (§147).

`PermissionRequest` fires only when Claude Code is about to *ask* for permission.
In a headless hosted session under `--permission-mode default`, most calls never
ask. Measured: a plain `echo` inside the session's own cwd ran to completion with
a `PermissionRequest` deny hook installed **and never fired it**. `PreToolUse`
fires before every tool call, and its deny stops the call with the reason
delivered to the model as the tool result.

R12.12 was aimed at the guest: its problem was a *dialog* opening and a
connected channel answering it, and `PermissionRequest` is what precedes a dialog.
Different problems, different events. (R12.12's deny was removed 2026-10-09,
DUSTSEC.10, by USER decision: the guest hook is now inert and the human answers
the native dialog; see ADR-0002.)

> The shapes are not interchangeable and the wrong one is a **silent no-op**:
> `PreToolUse` takes a flat `permissionDecision` + `permissionDecisionReason`;
> `PermissionRequest` nests `decision.behavior` + `message`.

> **Decided 2026-10-09 (P3, USER):** Decision 61's opt-in setting reaches hosted sessions,
> so Decision 60(d)'s "no setting changes that" is amended. Safeguards as for local
> sessions: off by default, fresh re-authentication per answer, a loud log, a kill switch.
> The setting is not built (R13.9), so the refusal described here is what ships today.

## The gate is the host's own

Spawned with `--settings <inline JSON>`, which **wires hooks for a project that
has none** (measured, §147). Without that, the host's enforcement would be
conditional on the guest wiring still being present — one `golem autonomy unwire`
away from a session Golem spawned running ungated.

The blob is deliberately minimal: only the `PreToolUse` gate. Everything else —
the CCR hook, the status line, MCP — is left to the project's own settings, which
the runner still loads. The host adds a gate it refuses to run without; it does
not replace the developer's configuration.

## Attribution before delivery

ADR-0007 invariant 4: a turn nobody can attribute must not run. Every relayed
turn is written to the host log — device id or `"local"`, timestamp, exact text —
**and the write is awaited before the relay**. Every tool decision is written
too, `allow` included: a log that only records refusals cannot answer "what did
this session do".

The log is bounded by **rotation by rename** (DUST3.15, 2026-10-09): past
`HOST_LOG_MAX_BYTES` = 5 MiB the live `host-log.jsonl` is renamed aside to
`host-log.<epoch-ms>-<pid>-<rand>.jsonl` and the next append starts a new file;
the newest `HOST_LOG_KEEP_ROTATED` = 3 rotated files are kept (about 20 MiB in
all). Nothing on the append path reads and rewrites the file, so concurrent
appends and `turn` attribution lines are never lost; a rename failure is
swallowed after the line has landed. `readHostLog` spans the rotated files. The
earlier line-count trim (`trimHostLog`, never called) was removed.

This is not `src/autonomy/log.ts`. That log is tool-shaped and written by a hook
inside someone else's session; this one records turns, decisions and lifecycle
for sessions Golem runs. Two relationships, two logs — the same argument as the
two enums.

## Fail-closed, unlike the guest hooks

`pre-tool-use.ts` fails to **silence**, because a crash there must leave the
human's own permission flow in charge. The host gate fails to **deny**, because
there is no human flow to fall back to and the alternative is an unsupervised
tool call in a session Golem is answerable for.

## Related

[[Autonomy Gate]] · [[Device Authentication]] · [[Conversation Store]] ·
[[Device Conversations]] · [[Usage Limit Park]] · [[Blocked State Read Model]]
