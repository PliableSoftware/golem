---
task: DUSTSEC.15
title: "An unknown default_target always fails closed — single-target included (behaviour change)"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md V2 (USER, 2026-10-08); DUST1.2 C4"
gate: "Probe: with exactly one target and an unknown default_target / inference.model id, requests are refused (400-class, Golem-attributed) instead of using the top-level upstream with a warning; the multi-target behaviour (route-resolver.ts:270-286) is unchanged. golem verify green by exit code."
depends_on: []
touches: [src/providers/gateways.ts, src/cli/route-resolver.ts, src/cli/proxy-runtime.ts, src/cli/targets.ts, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:14.732Z
---

## What this is

`renderTargets` promises "fail closed" (`src/cli/targets.ts:366-371`); the multi-target resolver
does 400 (`route-resolver.ts:270-286`), but with a single target there is no resolver and
`resolveActiveUpstream` falls back to the top-level config with a warning
(`src/providers/gateways.ts:116-126`; module doc `:15-19` describes the fallback as "fail-closed").

**USER decision (verbatim, V2):** an unknown `default_target` ALWAYS fails closed, single-target
included (behaviour change).

## The work

1. Make the single-target path refuse with the same error shape as the multi-target resolver.
   Decide where (resolver always present, or the fallback returns an error) and keep ONE code path
   for the decision.
2. Proxy startup: decide whether an unknown id should also fail `golem status` / startup loudly;
   requests must fail either way. State the choice in the PR.
3. Rewrite the `gateways.ts:15-19` doc to say what now happens. Tests that pinned the fallback
   change with it.
4. Changelog-worthy: note the behaviour change in the PR body.

## Out of scope

- V3 model-name selection claim (DUST2.10). Request-selection logging (DUST2.17).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
