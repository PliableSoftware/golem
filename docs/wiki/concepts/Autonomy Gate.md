---
title: Autonomy Gate
type: concept
tags: [autonomy, hooks, permission, adr-0002, adr-0006, safety]
sources: ["docs/decisions/ADR-0002-autonomy-approval-gates.md", "docs/decisions/ADR-0006-remote-steering-and-the-companion-app.md", "https://code.claude.com/docs/en/hooks", "docs/plan/verification-notes.md §141"]
updated: 2026-08-28
created: 2026-08-28
---

# Autonomy Gate

Golem's approval gate: a per-project autonomy **level** crossed with a per-call
action **class**, enforced through two Claude Code hooks. Threat model and the
default-deny proofs are `docs/decisions/ADR-0002-autonomy-approval-gates.md`.

## The two axes

**Action class** (`src/autonomy/classify.ts`) — `read`, `write`, `destructive`,
`outward`, `unknown`. Classification is per tool call, and for `Bash` it reads
the command.

**Autonomy level** (`src/autonomy/policy.ts`, stored in
`.golem/state/autonomy.json`) — `manual` (default), `assisted`, `outcome`.

| level | read | write | unknown | destructive / outward |
|---|---|---|---|---|
| `manual` | native prompt | native prompt | native prompt | **never auto** |
| `assisted` | auto-allow | native prompt | native prompt | **never auto** |
| `outcome` | auto-allow | auto-allow | forced ask | **never auto** |

The never-auto column is the invariant: **no autonomy level auto-approves a
destructive or outward action.** `allow` is the only value that removes a
prompt, and it is emitted narrowly.

## The two hooks (R12.12; PermissionRequest inert since DUSTSEC.10)

The gate is **two** hooks, wired and unwired together. Installing one without
the other is a half-installed gate.

1. **`PreToolUse`** (`src/hooks/pre-tool-use.ts`) — runs on every tool call.
   Classifies, writes the audit log (`appendActionLog`) and the pending-call
   record (`recordPending`), and emits `allow` / `ask` / nothing. Also carries
   the [[Usage Limit Park]], the [[Spawn Headroom Gate]] and the coder-first
   nudge, which is why it fires even when the gate itself is disabled.

2. **`PermissionRequest`** (`src/hooks/permission-request.ts`) — runs only when
   Claude Code is about to ask for permission. **Inert since 2026-10-09
   (DUSTSEC.10):** returns NO decision for any class at any level, so the native
   dialog opens and a human decides. Writes nothing.

### History: the R12.12 deny, and why it was removed

R12.11 found that `ask` forces a question but does not answer one, and a
permission dialog is what a connected permission-relay channel is notified of
(`docs/plan/verification-notes.md` §141). R12.12 therefore made this hook
return a real `deny` for `destructive` / `outward`, so no dialog existed to
relay. It denied for everyone, so a human at the terminal was never asked
either. See
[[R12.12 -- the gate moved one event earlier, where a decision can actually resolve the request]].

**USER decision 2026-10-09, against the recommendation to keep the deny:** ask
the human again. A conditional deny (only while a relay is connected) was not
possible, because no "relay connected" signal exists at the hook. Consequence,
recorded in ADR-0002: with a relay channel connected, the relay may now be
notified when the dialog opens. R12.13 (does it?) is unconfirmed. `allow` is
still never emitted for either class. The hook stays wired so existing installs
keep resolving it.

### Before / after, per class (all three autonomy levels behave the same here)

| class | `PreToolUse` (unchanged) | `PermissionRequest` before | `PermissionRequest` after |
|---|---|---|---|
| destructive, outward | `ask` | `deny` | no decision (native dialog) |
| read, write, unknown | per matrix above | no decision | no decision |

### The shapes are not interchangeable

| event | field | reason field |
|---|---|---|
| `PreToolUse` | `hookSpecificOutput.permissionDecision` (flat) | `permissionDecisionReason` |
| `PermissionRequest` | `hookSpecificOutput.decision.behavior` (nested; Golem no longer emits one) | `message`, deny only |

Emitting the wrong shape is a **silent no-op** — no error anywhere.

## Fail-safe discipline

Every failure path in both hooks exits 0 with **no stdout**: unparseable input,
a missing project, a config read that throws. No decision means the native
permission flow — the human — governs. **No path ever emits `allow` on error.**
Neither hook uses exit 2, which would hard-block.

Deferring at `PermissionRequest` is byte-for-byte what a project with no such
hook registered already does; since DUSTSEC.10 that is true for every class.

## Controls

```
golem autonomy show              # level + whether the gate is enabled
golem autonomy set <level>       # manual | assisted | outcome
golem autonomy enable|disable    # the gate toggle — keeps the nudges
golem autonomy wire|unwire       # install/remove BOTH hooks
golem autonomy log               # the decision audit trail
```

`golem autonomy disable` is a **separate toggle** from the hook wiring: it turns
the gate off at both events while leaving the snooze and coder-first nudges
running. `golem init` wires both hooks by default.

## Related

[[Blocked State Read Model]] · [[Usage Limit Park]] · [[Spawn Headroom Gate]] ·
[[Guidance Rules]] · [[Configuration Surfaces]]
