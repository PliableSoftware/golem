---
task: credential-malformed-visibility
title: Surface malformed stored credentials without throwing or polling the keychain
state: queued
owner: agent
size: M
design: Follow-up to R8.29. The read-side malformed-key machinery was removed from that fix after review kept finding defects; this task redoes the useful parts deliberately.
gate: A stored-but-unusable gateway key is visible to the user, no code path treats it as absent and overwrites it, and `golem status` makes no new keychain reads.
depends_on: [R8.29]
touches: [src/credentials/store.ts, src/buzz/identity.ts, src/cli/gateways/credentials.ts, src/config]
created: 2026-10-09
updated: 2026-10-09
---

## Problem

R8.29 made backends byte-exact and added ingestion validation, plus a compatibility trim on read for
gateway accounts. It does NOT detect a stored value that is unusable (a control character or a code
point above U+00FF written by a hand edit or another tool). Such a key fails every upstream request in a
way that looks like a network fault, and nothing names the account or the fix.

## Scope

1. **Surface a malformed stored gateway key without throwing.** Report it as a fault with the account
   and the fix (`golem gateway login <id>`), never the value: in `golem gateway list`, and as a
   warning at proxy start. It must not stop the proxy starting for the keyed targets, must not fall
   through to a stale lower-precedence value silently, and must not change `resolve`'s contract of
   "null means absent" for callers that create on absence.
2. **No keychain polling on `golem status`.** Status must not read credentials as a side effect (macOS
   ACL prompts, DPAPI cost). If it shows credential health at all, it reads only what an existing cheap
   path already produced.
3. **Buzz `mintIdentity` must never overwrite an unreadable secret.** Today `resolve() === null` means
   mint; a stored-but-unreadable secret must be distinguished from absent and refused with a clear
   error, because re-minting is an irreversible identity rotation. Check `provisionBuzz` for orphaning
   when it refuses.
4. **Reserve gateway ids `portal-oauth` and `buzz:*` in the schema**, so account-kind guessing by name
   (used by the R8.29 read-side compat trim) is exact and a gateway can never collide with a portal or
   Buzz account.

## Verification

- Hermetic tests (no real keychain; injected backends) for each of 1-4.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
