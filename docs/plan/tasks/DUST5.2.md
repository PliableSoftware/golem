---
task: DUST5.2
title: "Build the marketing claims ledger and banned-claims list that every Phase 5 draft must cite"
state: done
owner: agent
size: M
discipline: write
design: "docs/golem-spec.md v1.33, sections 10 (open contradictions), 11 (rebaseline notes, including UNVERIFIED) and 12 (gap register); docs/plan/audit/dust-1/DECISIONS.md; the DUSTSEC debrief 2026-10-08-DUSTSEC-security-batch.md."
gate: "docs/marketing/README.md says DRAFT, not published, not a source of truth, and points at the ledger; docs/marketing/CLAIMS.md has a claims table (id, claim, source as spec section or path:line, checked-against-code date and commit, status) and a BANNED section covering every item listed below; every row's path:line was opened and read at the recorded commit; no redaction placeholder (the proxy's bracketed REDACTED marker) anywhere under docs/marketing/."
depends_on: [DUST5.1]
touches: [docs/marketing]
created: 2026-10-08
updated: 2026-10-08T23:21:55.660Z
---

## What this is

The backbone of Phase 5. The drafts (DUST5.3-DUST5.5) may only make claims that are rows in this ledger. A claim that is not in the ledger is not in a draft.

## Claims table

Each row: a short id (`C-nn`), the claim in one sentence as it may appear in copy, its source (a spec section AND a `path:line` in code, or a test file for behaviour), the commit it was checked at, and a status: `verified`, `estimated` (numbers that the product itself labels estimated, T2), or `dated` (true as of a date, such as a test count). Read the code at each cited line; a spec citation alone is not enough, because the spec itself has UNVERIFIED items.

Seed it from spec sections 1-5 and the shipped rows in `docs/plan/SHIPPED.md`. Aim for the claims a feature overview needs, not every decision.

## Banned claims (must all appear, with the reason)

From the open contradictions (spec section 10), assert NEITHER answer:
- **G3**: that team policy is enforced everywhere. Only `golem status` loads the team layer.
- **M2**: that the `slider` MCP prompt is gone, or that it is supported.
- **H2**: whether `blocked` is a task state or metadata.
- **P3**: that Decision 61 covers hosted sessions.
- **P4/S17**: that `security.*` settings cannot be changed remotely.
- **DUST2.25**: a LAN worker fleet, a hub capability table, or hub-to-worker mTLS.
- **DUSTSEC.10 / R8**: anything about how the permission-request deny behaves with a relay connected.

From spec section 11, UNVERIFIED: `snooze` being instrumented; LM Studio or vLLM as drop-in backends; a tier-fallback ladder or Haiku fallback; a Bun standalone binary; the shim bypassing local answer; which call sites use a catalog role.

From section 12 and section 5: per-device utilization, a canary quality-delta view, `golem replay-eval`; cache hit rate or cost on the dashboard (they are on `golem stats --cache` and `golem bench cost`).

Retired or false wording: "byte-faithful" (now "lossless and prefix-stable at level <= 1", C1); "redaction can never be turned off" (it can, only via the CLI-only, persisted, loudly surfaced `bypass_all`; say that); the `x-golem-bypass` header and `POST /__golem/pipeline/false` as features (removed); "slider" as a current control; `golem-run` as the install name (canonical `@pliable/golem`, check `package.json`).

Overstatement: compression token savings on Anthropic traffic (Decision 23, near 0%; savings there come from prompt caching); any savings figure not labelled estimated; "audited", "certified" or "independently reviewed" for the Dust reviews (they were read-only agent reviews inside this project); "no known vulnerabilities"; any claim that a DUSTSEC fix is in a released version unless DUST5.4 shows a tag containing it.

## Out of scope

- Writing the drafts themselves.
- Deciding any open item, or arguing for one.
- Editing the spec or wiki. A spec claim that turns out wrong goes into a follow-up task doc, not a quiet fix.

## Outcome

shipped; see the Phase 4 and 5 debrief
