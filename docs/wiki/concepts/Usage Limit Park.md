---
title: Usage Limit Park
type: concept
tags: [snooze, usage-limits, pre-tool-use, hooks, decision-38, decision-45, adr-0002]
sources: [src/hooks/snooze-nudge.ts, src/hooks/pre-tool-use.ts, src/proxy/limit-prediction.ts, src/cli/status-render.ts, docs/plan/proposals/golem-snooze.md, docs/plan/tasks/snooze-taskadd.md]
created: 2026-08-22
updated: 2026-10-08
---

# Usage Limit Park

As the session (5h) usage window fills, Golem stops the agent working and
redirects it to **park**: one `snooze` call that files a durable note and waits
for the reset, instead of burning the last of the window and losing its place.
Spec Decisions 38 (snooze) and 45.

> **Superseded default (2026-09-25, USER decision).** Decision 45 made enforcement
> the default. The code now ships **advisory**: `snooze.enforce` and
> `snooze.spawn_gate` both default `false` (`src/config/schema.ts:1200-1201`).
> Enforcement and the spawn gate are opt-in. The guidance rule
> `golem-snooze-hold` carries the same wording ([[Guidance Rules]]).

## The parts

**The reading.** The proxy is the only component that sees Anthropic's
per-response `anthropic-ratelimit-unified-*` headers, so it persists a
`LimitPrediction` — 5h and 7d utilization plus reset times — to
`.golem/state/limit-state.json` (`src/proxy/limit-prediction.ts`). Observe-only:
it never alters the forwarded response.

**The decision.** `decideSnoozeNudge` (`src/hooks/snooze-nudge.ts`) turns that
reading into `park`, `stale` or `none`, at a default threshold of **90%**.

**The gate.** The shared `PreToolUse` hook denies the pending tool call and
returns the park instruction as the deny reason.

## Advisory vs enforcing

`snooze.enforce` (default **false** since 2026-09-25, `src/config/schema.ts:1200`; env `GOLEM_SNOOZE_ENFORCE`; the hook reads it at `src/hooks/pre-tool-use.ts:70-78` and falls back to advisory if the config read throws):

- **Advisory (default)** — a single redirect per reset window, which the agent can
  work past. The one-shot marker is written when the redirect fires
  (`src/hooks/pre-tool-use.ts:281-285`).
- **Enforcing** (`snooze.enforce: true`) — every tool call outside
  `PARK_EXEMPT_TOOLS` is denied until the agent parks or the window resets. The
  block must persist, so no one-shot marker is written.

An honest limit: a `PreToolUse` deny cannot stop the model spending tokens
*reacting* to it. Enforcement funnels the model to `snooze` fast; it is not a
hard token freeze.

## Park must stay reachable

`PARK_EXEMPT_TOOLS` is `mcp__golem__snooze`, `ToolSearch` and
`mcp__golem__expand`. The last two were added after the deny deadlocked live
twice (2026-08-10, 2026-08-13): `snooze` is a **deferred** tool, so calling it
requires loading its schema via `ToolSearch`, and `expand` is the way back from a
CCR reference. Denying either makes the sole permitted tool uncallable. None of
the three spends meaningful budget, which is what makes exempting them safe.

The same reasoning fixed task `snooze-taskadd`: the guidance rule's first step was
`golem task add`, which runs through `Bash` and is therefore denied by its own
second step. Rather than exempt it, `snooze` gained a **`note` parameter** that
files the durable task itself, before the wait — the ordering problem became
structurally impossible instead of exempted. So the park is **one call**:

```
snooze(until="<reset ISO>", note="<where you're up to + next steps>")
```

## When the feed goes cold

The park decision is only as good as the reading, and the reading only refreshes
when an upstream response carries the headers. If the active account or upstream
stops emitting them — an API-key upstream after an account switch, say — the
state freezes. The old logic then failed *silently*: a stale low reading simply
returned "no nudge", so the parking net vanished exactly when it mattered.

`decideSnoozeNudge` now checks staleness **before** park (a park decision is only
trustworthy on a fresh reading) and emits `stale` after 30 minutes: warn once so
the blindness is visible. A stale reading never hard-blocks — a deny on bad data
is worse than the blindness it would be acting on.

## What it does not cover

A **subagent** never reaches this gate at all: it dies on a model request, before
it can propose a tool call to deny. That gap is answered one level up, at the
spawn — see [[Spawn Headroom Gate]].

## Visibility

```
Limits: 5h window 42% used (resets …) · observed 2m ago · park advisory · spawns ungated
Limits: 5h window 42% used (resets …) · observed 2m ago · park enforced · spawns allowed ~18%/agent
Limits: STALE (last reading 240m ago, 5h 17%) — auto-park blind; … · park enforced · spawns warn-once
```

The first line is the default (advisory, gate off); the second shows both opted in
(`src/cli/status-render.ts:100-140`).

Related: [[Spawn Headroom Gate]] · [[Guidance Rules]] · [[Plan Tasks]]
