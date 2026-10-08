---
task: npm-claim-golem-run
title: "Claim golem-run on npm defensively — a deprecation stub pointing at @pliable/golem"
state: queued
owner: user
size: S
design: "docs/plan/audit/dust-1/DECISIONS.md A1/S1 (USER, 2026-10-08); SUMMARY.md S1"
gate: "`npm view golem-run` resolves to a stub owned by the project's npm account, marked deprecated with a message pointing at @pliable/golem, with no install scripts and no code beyond a pointer."
blocked: "outward, credentialed act — only the user can publish to npm"
created: 2026-10-08
---

## What this is

`golem-run` is unregistered (404 on 2026-09-26). Older installers and `golem update` on every
existing install still name it, so whoever publishes it first gets code installed on users'
machines. Claim it with a harmless stub.

## Steps (user)

1. Publish a minimal `golem-run` package: README + `package.json` only, **no** `preinstall`/
   `postinstall`/`install` scripts, no `bin` (or a `bin` that only prints the move notice and
   exits non-zero — decide; a printed notice is friendlier for `golem update` users).
2. `npm deprecate golem-run "Renamed to @pliable/golem — npm i -g @pliable/golem"`.
3. Enable 2FA-for-publish on the package.
4. Tell the agent side when done so DUSTSEC.16's docs can say the old name is a deprecation stub.

## Out of scope

- Everything in the repo (DUSTSEC.16). Agents must not publish, deprecate or claim anything.
