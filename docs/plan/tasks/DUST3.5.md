---
task: DUST3.5
title: "Credentials reach the proxy and stay out of routes: auto-start must load gateway keys, gateway ids must not collide on one env name, the Gemini key leaves ProxyRoute"
state: done
owner: agent
size: M
discipline: code
design: "SUMMARY.md DUST1.11 (SessionStart auto-start), S16, S21, DUST1.2 (bodyModelOf); ADR-0003 (keys never enter model context or tool output); re-verified 2026-10-08"
gate: "Each defect has a regression test that fails on the current code and passes after; golem verify exit 0 before AND after; suite test count does not drop."
depends_on: []
touches: [src/cli/proxy-daemon.ts, src/cli/commands/prompt-guidance.ts, src/config/control-surface-runtime.ts, src/providers/gateways.ts, src/cli/gateways/credentials.ts, src/cli/route-resolver.ts, tests]
created: 2026-10-08
updated: 2026-10-08T18:33:43.825Z
---

## What this is

Credential-path defects. One is high-impact: a proxy auto-started by the SessionStart hook
never loads gateway keys. Write each failing test first. Work in your own worktree
(`git worktree add ../golem-dust3-5 -b dust3-5 development`), commit as you go.

## The work

1. **Auto-start skips credential resolution** (`src/cli/commands/prompt-guidance.ts:377-383`,
   `src/config/control-surface-runtime.ts:184`, `src/cli/proxy-daemon.ts:456`,
   `src/cli/commands/proxy.ts:216`). Both callers pass `{}` env to `startDetached`, which still
   sets the credentials-injected marker, so the daemon skips resolution. Fix: pass
   `credentialEnvForProxy(cwd)` at both sites, or set the marker only when the env is non-empty
   (do both if cheap). Fix the "a caller cannot inject one without the other" comment at
   `proxy-daemon.ts:454-456` to match. Test: auto-start with a stored gateway key, and assert the
   daemon env carries it or the daemon resolves it.
2. **S16: env-name collision** (`src/providers/gateways.ts:81`; schema `src/config/schema.ts:180`).
   `work-1`, `work.1` and `Work_1` all become `GOLEM_UPSTREAM_API_KEY__WORK_1`, so a second
   gateway sends the first one's key to its own host. Fix: reject colliding ids at config load
   with a clear error (fail closed). Test the collision.
3. **S21: the Gemini `?key=` rides on `ProxyRoute`** (`src/cli/route-resolver.ts:113,119`). The
   header comment (`:23`) says no key is ever placed on a route. Fix: inject the key at send
   time, so the route never carries it. If that is not possible without touching
   `src/interfaces/`, stop and report. Correct the comment. Test: the route object contains no key.
4. **`bodyModelOf` parses every body** (`src/cli/route-resolver.ts:205-215,260`). Once more than
   one target exists, every request is fully `JSON.parse`d. Reuse the pipeline's parse or a
   bounded top-level scan. The test pins the extracted model across shapes. Perf only, and it
   must not change routing.

## Hard rules

- Keys never enter model context or tool output (ADR-0003 inv. 4).
- Proxy lossless and prefix-stable at level <= 1: routing changes must not alter forwarded bytes.

## Out of scope

- Gateway CLI papercuts in `gateway.ts`, `models.ts`, `credentials/store.ts`: DUST3.6.
- `credentials.ts:222,224` comment wording: DUST3.18.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
