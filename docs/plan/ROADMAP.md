# Golem Roadmap

> **Restructured 2026-07-30 (spec Decision 55, USER-requested).** This file is now
> **an index, not a container**. Every open item is a **committed Golem task** under
> [`tasks/`](tasks/) — one document per unit of work, self-contained enough to hand to
> a fresh agent or a separate conversation. Shipped history moved to
> [`SHIPPED.md`](SHIPPED.md). The table below is **generated** by
> `golem task index --write`; edit the task documents, never the table.

## How to work this roadmap

```
golem task index --summary     # one screen: what's ready, what's blocked
golem task show R8.5           # the full brief for one item
golem task list                # plan tasks + this machine's parked ones
golem task done R8.5 --note …  # close it, then re-run `task index --write`
```

Plan tasks are the same `Task` concept — and the same `golem task` CLI — that parks a
session at a usage limit (R5.1, Decision 38). They differ only in scope: **local**
tasks live in `.golem/tasks/*.json` (uncommitted machine state), **plan** tasks live in
`docs/plan/tasks/*.md` (committed, reviewable, shared). See
[`tasks/README.md`](tasks/README.md) for the frontmatter and the house style for a
brief.

**To hand an item to an agent or a new conversation:** point it at the task file. It
carries the goal, the design source, the files, the gate, and the out-of-scope list —
no roadmap reading required.

## The organising intent (Decision 36)

Everything is sorted by one criterion: does it serve the working pattern that inspired
the wiki-first pivot (Decision 28 — the "LLM Wiki / developer's second brain" article)?

1. **Plan together.** A place where the user and Claude collaborate on planning:
   reading captured notes and ideas, and turning them into tasks.
2. **Distill everything.** The project and its research distilled into the committed
   wiki; the knowledge base collects raw articles; web fetches are cached and served
   offline.
3. **A local co-developer.** A robust, token-friendly local coder that drafts so the
   paid model can judge.

Goal 2 is largely shipped (WS-W W1–W4); goals 1 and 3 landed in R4; R5 followed. See
[`SHIPPED.md`](SHIPPED.md).

## Where we are (validated 2026-07-30; CI line corrected 2026-10-08)

- **Baseline green:** `tsc --noEmit`, `biome check`, `npm run verify:deps` and
  `vitest run` all pass locally, and `golem wiki check` reports 0 issues. *(Dust
  2026-10-08: the CI billing block recorded here on 2026-07-30 cleared on 2026-09-04;
  CI now gates every PR, see `CLAUDE.md` "Branches and releases".)*
- **R8a (context economy) is shipped, and its own instruments redirected it four
  times** — §93 (98.4% cache hit rate → bust prevention is a guard rail, not a lever),
  §94 (R8.2 already existed), §95 (the `tools` block is 18.8k; Bash is the biggest tool
  consumer), §97 (Grep/Glob have no measured traffic), §100 (**93.9% of the tools block
  is not Golem's** → R8.S1 rejected, the tools-block line closed).
- **R8.5 shipped, and its gate said YES** — the first item in that line an instrument
  *approved* rather than redirected. `golem bench map` measured retrieval accuracy
  **28.6% → 50.0% (+21.4 points) for +57 tokens per call** against a plain path list
  (§101). What is still unmeasured is **displacement**: whether the model then skips
  the read (the R8 memo's open question 3) — that needs live traffic.
- **R8.6 shipped (2026-07-31), and the discipline held** — the LSP bridge is four
  **modes of the `code` tool**, not four new tools: **+333 definition tokens when
  enabled, zero when off**, versus the ~250–320-token envelope four separate tools
  would each pay (§109). Absence of a language server is a no-op on every path, proven
  against a fake server so Golem depends on none. It inherits R8.5's open question —
  displacement is still unmeasured for both.
- **R8.7 shipped (2026-07-31), and its harness overturned the design it was given.** The
  task assumed search/replace; the gate measured **33.3%** semantic for it (half the
  replies were not even in that format) and **33.3%** for `udiff` (100% compliance, half
  the hunks unmatchable), against **whole-file 91.7% semantic / 100% apply** (§110). So
  `coder`'s `edit` mode ships whole-file only, **opt-in** — +313 definition tokens when on,
  byte-identical to R8.6 when off — because the fixture-scale saving (~30 output tokens per
  edit) does not repay that bill; the claim is explicitly conditional on larger edits, and
  where the crossover sits is unmeasured. It inherits the same open displacement question.
- **R8.13 closed (§104).** The cache-prefix verdict was wrong ~98% of the time because
  `cache_control` — a breakpoint *marker*, not content — was in the fingerprint;
  0% → 73% append after the fix.
- **P0/P1 + the wiki knowledge loop** are live and dogfooded daily; compression is
  honestly scoped as situational (Decision 23); positioning is the universal pre-LLM
  processor (Decision 32).

---

## Open work

<!-- golem:task-index:begin -->

_Generated by `golem task index` from `docs/plan/tasks/` — 30 ready, 24 blocked, 215 done. Edit the task documents, not this table._

### Ready to pick up

| task | goal | owner | size | discipline | depends on | gate / blocker |
|---|---|---|---|---|---|---|
| [device-sessions-windows-eperm](tasks/device-sessions-windows-eperm.md) | "device-sessions test fails on Windows with EPERM renaming hosted-sessions.json — an atomic-write race" | agent | S | code | — | "The test passes 20 consecutive runs on windows-latest, or the cause is shown to be the test and not the writer. A fix to the writer (retry on EPERM/EBUSY with backoff) carries a unit test that injects the error." |
| [dust-comment-pass-code-defects](tasks/dust-comment-pass-code-defects.md) | "Two behaviour defects the Dust comment pass found but left alone: session-report invents compression level 1, and spawn-failure detection is unreachable" | agent | M | code | — | "Each defect has a regression test that fails on the current code and passes after: when state collection fails the report says the level is unknown rather than 1, and a failed spawnResume is detected and surfaced; golem verify exit 0." |
| [DUST2.11](tasks/DUST2.11.md) | "golem plugin diagnostics: surface every problem, count it, and name regex-hang risk" | agent | M | code | — | "`golem plugin` reports every load/validation problem it can detect with a count, flags rules whose regex has catastrophic-backtracking shape, and a throwing stage is skipped with the pre-stage body kept AND reported; tests for each. golem verify green by exit code." |
| [DUST2.12](tasks/DUST2.12.md) | "Plan-task tooling: never drop an unparseable doc silently, `golem task resume` for plan tasks, worktree capture" | agent | M | code | — | "`golem task list`/`index` report every doc they cannot parse (path + reason) instead of skipping it; `golem task resume <plan-id>` works for plan-scope tasks; a parked task records its git worktree; tests for each. golem verify green by exit code." |
| [DUST2.13](tasks/DUST2.13.md) | "Web cache: honour max-age/Expires freshness and ingest fetched pages into the KB" | agent | M | code | — | "An entry with `max-age`/`Expires` is served fresh within its window without revalidation; 304 updates meta; `no-store` or a changed 200 drops the entry; a fetched page is searchable via `search` and a re-fetch of a known URL is served offline; tests for each. golem verify green by exit code." |
| [DUST2.14](tasks/DUST2.14.md) | "Wiki → vector index via the watcher; watcher daemons for chosen paths; resumable ingest checkpoints" | agent | M | code | DUST2.3 | "A wiki page write reaches the vector index without a manual ingest; configured extra paths are watched; a killed ingest keeps finished batches (checkpoint every 20 files, deletions first); tests for each. golem verify green by exit code." |
| [DUST2.15](tasks/DUST2.15.md) | "KB lookup completeness: graph-first alias matching and full-text `fetch` for any hit" | agent | S | code | — | "A query naming a page alias surfaces that page via graph-first lookup; `fetch` returns full text for every hit kind `search` can return (getChunk); tests for each. golem verify green by exit code." |
| [DUST2.16](tasks/DUST2.16.md) | "Settings cascade gaps: default! floor, locked controls rendered with origin + recourse, ApplyResult.overridden" | agent | M | code | — | "`default!` is honoured as a floor; a pinned control renders locked with its origin and recourse on every surface (IMPORTANT_LOCKED); a write the cascade overrules returns ApplyResult.overridden and the surface says so; tests for each. golem verify green by exit code." |
| [DUST2.17](tasks/DUST2.17.md) | "Log every request's (gateway, provider, reason) selection durably, single-target included" | agent | S | code | DUSTSEC.15 | "Every proxied request appends its (gateway, provider, reason) selection to a durable log under .golem/state/ that survives daemon restart, single-target included; no credential ever appears in it; tests for each. golem verify green by exit code." |
| [DUST2.18](tasks/DUST2.18.md) | "Dashboard: tokens saved/spent, cache hit rate and cost estimate on the dashboard itself" | agent | S | code | DUST2.10 | "The dashboard shows tokens saved/spent, cache hit rate and a cost estimate from the same sources as `golem stats --cache` / `golem bench cost`, labelled 'estimated' where chars/4; tests for the data path. golem verify green by exit code." |
| [DUST2.19](tasks/DUST2.19.md) | "Hosted sessions: surface remote-authored turns locally, park at the usage limit, interrupt from the device" | agent | M | code | — | "A remote-authored turn is visibly marked in the local session view; a hosted session parks at the usage limit like any other (snooze path, note filed); a device can interrupt a running turn and the turn resolves cancelled; tests for each. golem verify green by exit code." |
| [DUST2.20](tasks/DUST2.20.md) | "Compression gating completeness: per-content-type Headroom mapping, tool-result cache with mtime invalidation, lossy-stage gate declarations" | agent | M | code | — | "`compression.level` maps to Headroom config per content type as documented; a tool-result cache entry invalidates on file mtime change; every lossy stage declares the level that gates it and a test enumerates them; the unified MCP surface decision for Headroom retrieve/stats/memory is recorded (implement or retire). golem verify green by exit code." |
| [DUST2.21](tasks/DUST2.21.md) | "Release lockstep and CI: release.mjs moves all versions or none; release asserts SHA256SUMS and the tarball" | agent | S | code | DUSTSEC.16 | "scripts/release.mjs updates package.json, vscode-extension/package.json and VERSION atomically (a failure part-way leaves none changed — tested); the release workflow's required-asset assertion includes SHA256SUMS and the npm tarball under its @pliable/golem name. golem verify green by exit code." |
| [DUST2.22](tasks/DUST2.22.md) | "Team-wide prompt through the team origin, merged per field, project outranks team" | agent | S | code | DUSTSEC.14 | "A persona/prompt field set in the team origin applies when the project does not set it, merges per field, and a project value wins; tests for each. golem verify green by exit code." |
| [DUST2.23](tasks/DUST2.23.md) | "Redaction invariants: path-like tokens (§49) and a policy that cannot represent redaction-off" | agent | M | code | — | "Probe 1: a secret inside a path-like token containing `=`/`+` chunks is redacted (before: chunk disqualified it, DUST1.1 headline 9). Probe 2: a caller-built policy can no longer express `redaction: false` for a non-bypass request — a type or runtime check rejects it (before: `pipeline.ts:478`, `:603` obeyed it). golem verify green by exit code." |
| [dust3-leftovers](tasks/dust3-leftovers.md) | "Leftovers from the Dust Phase 3 comment pass and reviews: two behaviour gaps, four stale comments, one ADR numbering line, and wiki list-quote churn" | agent | M | code | — | "Behaviour items 1 and 2 have failing-first regression tests; items 3-6 are strings and comments only; item 7 is an ADR amendment note, not a rewrite; item 8 shows a no-op upsert leaves every page in docs/wiki byte-identical; golem verify exit 0." |
| [DUST4.6](tasks/DUST4.6.md) | "Exercise the golem-dust skill's parallel-partition and recount steps, and its non-Golem-layout assumptions, which the DUST4.4 dogfood did not reach" | agent | M | code | DUST4.4 | "A Phase 1 run with two sub-partitions in two worktrees produces two notes and one SUMMARY whose counts equal a mechanical recount across both tables; a second run in a scratch repo with only `golem init` run in it records which skill steps assume Golem tooling; each defect is fixed in src/cli/skills/dust.ts with tests or filed; no product code changed." |
| [DUSTSEC.21](tasks/DUSTSEC.21.md) | "Request bodies that are encoded or not JSON bypass redaction, and the redaction walk has no size bound" | agent | M | code | — | "Failing-first tests: a gzip-encoded JSON body and a BOM-prefixed JSON body are decoded, redacted, and forwarded in a form the upstream accepts (content-encoding and content-length handled correctly), or refused with a clear error, never forwarded raw; a decision recorded for non-JSON bodies (redact text bodies, or refuse when the content type is unknown and the body is large) with the case-f test updated to match; a body over a configured size limit does not stall the event loop (streamed or chunked walk, or a bounded refusal); golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change." |
| [DUSTSEC.22](tasks/DUSTSEC.22.md) | "A secret in an unbroken run longer than 128 characters is never a high-entropy sweep candidate, so it can leak whole" | agent | M | code | — | "A failing-first test with runtime-built values shows an over-length unbroken run containing a named-prefix secret, and a plain over-length random run, are redacted (or the secret inside is), through process and the redactOnly fail-safe, on the messages path and the generic JSON walker; legitimate long values that must survive (very long base64 image data, signatures, hex digests) are decided deliberately: list which are exempt and why, with tests; the DUST2.24 level<=1 recorded-shape suite passes untouched; golem verify exit 0; an independent read-only review before merge, because it is a hard-rule change." |
| [proxy-runtime-webcache-windows-flake](tasks/proxy-runtime-webcache-windows-flake.md) | "proxy-runtime webcache substitution test times out on Windows (waitFor never became true)" | agent | S | code | — | "The test passes 20 consecutive runs on windows-latest, or the cause is shown to be the test and not the code: find what the waitFor predicate waits on (an async write of the avoided-token record, a file watcher, a rename) and make that deterministic, never raise the timeout alone. golem verify exit 0." |
| [R13.17](tasks/R13.17.md) | Local `npm test` takes many minutes and pins every core — cut the wall-time floor and stop running the full suite per batch | agent | M | — | — | (a) `npm run test:changed` exists and runs only the tests reachable from the working-tree diff; (b) the slowest single test file's wall time drops materially, measured before/after on an idle machine; (c) `npx vitest run` stays green with the same test count — no test deleted, no assertion weakened. |
| [R13.9](tasks/R13.9.md) | "The gate map, made real — one policy surface for the nine places a control could sit, item 3 included and defaulted off" | agent | M | — | R13.3, R13.4 | Every gate-map item exists as a real, documented control with the default ADR-0007 §3d states, enforced at the point the map names, and visible in `golem status` / the config panel. Item 3 is off by default, cannot be enabled implicitly, requires a fresh user-factor re-authentication per answer, is loudly logged, and is overridden instantly by the kill switch — each of those five properties asserted by its own test. |
| [R8.29](tasks/R8.29.md) | Credential backends trim() strips leading whitespace from stored secrets | agent | S | — | — | A credential with intentional leading/trailing whitespace round-trips unchanged through store and get. |
| [roadmap-generator-quoted-titles](tasks/roadmap-generator-quoted-titles.md) | "The ROADMAP generator renders quoted title values with literal backslash-quotes" | agent | S | code | — | "A task doc whose title contains an escaped double quote renders in ROADMAP.md with plain quotes; a unit test fails on the old generator; golem task index --write leaves no literal backslash-quote in the index; golem verify exit 0." |
| [skill-opt-out-sticks](tasks/skill-opt-out-sticks.md) | "Deleting a Golem skill does not stick: the next `golem init` re-seeds it, because skills have no already-offered record" | agent | M | code | DUST4.2 | "Integration test: init, delete `.claude/skills/golem-<cmd>/`, init again — the skill is NOT recreated and the report says it was declined; an explicit opt-back-in recreates it. Applies to every `P0_SKILLS` entry, not one. Replaces the pin in `tests/integration/cli-init-dust-skill-lifecycle.test.ts` (`re-seeds a deleted skill`). golem verify exit 0." |
| [stale-committed-to-git-claims](tasks/stale-committed-to-git-claims.md) | "Two generated surfaces still say every wiki write is committed to git; the store only writes files" | agent | S | code | — | "Both strings say what is true (writes are files; commit them to review); the generated WIKI.md preamble and the generated research skill are regenerated from source in the same change; tests that pin either string are updated; golem verify and golem wiki check exit 0." |
| [vector-store-lock-and-outside-watch](tasks/vector-store-lock-and-outside-watch.md) | "Vector store: a narrow stale-lock break race, a heartbeat that ignores the lock owner, and outside-project --watch deleting project chunks" | agent | M | code | — | "Each defect has a regression test that fails on the current code: the heartbeat refuses to refresh a lock whose token is not its own; two processes contending for a stale lock never both write; golem index of an outside path with --watch, then editing an outside file named like a project file, leaves the project's chunks intact (outside targets use a distinct source-path namespace, for example an absolute or prefixed key); golem verify exit 0." |
| [vibe-authored-history](tasks/vibe-authored-history.md) | "Vibe seed signals 3 and 4 — code the user provably WROTE, and the voice they write prose in" | agent | S | code | vibe-personal-style | "(1) `golem vibe seed --authored <repo>` measures ONLY files with commits by the configured author, and a repo where they authored nothing produces no measurement rather than a measurement of somebody else's code. (2) A prose-voice guideline is derived from the user's own prompt text and is never quoted back verbatim — asserted by a test that feeds distinctive prompt text and checks the guideline contains the derived property, not the sentence. (3) Both remain behind the existing gate: nothing is read or written outside a Golem project." |
| [wiki-check-unlisted-pages](tasks/wiki-check-unlisted-pages.md) | "golem wiki check flags unlisted debriefs but not other unlisted pages" | agent | S | code | — | "golem wiki check reports every page under the wiki directory that WIKI.md does not list, not only debriefs; a test fails on the old checker with an unlisted concept page; the existing wiki still passes after DUST2.8 listed the six; golem verify exit 0." |
| [windows-handrolled-rename-sweep](tasks/windows-handrolled-rename-sweep.md) | "About 17 modules hand-roll a temp file plus a bare rename and still fail on Windows under contention" | agent | M | code | — | "Each module either routes through replaceViaTemp or renameWithRetry, or has a recorded reason it does not need to; a failing-first test per module family injects an EPERM-then-success rename (the helper's seam) and shows no throw; no behaviour change on non-win32; golem verify exit 0 and windows-latest CI green." |

### Blocked or waiting (visible, not lost)

| task | goal | owner | size | discipline | depends on | gate / blocker |
|---|---|---|---|---|---|---|
| [DUST2.25](tasks/DUST2.25.md) | "Fleet (P4): LAN worker reporting GPU/VRAM/load, hub capability table routing by tier, hub↔worker mTLS" | agent | L | code | — | "Needs a USER decision on whether fleet stays on the roadmap, and real multi-machine hardware for the live check." |
| [DUST5.8](tasks/DUST5.8.md) | "Publish (or not) the Phase 5 material: website, blog, changelog and any security advisory" | user | S | write | DUST5.6 | "USER decision and act: publishing, posting and any site change are outward-facing and an agent must not do them. Also decide first whether to cut a release and publish a security advisory, because no release tag (v0.54.3 was cut on 2026-09-23) contains any DUSTSEC fix." |
| [DUSTSEC.10](tasks/DUSTSEC.10.md) | "R12.12 PermissionRequest deny applies only when a relay channel is connected — verify the signal first" | agent | M | code | — | "USER decision (2026-10-08 verify step): nothing at the PermissionRequest hook reports a connected relay channel (see the dated note at the end of docs/plan/verification-notes.md). Either accept the unconditional deny and amend ADR-0002 via DUST2.3, or build a Golem-owned channel server that writes a connected marker. R12.13 is still unconfirmed." |
| [npm-claim-golem-run](tasks/npm-claim-golem-run.md) | "Claim golem-run on npm defensively — a deprecation stub pointing at @pliable/golem" | user | S | — | — | "outward, credentialed act — only the user can publish to npm" |
| [portal-success-body-replaced](tasks/portal-success-body-replaced.md) | "The portal documents a success field it does not send — `reason: \"unchanged\"` versus the `replaced` it actually returns" | user | S | docs | — | "Needs the portal side to say which shape is real — an outward, cross-repo conversation. The portal repo is at D:/Personal/Projects/Golem, not beside this one." |
| [portal-team-skills-path-drift](tasks/portal-team-skills-path-drift.md) | "The portal documents a nested team-skills path that Claude Code cannot discover — the harness ships flat, the docs say nested" | user | S | docs | — | "Outward, cross-repo: the fix belongs in a repository this task's repo does not contain, and only the user works there. Recorded here so the drift is not rediscovered a third time." |
| [R1.6](tasks/R1.6.md) | macOS / Linux Ollama setup checklist — manual verification | user | S | — | — | needs non-Windows hardware (unchanged since 2026-07-11) |
| [R12.13](tasks/R12.13.md) | "Live-confirm: does a PermissionRequest-level deny actually pre-empt a connected channel's permission relay?" | user | S | — | R12.12 | needs R12.12 shipped first, plus a genuine interactive terminal session — an agent in this repo cannot drive one (no PTY harness exists; adding one, e.g. `node-pty`, would violate CLAUDE.md's "no heavyweight native deps in default install" rule for a single one-time confirmation) |
| [R12.14](tasks/R12.14.md) | "Install the companion app on a real phone and confirm it survives losing the network" | user | S | — | R12.5 | needs a real phone on the same LAN as a machine running `golem dashboard --lan`; no test in this repo holds a device, and no PTY/emulator harness exists here (the same constraint that made R12.13 owner:user) |
| [R13.10](tasks/R13.10.md) | "Phase 2 — reach the companion app over the internet, on the blind-relay terms Decision 59 already accepted" | agent | L | — | R13.4, R13.5, R13.6 | PHASE 2 — deliberately deferred by the user (2026-08-22): "Let's plan for relaying to the internet in the future, but leave the current scope limited to lan." Starts only when the LAN path (R13.3–R13.9) is shipped and the user says go; the hosted half also needs an owner:user task for the infrastructure and its own identity/PII ADR, per Decision 59(h) |
| [R13.14](tasks/R13.14.md) | "Remove the `claude-cli` spawn provider — the subagent route supersedes it, and its traffic bypasses Golem entirely" | agent | M | — | R13.12 | needs one live confirmation that the R13.12 subagent route actually delegates — deleting a working mechanism on the strength of an unverified replacement is the wrong order. See "The one check that gates this". |
| [R13.15](tasks/R13.15.md) | "Hold a real conversation with a hosted session from a phone, and record what it looks like" | user | S | — | R13.6, R12.14 | needs a real phone on the same LAN, with Golem's device CA installed and trusted so the browser will present a client certificate; no test in this repo holds a device, and mutual TLS from a mobile browser is exactly the part that cannot be simulated here |
| [R14.2](tasks/R14.2.md) | Provision per-project Buzz agent identities for the persona bench | agent | M | code | R14.3, DUSTSEC.6 | Depends on R14.3 shipping `golem acp` first. The config-surface half of the old blocker is CLEARED — verification-notes.md §19 confirms identity provisioning (`buzz-admin generate-key`, `BUZZ_PRIVATE_KEY`, kind:13534 membership), `respond-to` as a flag/env var, and Buzz Desktop's documented tier-3 custom-harness JSON. Nothing here still needs external research. |
| [R14.3](tasks/R14.3.md) | Ship `golem acp` — Golem as its own first-class ACP runtime for Buzz | agent | M | code | — | Stage 2 only, and it is the live-environment kind of blocker, not the research kind — the ACP surface itself is CONFIRMED (verification-notes.md §19) and §20 closed the remaining infra questions. Stage 2 needs a relay (self-hosted via `just setup && just build` then `just relay`, or a one-click Railway template, or a Block-hosted community at `<name>.communities.buzz.xyz` via app.builderlab.xyz) plus a `buzz-acp` binary, and §20 item 6 confirms there are NO prebuilt CLI binaries — the latest release ships Buzz Desktop installers only, so `buzz-acp`/`buzz`/`buzz-admin` mean a Rust toolchain and `cargo build --release -p <crate>`, except `buzz-admin` which is reachable prebuilt via `docker run --entrypoint /usr/local/bin/buzz-admin ghcr.io/block/buzz:main`. Registering a minted pubkey still needs the relay's own signing key. That is an owner:user step. Stage 1 is unblocked — build and land it first. |
| [R14.4](tasks/R14.4.md) | Make Golem itself an addressable orchestrator inside Buzz | agent | L | code | R14.2, R14.3 | Depends on R14.3 (`golem acp`) and R14.2 (identities provisioned) both shipping first. No outstanding external research — verification-notes.md §19 settles the transport, the reply path and the turn-boundary constraint, and §20 closes the last two open items: the session-scope flag is `--session-policy` / `BUZZ_ACP_SESSION_POLICY`, and there is no npm client to wrap instead of shelling out to `buzz`. §20 also corrects §19 on event handling — the default cancels an in-flight turn rather than batching. |
| [R14.5](tasks/R14.5.md) | "Tier C — nested claude-agent-acp for agent-lane personas in Buzz" | user | L | code | R14.3 | USER decision needed before this can be scoped at all — what permission posture a nested Claude Code session runs under when an agent-lane persona is triggered by an unattended Buzz @mention (a chat message causing real file writes/commands with no human watching that turn). Asked 2026-09-20; explicitly deferred rather than decided ("not yet — keep tier C out of scope"). Candidates on the table: human approval in-channel before any write/execute tool call, a scoped auto-allow list (read + in-repo edits, never shell/network), or full auto-allow (the reference implementation's own default, which the research that confirmed nesting is viable flagged as a real risk, not a formality). Re-open this task's scoping once that call is made. |
| [R2.6](tasks/R2.6.md) | Live semantic-forced A/B on real traffic | agent | M | — | — | only meaningful on a non-caching upstream — needs real provider credentials (R6.1 case (a)/(b) is built but live-unverified) |
| [R5.5-scoring](tasks/R5.5-scoring.md) | Prompt-translation scoring loop — demand-gated, deliberately unbuilt | user | M | — | — | demand-gated by its own debrief — not unfinished work |
| [R6.1-live](tasks/R6.1-live.md) | Live-verify the cloud provider adapters (Anthropic-native gateways and Gemini) | user | S | — | — | needs real provider credentials |
| [R7.3](tasks/R7.3.md) | Smoke-test the Bun standalone binaries on each OS | user | S | — | — | needs Bun plus macOS and Linux hardware. (The CI billing block that also prevented running it there cleared by 2026-09-02; CI is Ubuntu-only by choice, so it still cannot cover macOS.) |
| [R7.5](tasks/R7.5.md) | First npm publish + VS Code Marketplace publish + tag | user | M | — | R7.3 | outward, credentialed act — only the user can publish |
| [R7.6-infra](tasks/R7.6-infra.md) | Stand up the golem.run host and confirm the UA-sniffing install map | user | S | — | release-portal-assets | "NEARLY CLEARED 2026-09-08 (verification-notes §162) — the UA-sniffing map is now OBSERVED against the deployed host for all three classes: `curl/8.0` → 307 → `install.sh`, `PowerShell/7.4` → 307 → `install.ps1`, and a Chrome Win64 UA → 200 serving the page. Those were `curl -A` requests, so the SNIFFING LOGIC is verified while a real browser RENDER is not — the only thing left is opening `https://golem.run` in an actual browser and confirming the page is the intended one. That is a one-minute human check, which is why this stays owner: user rather than being closed on a UA string." |
| [session-dropframe-seq-and-hostlog](tasks/session-dropframe-seq-and-hostlog.md) | "Two frozen-contract decisions DUST3.15 deliberately did not make: the dropped-subscriber frame's seq, and the unbounded host log" | user | M | code | — | "USER decision: the drop-frame seq touches a frozen interface; the host-log trim needs a design choice (lock versus rotate-by-rename, and the retention size)." |
| [test-defender-exclusions](tasks/test-defender-exclusions.md) | Measure whether Windows Defender real-time scanning is taxing the local test suite — then exclude if it is | user | S | — | — | Requires an elevated shell — `Get-MpPreference`/`Add-MpPreference` refuse to list or set exclusions as a non-admin, so an agent cannot do this. |

### Closed

| task | goal | outcome |
|---|---|---|
| [21e](tasks/21e.md) | Per-request capability/availability routing — multi-target proxy | done |
| [brevity-progress-signal](tasks/brevity-progress-signal.md) | "Silence is not brevity — carve one progress line back out of the no-narration ban" | done |
| [ccr-ref-scope](tasks/ccr-ref-scope.md) | "`expand` cannot find a ref issued minutes earlier — the CCR store is per-project-root, and a worktree is a different root" | done |
| [ci-billing-and-gate](tasks/ci-billing-and-gate.md) | GitHub Actions is billing-blocked — clear it, then reinstate the CI merge gate | done |
| [docs-slider-drift](tasks/docs-slider-drift.md) | The README still documents the slider R11.1 retired, and shows version 0.1.1 | done |
| [docs-slider-drift-remainder](tasks/docs-slider-drift-remainder.md) | Widen the retired-identifier check to the spec body, the VS Code README and the last stale strings | done |
| [DUST1.1](tasks/DUST1.1.md) | "Dust audit — redaction, security, pipeline core and proxy: classify every documented claim against the code" | done |
| [DUST1.10](tasks/DUST1.10.md) | "Dust audit — portal, team layer, Buzz and remote/hosted sessions: classify every documented claim against the code" | done |
| [DUST1.11](tasks/DUST1.11.md) | "Dust audit — cross-cutting: vision, roadmap and positioning claims, wiki index integrity, and the unowned-code sweep" | done |
| [DUST1.12](tasks/DUST1.12.md) | "Dust Phase 1 close-out — merge the eleven audit notes into one classified baseline and the Phase 2/3 input lists" | done |
| [DUST1.2](tasks/DUST1.2.md) | "Dust audit — providers, routing, gateways and credentials: classify every documented claim against the code" | done |
| [DUST1.3](tasks/DUST1.3.md) | "Dust audit — compression, CCR and brevity: classify every documented claim against the code" | done |
| [DUST1.4](tasks/DUST1.4.md) | "Dust audit — knowledge base, wiki, web cache and repo map: classify every documented claim against the code" | done |
| [DUST1.5](tasks/DUST1.5.md) | "Dust audit — MCP server and local tools: classify every documented claim against the code" | done |
| [DUST1.6](tasks/DUST1.6.md) | "Dust audit — inference, personas and local models: classify every documented claim against the code" | done |
| [DUST1.7](tasks/DUST1.7.md) | "Dust audit — hooks, guidance, snooze, autonomy, checkpoints and plan tasks: classify every documented claim against the code" | done |
| [DUST1.8](tasks/DUST1.8.md) | "Dust audit — config, init, install, release and vibe: classify every documented claim against the code" | done |
| [DUST1.9](tasks/DUST1.9.md) | "Dust audit — telemetry, status and UI surfaces: classify every documented claim against the code" | done |
| [DUST2.1](tasks/DUST2.1.md) | "Reword the CLAUDE.md hard rule: \"byte-faithful at compression ≤ 1\" → \"lossless and prefix-stable at level ≤ 1\"" | done |
| [DUST2.10](tasks/DUST2.10.md) | "Code-owned claims: tool descriptions, doc comments and CLI/dashboard labels that drifted" | done |
| [DUST2.2](tasks/DUST2.2.md) | "Rebaseline docs/golem-spec.md from the verified state — decisions, contracts and ADR references" | done |
| [DUST2.24](tasks/DUST2.24.md) | "Contract suites for frozen session interfaces and recorded-shape tests for lossless/prefix-stable level ≤ 1" | done |
| [DUST2.26](tasks/DUST2.26.md) | "Dust Phase 2 close-out — merge the rebaseline branches, regenerate the index, SHIPPED row, debrief" | done |
| [DUST2.3](tasks/DUST2.3.md) | "ADR amendment notes for the drifted ADRs (0001–0008) and the 2026-10-08 decisions" | done |
| [DUST2.4](tasks/DUST2.4.md) | "Wiki rebaseline: proxy, redaction and compression pages" | done |
| [DUST2.5](tasks/DUST2.5.md) | "Wiki rebaseline: knowledge base, web cache, distillation and tool pages" | done |
| [DUST2.6](tasks/DUST2.6.md) | "Wiki rebaseline: configuration, team, portal, device auth and release pages" | done |
| [DUST2.7](tasks/DUST2.7.md) | "Wiki rebaseline: hosted sessions, transport, Buzz, personas, hooks, snooze and vibe pages" | done |
| [DUST2.8](tasks/DUST2.8.md) | "Wiki rebaseline: syntheses/sources drift and the WIKI.md index" | done |
| [DUST2.9](tasks/DUST2.9.md) | "README, CLAUDE.md drift and plan/index hygiene (XS sizes, quoted titles, stale task docs, ROADMAP prose)" | done |
| [DUST3.1](tasks/DUST3.1.md) | "Dead code (proxy, providers): delete the unreferenced context guard/monitor, resolveModel and ResolvedTarget.contextSize" | done |
| [DUST3.10](tasks/DUST3.10.md) | "Inference roles and tool accounting: ollama setup pulls every live role, persona-sourced routes are labelled as such, bench drops the retired `level` cases and adds `code`, snooze and coder errors are instrumented" | done |
| [DUST3.11](tasks/DUST3.11.md) | "Tasks, spawn gate and delegation ledger: escalated tasks are not re-run locally, the gate honours resetAtIso, ledger writes do not lose updates, `review --waive` needs an id" | done |
| [DUST3.12](tasks/DUST3.12.md) | "Telemetry store correctness: no rollup splice across rotation, no lost event on a partial line, no literal NUL bytes in source, fold the `all` window once" | done |
| [DUST3.13](tasks/DUST3.13.md) | "Watch and dashboard CLI: live stats source, respect NO_COLOR and non-TTY, true footer cadence, no overlapping frames, CCR size from the worktree root" | done |
| [DUST3.14](tasks/DUST3.14.md) | "Portal and team sync honesty: init reports the real team outcome, `team sync` works unlinked, only 402/403 stamp not-entitled, the api_error notice says what is true" | done |
| [DUST3.15](tasks/DUST3.15.md) | "Session transport and host log: SSE drop frame keeps the cursor, idempotency reserves the id before awaiting, the host log is trimmed, `session forget` rejects a path-escaping id" | done |
| [DUST3.16](tasks/DUST3.16.md) | "Buzz ACP: cancel with no turn in flight must not silence the next turn; provisioning must not orphan minted identities or name a nonexistent `--rotate`" | done |
| [DUST3.17](tasks/DUST3.17.md) | "`vibe confirm` refuses a rejected key; release.mjs bumps package-lock.json with the other versions" | done |
| [DUST3.18](tasks/DUST3.18.md) | "Stale comments and strings that contradict the rebaselined spec: slider-era wording, retired command names, wrong defaults and dead cross-references (strings and comments only)" | done |
| [DUST3.2](tasks/DUST3.2.md) | "Dead code (config, tui, cli): delete coerceLevel, DIM, _levelFallbackName, the slider-0 confirm branch and an orphaned doc comment; table the public leftovers for the user" | done |
| [DUST3.3](tasks/DUST3.3.md) | "Pipeline redaction correctness: re-redact after in-place plugin mutation, make connection-password idempotent, refuse zero-length plugin rules, bound plugin problems, log the held stage" | done |
| [DUST3.4](tasks/DUST3.4.md) | "Status honesty and proxy process control: never hide redaction-off, report bypass in `proxy status`, make select-target restart properly, stop advertising a dashboard `ps` never finds" | done |
| [DUST3.5](tasks/DUST3.5.md) | "Credentials reach the proxy and stay out of routes: auto-start must load gateway keys, gateway ids must not collide on one env name, the Gemini key leaves ProxyRoute" | done |
| [DUST3.6](tasks/DUST3.6.md) | "Gateway CLI papercuts: reject `--store fiel`, read piped login on `add --login`, report keychain faults on `forget`, stop truncating model ids silently, reject `model[262k]`" | done |
| [DUST3.7](tasks/DUST3.7.md) | "Vector store integrity: no cross-process lost updates, stale vectors dropped, sub-path index keeps the manifest, no duplicate files, getChunk opens its collection" | done |
| [DUST3.8](tasks/DUST3.8.md) | "Wiki write path and KB lifecycle: redact and instrument wiki_upsert, normalise .md, key distill drafts by source, quote-aware frontmatter lists, close watchers, keep graph-first search when the KB build fails, reject invented rerank ids" | done |
| [DUST3.9](tasks/DUST3.9.md) | "Compression accounting and hook config: honour read_skeleton_enabled on the fast path, accept Headroom `router`, count only stored CCR refs" | done |
| [DUST4.1](tasks/DUST4.1.md) | "Write the /golem-dust skill: audit, rebaseline and refactor as one distributable SKILL.md, registered in P0_SKILLS" | done |
| [DUST4.2](tasks/DUST4.2.md) | "Install /golem-dust through the existing skill lifecycle, seeded by default, and pin it with init, re-init, edit, retire and uninit tests" | done |
| [DUST4.3](tasks/DUST4.3.md) | "Document the Dust method: wiki concept page, debrief template in the skill, README line and a spec 5.1 mention" | done |
| [DUST4.4](tasks/DUST4.4.md) | "Dogfood /golem-dust Phase 1 on a small slice by an agent that has only the skill, and record what the skill got wrong" | done |
| [DUST4.5](tasks/DUST4.5.md) | "Close Dust Phase 4: SHIPPED row, debrief, PLAN.md status, follow-ups filed" | done |
| [DUST5.1](tasks/DUST5.1.md) | "Keep draft marketing prose out of local answers: exclude docs/marketing/ from local-answer sources" | done |
| [DUST5.2](tasks/DUST5.2.md) | "Build the marketing claims ledger and banned-claims list that every Phase 5 draft must cite" | done |
| [DUST5.3](tasks/DUST5.3.md) | "Draft the feature overview from the claims ledger" | done |
| [DUST5.4](tasks/DUST5.4.md) | "Draft the v0.54.x changelog narrative, with the DUSTSEC security fixes stated honestly as unreleased" | done |
| [DUST5.5](tasks/DUST5.5.md) | "Draft a short blog post about the Dust method: what it found, what review caught, and what the skill packages" | done |
| [DUST5.6](tasks/DUST5.6.md) | "Independent read-only fact-check of every Phase 5 draft against the code" | done |
| [DUST5.7](tasks/DUST5.7.md) | "Close Dust Phase 5: SHIPPED row, debrief, PLAN.md status" | done |
| [DUSTSEC.1](tasks/DUSTSEC.1.md) | "Proxy pipeline error: redact-then-forward, fail closed (5xx) if redaction throws — never forward raw" | done |
| [DUSTSEC.11](tasks/DUSTSEC.11.md) | "owner: user binds the worker lane — workerTargetFromPersona refuses owner:user" | done |
| [DUSTSEC.12](tasks/DUSTSEC.12.md) | "Shim runs no compression (D56(c)) — SHIM_POLICY stops being policyFor(1)" | done |
| [DUSTSEC.13](tasks/DUSTSEC.13.md) | "inference.worker_targets is live — take it off RETIRED_SETTINGS, fix the test comment, document it" | done |
| [DUSTSEC.14](tasks/DUSTSEC.14.md) | "An invalid team value warns and skips the team layer; the proxy still starts (ADR-0008)" | done |
| [DUSTSEC.15](tasks/DUSTSEC.15.md) | "An unknown default_target always fails closed — single-target included (behaviour change)" | done |
| [DUSTSEC.16](tasks/DUSTSEC.16.md) | "Canonical npm name is @pliable/golem — move every consumer off golem-run" | done |
| [DUSTSEC.17](tasks/DUSTSEC.17.md) | "Follow-ups from the independent review of DUSTSEC.1-16: portal refresh origin, Buzz keygen fallback, bypass-guard gaps, owner:user explicit target, acp plugin rules" | done |
| [DUSTSEC.18](tasks/DUSTSEC.18.md) | "Second-review follow-ups to DUSTSEC.17: local-layer portal link, token POST redirects, bypass-guard gaps and heredoc false deny, classifier quoting, keygen false refusal" | done |
| [DUSTSEC.19](tasks/DUSTSEC.19.md) | "Redact every JSON request body, not only POST /v1/messages" | done |
| [DUSTSEC.2](tasks/DUSTSEC.2.md) | "Remove the redaction-off side doors: POST /__golem/pipeline/false and the x-golem-bypass header" | done |
| [DUSTSEC.20](tasks/DUSTSEC.20.md) | "The redaction walker rewrites 33 and 34 character API ids (server tool, batch and container ids), and the API rejects the placeholder" | done |
| [DUSTSEC.3](tasks/DUSTSEC.3.md) | "PreToolUse denies agent Bash that runs `golem off` or sets `bypass_all`; skill says exactly what is enforced" | done |
| [DUSTSEC.4](tasks/DUSTSEC.4.md) | "Bind the portal access token to its issuer origin — https only, never sent or re-sent to another host" | done |
| [DUSTSEC.5](tasks/DUSTSEC.5.md) | "Autonomy classifier: newline-chained commands are never `read`; fix the destructive over-approvals" | done |
| [DUSTSEC.6](tasks/DUSTSEC.6.md) | "Buzz keygen parser: drop the `g` flag on HEX64_RE so the secret key can never be written as the pubkey" | done |
| [DUSTSEC.7](tasks/DUSTSEC.7.md) | "Stop exporting the mutable REDACTION_RULES — freeze it or hand out a copy" | done |
| [DUSTSEC.8](tasks/DUSTSEC.8.md) | "Plugin redaction rules apply on every redaction path — hook, vibe and join-queue as well as proxy and MCP" | done |
| [DUSTSEC.9](tasks/DUSTSEC.9.md) | "Redact vibe sources.json and candidates.jsonl before write" | done |
| [file-watcher-debounce-determinism](tasks/file-watcher-debounce-determinism.md) | "The debounce test races the poll loop — a burst of writes can straddle the window and emit two batches" | done |
| [file-watcher-settle-is-a-guess](tasks/file-watcher-settle-is-a-guess.md) | "The debounce test still flakes — `settle()` counts event-loop turns as a proxy for fs I/O finishing, and one missed poll stalls the whole chain" | done |
| [golem-ps-and-idle-daemons](tasks/golem-ps-and-idle-daemons.md) | "`golem ps` — Golem accounts for its own processes, and stops leaving idle ones behind" | done |
| [guidance-new-default-never-seeds](tasks/guidance-new-default-never-seeds.md) | "A guidance rule added after a project's first `golem init` is never seeded there — the sentinel cannot tell 'disabled' from 'did not exist yet'" | done |
| [hook-precedence](tasks/hook-precedence.md) | Assert PreToolUse precedence between a rewriting hook and a denying hook (§91, still open) | done |
| [local-models](tasks/local-models.md) | golem devices reports the tier CATALOG, not what Ollama has actually pulled | done |
| [long-run-visibility](tasks/long-run-visibility.md) | "A long run must show that it is running — `golem verify`, a live status-line segment, and the rule that says stream it" | done |
| [main-branch-enforcement](tasks/main-branch-enforcement.md) | "`main` is protected by convention only — GitHub refuses both protection APIs on a private repo" | done |
| [npm-token-set-but-broken](tasks/npm-token-set-but-broken.md) | "`NPM_TOKEN` is set but does not work — so every release attempts a publish and goes red after succeeding" | done |
| [P3a](tasks/P3a.md) | CLAUDE.md compaction actuator — the write half of R6.4's leanness check | done |
| [P3b](tasks/P3b.md) | Point golem bench tools at caveman-shrink rather than rebuilding it | done |
| [parallel-agent-isolation](tasks/parallel-agent-isolation.md) | "Parallel agents need their own worktree — file ownership does not stop a shared HEAD, a shared node_modules, or a deleted dirty tree" | done |
| [portal-release-webhook](tasks/portal-release-webhook.md) | "The portal end of the release webhook — OIDC on both sides; now needs one repo variable and a release" | done |
| [project-team-binding](tasks/project-team-binding.md) | "A team-connected project names its team in its committed config — and a team that cannot be reached never stops the proxy" | done |
| [R10.1](tasks/R10.1.md) | First-pancake rewrite — take release 1's proven recipe, scrap its throwaway scaffolding, and shape the codebase for the first REAL release | done |
| [R10.10](tasks/R10.10.md) | The VS Code status bar flaps online/offline — four full CLI startups per poll against an 8s timeout | done |
| [R10.11](tasks/R10.11.md) | `vscode-extension/render.test.js` is run by nothing, and had rotted for four releases | done |
| [R10.12](tasks/R10.12.md) | Decision 56's bypass shim is gone — `proxy stop` again leaves Claude Code wired to a dead port | done |
| [R10.13](tasks/R10.13.md) | `golem status` reports a rebuilt-but-not-restarted daemon as current — staleness is version-only | done |
| [R10.14](tasks/R10.14.md) | OpenAI translation smuggles images into `tool_result` as base64 text — make it vision-aware | done |
| [R10.15](tasks/R10.15.md) | `/v1/messages/count_tokens` is unhandled on a translating upstream — it returns a chat completion | done |
| [R10.16](tasks/R10.16.md) | Translated SSE sends nothing until the first token — no eager `message_start`, no `ping` | done |
| [R10.17](tasks/R10.17.md) | The CCR oversized-output swap has never once fired for `Read` — its text is nested at `file.content` | done |
| [R10.18](tasks/R10.18.md) | An empty upstream completion is manufactured into a valid empty answer — surface it as an error | done |
| [R10.19](tasks/R10.19.md) | headroom_config keys are validated only when Headroom runs — on a caching upstream they are silently dropped after all | done |
| [R10.2](tasks/R10.2.md) | `npm test` is intermittently red on a clean tree — per-test temp-tree deletes starve each other at 20s | done |
| [R10.20](tasks/R10.20.md) | Thinking blocks are synthesized on the way out and discarded on the way back — the round trip is asymmetric | done |
| [R10.21](tasks/R10.21.md) | Golem's Claude Code wiring belongs in .claude/settings.local.json, and `golem config set` belongs in the local scope | done |
| [R10.22](tasks/R10.22.md) | Seeded guidance rules were three times longer than they needed to be, in every session's context | done |
| [R10.23](tasks/R10.23.md) | A translated stream drops the upstream's error frame and its reasoning trace — and the pipeline can hold a live request unbounded | done |
| [R10.24](tasks/R10.24.md) | The two status lines disagree with each other, the model picker cannot pick a model, and "off" wears the same face as "running" | done |
| [R10.3](tasks/R10.3.md) | Headroom sidecars outlive the proxy that spawned them — 24 orphaned Python processes over five days | done |
| [R10.4](tasks/R10.4.md) | A hardware-tier downgrade silently swaps the embedder, and every local-answer query then fails on vector width | done |
| [R10.5](tasks/R10.5.md) | The MEMORY sidecar is never copied to dist/, so it cannot launch from a built install | done |
| [R10.6](tasks/R10.6.md) | The knowledge BUILD side still picks its embedder by detected tier | done |
| [R10.7](tasks/R10.7.md) | Tier P_MIN pairs a 1024-dim text embedder with a 768-dim code embedder in ONE collection | done |
| [R10.8](tasks/R10.8.md) | `coder` falls through to the LOCAL model when no target is named — it should fall through to inference.default_target, then the harness default | done |
| [R10.9](tasks/R10.9.md) | A loopback `local`-trust target is dispatched to the Ollama service, whatever it actually points at | done |
| [R11.1](tasks/R11.1.md) | Retire the slider — compression and brevity become the only dials, and level 0's redaction bypass gets a home of its own | done |
| [R11.2](tasks/R11.2.md) | Bound what the session-start index sync may spend — a cap, a checkpoint, and one collection per project | done |
| [R11.3](tasks/R11.3.md) | "`golem off` is in-process only — it silently reverts at the next proxy restart" | done |
| [R11.4](tasks/R11.4.md) | Clear R11.1's leftovers — the strings, the dead branch, and the skill `golem init` promised to prune | done |
| [R11.5](tasks/R11.5.md) | The wiki Index fell 39 debriefs behind — index them, and make the drift impossible | done |
| [R11.6](tasks/R11.6.md) | One format for every model on the status line, and `+` between them | done |
| [R11.7](tasks/R11.7.md) | A request that dies mid-stream leaves no trace — the proxy log has no timestamps and no outcomes | done |
| [R11.8](tasks/R11.8.md) | The two status lines disagree about a dial at zero — show `✂ off` on both | done |
| [R12.1](tasks/R12.1.md) | "ADR-0006 — the threat model for remote steering: write it, then decide whether the companion app gets built" | done |
| [R12.10](tasks/R12.10.md) | "Capability 3, reopened by the client: decide whether Golem becomes a Claude Code channel, and whether a phone may enqueue a task" | cancelled |
| [R12.11](tasks/R12.11.md) | Spike — Golem as a channel, measured against building the transport ourselves | done |
| [R12.12](tasks/R12.12.md) | "Close the channel-relay gap R12.11 found — enforce destructive/outward at PermissionRequest, not PreToolUse's ask" | done |
| [R12.2](tasks/R12.2.md) | "The blocked-state file says the session is stuck but not on what — widen it into a documented read model, with no network surface" | done |
| [R12.3](tasks/R12.3.md) | "Remote approval as an INPUT to the autonomy gate — a bounded wait, an exact match, and a timeout that denies" | cancelled |
| [R12.4](tasks/R12.4.md) | "mTLS device pairing over the LAN — Golem is already a CA, so make it issue client certificates and honour revocation" | cancelled |
| [R12.5](tasks/R12.5.md) | "The companion app — a phone-shaped, read-only view of the locally-hosted dashboard, installable (observe tier only)" | done |
| [R12.6](tasks/R12.6.md) | "Spike — how does the phone learn the agent is blocked, without putting a third party in the path? (expect a constrained answer)" | done |
| [R12.7](tasks/R12.7.md) | Continue is not approve — decide what a phone can honestly resume, given that no reverse channel into the TUI exists | done |
| [R12.8](tasks/R12.8.md) | The relay — an end-to-end-encrypted rendezvous, both client halves, and a reference server anyone can self-host | cancelled |
| [R12.9](tasks/R12.9.md) | Operate a public relay and the accounts that gate it — Golem's first hosted service | cancelled |
| [R13.1](tasks/R13.1.md) | "Spike — can the `claude` CLI be driven as a hosted, multi-turn session? Measure it before ADR-0007 §3a is built on" | done |
| [R13.11](tasks/R13.11.md) | "`coder` 401s on the harness default and cannot iterate — `inherit` auth is a proxy concept, and a dispatch carried one prompt" | done |
| [R13.12](tasks/R13.12.md) | "`default_coder` selects a MODEL and Golem generates the subagent — delegate through the harness, retire the spawned CLI" | done |
| [R13.13](tasks/R13.13.md) | "Two target-surface lines that state the opposite of the truth — `key MISSING` on a keyless provider, and `model IGNORED` on a spawn provider" | done |
| [R13.2](tasks/R13.2.md) | "The conversation store — persist redacted transcripts locally, bounded, forgettable, and never in git" | done |
| [R13.3](tasks/R13.3.md) | "The session host — Golem spawns and supervises an agent session through its own proxy, and can refuse outright" | done |
| [R13.4](tasks/R13.4.md) | "Device and user authentication — revive mTLS for the device, add a user factor, make both revocable" | done |
| [R13.5](tasks/R13.5.md) | "The transport — stream a hosted session to a device over SSE, take messages by POST, and never show stale state as live" | done |
| [R13.6](tasks/R13.6.md) | "The chat surface — a phone-shaped conversation view with a send box, honest about which session it is talking to" | done |
| [R13.7](tasks/R13.7.md) | "Join a live session — deliver a device's message as an injected block on the conversation's next request, visibly" | done |
| [R13.8](tasks/R13.8.md) | "Start and continue from the device — pick a project, open a new conversation, or resume one and read what was said" | done |
| [R6.3](tasks/R6.3.md) | Remote steering / companion app — threat-model ADR first, then decide | done |
| [R8.11](tasks/R8.11.md) | Plugin surface — third-party pipeline stages, MCP tools and redaction rules without forking | done |
| [R8.13](tasks/R8.13.md) | Fix the cache-prefix verdict — it is wrong ~98% of the time (§99 problem 2) | done |
| [R8.14](tasks/R8.14.md) | golem ext install/upgrade — the write half of the managed-tool registry | done |
| [R8.15](tasks/R8.15.md) | golem local disable writes to the wrong scope and gets silently shadowed | done |
| [R8.16](tasks/R8.16.md) | LocalDirBlobStore.put destructive rename race on concurrent writes | done |
| [R8.17](tasks/R8.17.md) | MCP expand tool rethrows non-UnknownRefError, can crash process | done |
| [R8.18](tasks/R8.18.md) | OpenAIChatSSETranslator unbounded SSE buffer can grow memory without limit | done |
| [R8.19](tasks/R8.19.md) | sniffRequestModel regex false-matches nested model keys | done |
| [R8.20](tasks/R8.20.md) | Ollama pull headersTimeout default too tight | done |
| [R8.21](tasks/R8.21.md) | Autonomy classify false-positives when danger patterns appear inside quoted strings | done |
| [R8.22](tasks/R8.22.md) | CcrStore.putIfAbsent TOCTOU race on concurrent writes | done |
| [R8.23](tasks/R8.23.md) | Messages path regex unanchored — matches /v1/messages anywhere in URL | done |
| [R8.24](tasks/R8.24.md) | Base32-encoded secrets not detected by high-entropy redaction | done |
| [R8.25](tasks/R8.25.md) | Cache-prefix lookback prediction returns binary verdict without expressing uncertainty | done |
| [R8.26](tasks/R8.26.md) | Context-substitution KnownContentLookup prefix-stability contract undocumented | done |
| [R8.27](tasks/R8.27.md) | program.ts at 3,617 lines — split into per-command-group modules | done |
| [R8.28](tasks/R8.28.md) | mcp/server.ts at 2,209 lines — split into domain modules | done |
| [R8.30](tasks/R8.30.md) | Headroom sidecar worker-respawn has no backoff, startup timeout hides stderr | done |
| [R8.31](tasks/R8.31.md) | Proxy stop must not leave Claude Code wired to a dead port — bypass shim + explicit unwire | done |
| [R8.32](tasks/R8.32.md) | Report the unwired-but-running proxy — every status surface must cross-check wiring against the listener | done |
| [R8.33](tasks/R8.33.md) | Level 0 becomes CLI-only — a tool call must not be able to switch redaction off | done |
| [R8.5](tasks/R8.5.md) | Repo map — tree-sitter symbols → graph rank → budgeted skeleton, and the oversized-Read swap | done |
| [R8.6](tasks/R8.6.md) | LSP bridge — diagnostics / definition / references / hover as a tier-2 spawn target | done |
| [R8.7](tasks/R8.7.md) | Local editor model — validated search/replace diff edits (harness-gated, may be rejected) | done |
| [R8.8](tasks/R8.8.md) | Model catalog — price and context limits as Golem's own cached data | done |
| [R8.9](tasks/R8.9.md) | Change ledger — opt-in checkpoint / revert via shadow git refs | done |
| [R8.M1](tasks/R8.M1.md) | Upstream-switch UI defects — stale status URL, dead setting toggles, 3s quick-pick | done |
| [R8.S2](tasks/R8.S2.md) | Spike — system-prompt slimming (expect NO; measure, then decline) | done |
| [R8.S3](tasks/R8.S3.md) | Spike — session tree: record the conversation as a tree, view it, do not actuate | done |
| [R9.1](tasks/R9.1.md) | Target registry — one table for every local and upstream model | done |
| [R9.10](tasks/R9.10.md) | the local-coder naming is wrong — workers route to any target, and every surface still says local | done |
| [R9.11](tasks/R9.11.md) | tools vs skills — state the layering rule and stop the surface from sprawling | done |
| [R9.12](tasks/R9.12.md) | green WebFetch by default — stub-at-loopback plus additionalContext, with deny-and-serve as the floor | done |
| [R9.13](tasks/R9.13.md) | a project that upgrades Golem fixes its own settings files | done |
| [R9.14](tasks/R9.14.md) | the MCP server could not authenticate to any target — coder's remote dispatch was dead | done |
| [R9.15](tasks/R9.15.md) | coder drafts on the subscription by spawning the official client, not by borrowing its token | done |
| [R9.16](tasks/R9.16.md) | the deployed VS Code extension goes stale in silence — refresh it, and say so | done |
| [R9.17](tasks/R9.17.md) | the coder-first gate denies EVERY code write — concurrent sessions overwrite its single-slot one-shot | done |
| [R9.18](tasks/R9.18.md) | `golem proxy restart` reports "did not come up" for a proxy that is running | done |
| [R9.19](tasks/R9.19.md) | the reachability latch R9.12 designed and did not build — stop a cloud/Desktop session rewriting into a TLS error | done |
| [R9.2](tasks/R9.2.md) | Proxy serves many targets — pool registry + virtual model ids | done |
| [R9.20](tasks/R9.20.md) | credential resolution spawns one PowerShell per stored account — 6.7s in front of every proxy start | done |
| [R9.21](tasks/R9.21.md) | a large page silently double-fetches — the pre hook's 15s timeout kills the serve mid-flight | done |
| [R9.22](tasks/R9.22.md) | `golem init` writes a machine-absolute CA path into the COMMITTED .claude/settings.json | done |
| [R9.23](tasks/R9.23.md) | CCR dedup elides TOOL-SCHEMA responses — under snooze enforcement that is a deadlock | done |
| [R9.3](tasks/R9.3.md) | coder runs on any target — with redaction before every non-local dispatch | done |
| [R9.4](tasks/R9.4.md) | Status surfaces name models by ROLE, and workers get their own targets | done |
| [R9.5](tasks/R9.5.md) | Managed-file refresh — skills overwrite hand-edits, guidance never updates at all | done |
| [R9.6](tasks/R9.6.md) | Config migrations — a renamed setting silently stops working | done |
| [R9.7](tasks/R9.7.md) | A Golem-served WebFetch renders as a FAILED tool call | done |
| [R9.8](tasks/R9.8.md) | headroom_config cannot reach nested Headroom config — lossless_only and the CCR markers are unreachable | done |
| [R9.9](tasks/R9.9.md) | golem config set cannot write an object-valued setting | done |
| [redaction-path-uuid](tasks/redaction-path-uuid.md) | An absolute path containing a UUID is redacted as a secret, so scratchpad and worktree paths cannot be used as command arguments | done |
| [release-portal-assets](tasks/release-portal-assets.md) | "The release must carry install.sh, install.ps1 and config-schema.json — every portal path redirects to assets that do not exist" | done |
| [release-pr-needs-approval](tasks/release-pr-needs-approval.md) | "The release PR cannot go green on its own — a bot-opened PR does not trigger CI, so every release stalls at `action_required`" | done |
| [settings-cascade-importance](tasks/settings-cascade-importance.md) | "Two bands in the resolver — any origin may declare `!important`, and importance reverses origin order" | done |
| [skill-provenance-on-clone](tasks/skill-provenance-on-clone.md) | "A cloned project can never refresh its Golem skills — the provenance record is gitignored, so every teammate sees a permanent conflict" | done |
| [skills-project-scope-reachability](tasks/skills-project-scope-reachability.md) | "Project-scoped `/golem:*` skills may be unreachable — and a user-scope plugin is currently masking it on one machine" | done |
| [snooze-taskadd](tasks/snooze-taskadd.md) | Snooze enforcement denies the `golem task add` its own guidance rule asks for first | done |
| [subagent-park](tasks/subagent-park.md) | A subagent cannot park — it dies at the usage limit while the parent session is protected | done |
| [team-layer-fetch](tasks/team-layer-fetch.md) | "Fill the `team` origin — fetch the org's settings, cache them per org to `~/.golem/teams/<org_id>.json`, and let a lost network keep policy" | done |
| [team-portal-auth](tasks/team-portal-auth.md) | "Sign in to the portal from the CLI — authorization code + PKCE over a loopback redirect, tokens in the OS keychain" | done |
| [team-settings-layer](tasks/team-settings-layer.md) | "The team settings layer — one remote source that lands in the precedence ladder TWICE, cached so a lost network keeps policy" | done |
| [team-skills-sync](tasks/team-skills-sync.md) | "Team skills sync into their own managed namespace — and a skill deleted in the portal disappears locally" | done |
| [test-timing-flakes](tasks/test-timing-flakes.md) | "Two suite tests fail on load, not on logic — FIXED; four more exist and are NOT the same bug" | done |
| [vibe-personal-style](tasks/vibe-personal-style.md) | "`vibe` — a personal style reference guide Golem learns, gated to Golem projects, consulted by coder/scribe/reviewer" | done |

<!-- golem:task-index:end -->

---

## Deferred / not scheduled

The **hosted workspace/org knowledge tier** (WS-F5's upper tiers — P4+, candidate paid)
remains the only work off the roadmap entirely. It has no task file on purpose.

Also deliberately out of scope for R8 and beyond (memo `proposals/r8-context-economy.md`):
TUI / desktop / IDE agent clients · sub-agent orchestration · plan mode · session
sharing and gists · themes and keybinds · a competing edit-apply harness · a curated
model marketplace · **rebuilding RTK's Bash filters**. Golem's scope discipline is its
differentiator — all four projects reviewed in that memo compete to *be* the harness,
and Golem is the only one that sits under one and can see the actual bytes.

## Where the rest of the planning context lives

| document | what it holds |
|---|---|
| [`tasks/`](tasks/) | one committed task document per open item — the actionable layer |
| [`SHIPPED.md`](SHIPPED.md) | one line per landed release/task, linking its debrief |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | workstreams, frozen interfaces, the WS-F ↔ ROADMAP crosswalk (§6) |
| [`BACKLOG.md`](BACKLOG.md) | ideas inbox — pre-task, one line per idea |
| [`proposals/`](proposals/) | design memos (R6 multi-provider, R8 context economy, brevity, snooze, webfetch cache) |
| [`verification-notes.md`](verification-notes.md) | dated live-doc findings and measurements, numbered §1 onward (latest §167 at 2026-10-08) |
| `../golem-spec.md` | architecture + the authoritative Decisions Log |
| `../decisions/` | ADRs (threat models), stricter human-driven rule |
| `../wiki/debriefs/` | dated per-batch retrospectives |
