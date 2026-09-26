---
title: Device Conversations
type: concept
tags: [r13, r13.8, adr-0007, device, session, origination, resume, scrollback]
sources: [src/session/device-sessions.ts, src/session/known-projects.ts, docs/decisions/ADR-0007-remote-conversation-and-hosted-sessions.md, docs/plan/tasks/R13.8.md]
created: 2026-09-26
updated: 2026-09-26
---

# Device Conversations

R13.8: a paired device can **start** a conversation, **resume** one, and
**read back** what was said — without ever having seen a terminal. Built on
[[Hosted Session]] (a device cannot resume something Golem does not own) and
the [[Conversation Store]] (a device cannot read back what was never
recorded).

This is a different relationship to a conversation than [[Joined Session]]:
a joined session is one running on your own screen that a device can only
speak *into*; a device conversation is one the device itself brought into
being, and Golem is its host from the first message.

## The four pieces

1. **A trustworthy project list** — `GET /api/projects`. Backed by
   `known-projects.ts`, a user-scoped registry (`~/.golem/state/known-projects.json`)
   separate from any one project's own `.golem/` directory, because a device
   is not confined to one project the way a hosted session is. "Known" means
   "recorded", never "reachable now" — every list call re-checks each root
   live (`checkReachability`) and reports `ok`, `not_wired` (missing
   `.golem/settings.json` or `.claude/`, named explicitly), or `unreachable`
   (path gone), rather than trusting the stored record. Each entry also
   carries `canOriginate`, so a device can grey out a project it cannot start
   a new conversation in without a separate round trip.

2. **Starting a conversation** — `POST /api/conversations`. Gated by
   `security.origination_roots` (gate-map item 2): empty means "any reachable
   known root", a non-empty list restricts to exactly those roots, resolved
   through `resolveWorktreeRoot` *before* the check so a symlink or worktree
   cannot widen it. A refusal here is a plain 403 naming the allowlist. This
   is also gate-map item 5's high-risk act — origination is the one a device
   should not get for free; the allowlist is the policy lever.

3. **Resuming a conversation** — `GET /api/conversations/:id`. Two cases,
   told apart honestly rather than merged into one "reconnect":
   - **Still live in this process** — the conversation's `SessionBus` and
     `HostedSession` are already in memory; resuming is just returning the
     same handle (`status: "live"`).
   - **The runner process exited** — a fresh `HostedSession` is spawned with
     `--resume <runnerSessionId>` (`resumeSessionId` on `HostedSessionOptions`),
     so the underlying `claude` CLI process rebuilds its own context from its
     own on-disk transcript before the device's next message ever arrives.
     `status: "restarted"` tells the device this happened.

   A conversation recorded as alive under a **different** process's pid
   cannot be attached to across processes — that is refused with 409 naming
   the pid, rather than silently faked. One that never completed a turn (no
   `runnerSessionId` recorded yet) is refused with 409 for the same honesty:
   there is nothing on disk yet to resume from. One neither the registry nor
   the store has ever heard of is a 404 naming the id.

4. **Reading previous messages** — `GET /api/conversations/:id/messages`,
   paged with `before`/`limit` (capped at 200) over the same
   `LocalConversationStore` records `session host serve` writes turn by
   turn. Every turn — both the device's messages *and* the assistant's
   replies — lands here; scrollback is not one-sided.

## Identity — one conversation, one id (item 5)

`host-registry.ts`'s own session id is normally a random UUID chosen before
any message exists. For a device-originated conversation, `device-sessions.ts`
instead sets that id to:

```ts
conversationIdFor({ messages: [{ role: "user", content: firstMessage }] })
```

— the exact function [[Conversation Store]] and `session-tree.ts` already
share (R8.13's `cachePrefixFingerprint`). That makes the host-registry record
and the conversation-store record for the same conversation the same id *by
construction*, so the project list, the resume path, and scrollback all agree
on what they are talking about without a separate join table.

**Known limitation, stated rather than assumed**: this id is computed from
the text this module relayed to the runner's stdin, not from the actual bytes
the `claude` CLI subsequently sends upstream as the Anthropic request the
proxy observes. The runner may reshape a bare string into a content-block
array before sending it, so `session-tree.ts`'s independently-observed hash
of *that* request is not asserted bit-for-bit identical to this one — the two
are related (same first message, same intent) but not proven equal. Unifying
them would need that checked, not assumed; it has not been.

## A second limitation: cross-root resume after a restart

`resumeConversation` looks a conversation up in **this server process's own**
`options.projectDir` registry (`host-registry.ts` is itself scoped per
project root). A conversation legitimately started in a different,
allowlisted root resumes correctly *while this process still holds it live*
— its actual root is threaded through and used. But across a restart of
`session host serve` itself, that conversation is not found in the new
process's own-root registry, and resume answers a plain 404 rather than
guessing at, or silently misreading, the wrong root's store. The same care
applies to the scrollback route: it reads from the conversation's own root
when live, and falls back to the handler's own project only when it is not
— the best a new process can do for a conversation it never saw live.

## Two real bugs this task's own tests found

Writing the scrollback test (rather than asserting it) surfaced two defects
that a narrower test would have missed:

- **Only the opening turn was ever recorded as a user turn.** Every message
  a device sent *after* the first was relayed straight to the runner's stdin
  and never appended to the conversation store — scrollback showed the
  opening message and every assistant reply, but never anything the device
  said back. Fixed in `lookup().deliver`: it now awaits
  `conversationStore.appendTurn(...)` before delivering to the runner,
  matching invariant 4 (attribution before delivery) already honoured for
  the first turn.
- **Both `lookup().history()` and the scrollback route read from the wrong
  store** when a conversation's actual root differed from the handler's own
  `options.projectDir` (item 2's whole point). Fixed by scoping both to the
  conversation's own root — `entry.projectDir` while live, and
  `live.get(id)?.projectDir ?? options.projectDir` in the route.

## Fire-and-forget writes, and what that means for anyone testing this

`wireHostedSession`'s `"result"` handler publishes `turn_end` on the
`SessionBus` **before** the corresponding `store.appendTurn(...)` call
resolves (it is `void`-called, deliberately not awaited on the hot path).
The `"exit"` handlers in both `startConversation` and `resumeConversation` do
the same thing with `updateHostSession(...)` after publishing `ended`. An
observer of the bus event is not yet guaranteed the disk write has landed —
`tests/integration/device-sessions.test.ts` polls for the store/registry
state it actually needs rather than assuming synchronous-with-the-event.

## Refusals name what they looked for (item 6)

Every refusal in this module states the specific thing that was missing or
disallowed, never a bare "not found" or "forbidden": an origination root
lists the allowlist it was compared against; a duplicate conversation names
its own id and says it is still running; a resume across processes names the
pid it is recorded under; scrollback for an unknown conversation says both
stores were checked and neither had it, or names the eviction bounds
([[Conversation Store]]'s 30-day / 32-conversation caps) as the likely
reason.

## Related

[[Hosted Session]] · [[Conversation Store]] · [[Joined Session]] ·
[[Session Transport]] · [[Autonomy Gate]]
