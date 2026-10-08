---
task: DUST5.4
title: "Draft the v0.54.x changelog narrative, with the DUSTSEC security fixes stated honestly as unreleased"
state: queued
owner: agent
size: M
discipline: write
design: "git tags v0.54.0 (b949fd3, 2026-09-07) and v0.54.3 (1719982, 2026-09-23); docs/plan/SHIPPED.md; the DUSTSEC task docs and the DUSTSEC debrief 2026-10-08-DUSTSEC-security-batch.md; Dust Phase 1 debrief (the HIGH items); docs/marketing/CLAIMS.md."
gate: "docs/marketing/changelog-v0.54.md exists, marked DRAFT; each entry names its commit or PR and the tag that contains it (from `git tag --contains`); the security section lists every DUSTSEC fix with what was wrong, who could reach it, and its status, and states which released versions are affected; every claim is in CLAIMS.md; no banned claim; no redaction placeholder."
depends_on: [DUST5.2]
touches: [docs/marketing]
created: 2026-10-08
---

## What this is

A changelog-style story of the v0.54 line and the security work that followed it.

## The fact the draft must be built around (verified 2026-10-08)

**No release tag contains any DUSTSEC commit.** The remote has tags `v0.54.0` and `v0.54.3` only (no `v0.54.1` or `v0.54.2` tag, although the Phase 1 debrief records `@pliable/golem@0.54.2` on npm). `v0.54.3` was cut on 2026-09-23; the DUSTSEC fix commits (for example `9065c85`, DUSTSEC.18) are on `development` only. So:

- Released versions up to and including v0.54.3 contain the defects that DUSTSEC fixed. Say so.
- The fixes go under an "Unreleased (on development)" heading, never under a v0.54.x heading.
- Re-run `git tag --contains <commit>` for every fix at writing time; a release may have been cut since this brief.
- Reconcile the missing 0.54.1/0.54.2 tags with `package.json` history and `SHIPPED.md`. A read-only `npm view @pliable/golem versions` is allowed; record the date. If it cannot be reconciled, say so in the draft rather than guess.

## Honest security writing

For each fix: what was wrong in plain words, what an attacker or accident needed to reach it (for example "a hostile repository committed `team.portal_url`"), severity as the audit rated it, and the fix. Do not soften the HIGH items (unauthenticated redaction-off endpoint, pipeline fail-open, portal token sent to a committed URL, newline-chained Bash auto-allowed, the package rename). Do not add detail beyond what is needed to judge exposure: no step-by-step reproduction. DUSTSEC.10 is open; say it is open, not what it will do.

Whether and how to publish a security advisory, and whether to cut a release first, is a USER decision (DUST5.8), not something this draft implies.

## Out of scope

- Cutting a release or editing `RELEASING.md`.
- A security advisory, CVE request or GitHub Security Advisory.
- Versions before v0.54.0.
