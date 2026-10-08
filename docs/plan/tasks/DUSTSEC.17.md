---
task: DUSTSEC.17
title: "Follow-ups from the independent review of DUSTSEC.1-16: portal refresh origin, Buzz keygen fallback, bypass-guard gaps, owner:user explicit target, acp plugin rules"
state: done
owner: agent
size: L
discipline: code
design: "Independent golem-reviewer pass over PRs #213-#219, 2026-10-08, VERDICT: block. Findings listed below with file:line. USER decisions in docs/plan/audit/dust-1/DECISIONS.md stand; this task makes the code match them."
gate: "Each finding below has a regression test that fails on the merged code and passes after; golem verify exit 0; a second independent review returns clean or concerns with no High."
depends_on: [DUSTSEC.4, DUSTSEC.6, DUSTSEC.3, DUSTSEC.11, DUSTSEC.8]
touches: [src/portal, src/buzz, src/hooks/bypass-guard.ts, src/autonomy/classify.ts, src/inference/target-dispatcher.ts, src/providers/gateways.ts, src/cli/proxy-runtime.ts, tests]
created: 2026-10-08
updated: 2026-10-08T10:26:15.798Z
---

## Findings (split across four agents by directory)

**A. Portal (`src/portal`)**
- HIGH `client.ts:207-210`, `:186`: the origin check runs only in `send()`. A token refresh POSTs the refresh token to `metadata.token_endpoint` with no host check, a committed project file can set `portal.issuer`, and `discovery.ts` never checks `metadata.issuer` equals the URL it fetched. Bind the refresh to the recorded issuer origin and refuse a mismatching `token_endpoint`.
- `team link` records `api_origin` from `portal.url`, which a project file can set. Record it only from user-scoped configuration, or refuse a project-supplied value.

**B. Buzz (`src/buzz`)**
- HIGH `identity.ts:117-123`: the positional fallback still assigns the secret as the pubkey when label lines carry no hex (for example bech32 lines come first). Refuse to guess: with no hex on a label line, fail. `provision.ts:177` compares against the stored secret, which misses this.
- MED `acp-turn.ts:146`: the `golem acp` process never calls `ensurePluginRedactionRules`, so plugin rules do not apply to prompts it dispatches (R6 says every path).

**C. Bypass guard and classifier (`src/hooks/bypass-guard.ts`, `src/autonomy/classify.ts`)**
- MED `bypass-guard.ts:146-157,172-183`: only the NEW text of an Edit is checked, so flipping the value alone passes. Check the resulting file content.
- MED `:91-122`: wrappers `timeout`, `nice -n`, `sudo -u`, `xargs` are missing or break the scan.
- MED `:36,129-134`: false deny, quoted text after a separator is split into a command segment.
- LOW `classify.ts:44-47`: a quoted write flag is hidden; the `-u` check is anchored to a leading `vitest` (`npm test -- -u` is `read`).
- LOW: `git branch --contains <sha>` and `--sort=...` regressed to `unknown`.

**D. Dispatch and routing (`src/inference`, `src/providers`, `src/cli`)**
- MED `target-dispatcher.ts:723-726`: an explicit `targetId` returns before `assertWorkerDispatchable`, so `owner: user` does not bind the `coder` tool when the caller passes `target`.
- LOW `proxy-runtime.ts:330`, `gateways.ts:128`: the shim exemption means the new "requests will be refused" warning is false under the shim. Fix the wording (the shim keeps serving by design, DUSTSEC.15).

## Out of scope

- Re-opening any USER decision.
- Migrating raw paths already in `sources.json`.
- Two secrets in paths redacting to one placeholder (note it in the task, do not fix).

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
