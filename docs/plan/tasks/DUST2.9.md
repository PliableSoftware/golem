---
task: DUST2.9
title: "README, CLAUDE.md drift and plan/index hygiene (XS sizes, quoted titles, stale task docs, ROADMAP prose)"
state: queued
owner: agent
size: M
discipline: docs
design: "SUMMARY.md drift groups 'CLAUDE.md' and 'README.md' (:340-351); hygiene (:747-779); Gaps 1.7/r025, 1.11/r075; DECISIONS.md A11, H3, H4, M6"
gate: "README and CLAUDE.md rows below fixed; R8.23/R8.25/R8.26/R8.29 parse (size S) and appear in ROADMAP after `golem task index --write`; each 'done doc whose gate the code no longer meets' and each 'queued doc already shipped' carries a dated note (state changed only where the evidence is unambiguous); ROADMAP.md hand-written prose corrected; golem wiki check green by exit code."
depends_on: [DUST2.1, DUSTSEC.16]
touches: [README.md, CLAUDE.md, docs/plan/tasks, docs/plan/ROADMAP.md]
created: 2026-10-08
---

## README / CLAUDE.md

- README 1.7/r032 (frontmatter table vs parser), 1.11/r079 ("`/golem/*` skills", "one local
  process", "opt-in" local answer → ON by default, A11 default rule). 1.11/r080 is DUSTSEC.16's.
- CLAUDE.md 1.11/r077 "Source of truth"; M6/1.11/r075: the MCP tool list covers 6 of 11 tools —
  list all, or say it is a subset. 1.1/r096, r097: confirm the redaction/`bypass_all` lines match
  ADR-0004 after DUSTSEC.2 (removed side doors). Do NOT touch the C1 line (DUST2.1) or the npm
  name (DUSTSEC.16).

## Plan hygiene (SUMMARY :760-775)

1. **H3 (default rule):** R8.23, R8.25, R8.26, R8.29 use `size: XS`, which `PLAN_TASK_SIZES`
   rejects, so `PlanTaskStore.list()` drops them silently (R8.29 is an open bug). Change to `S`.
2. 65 docs quote `title:` and ROADMAP renders literal quotes (DUST1.7 row 26): check the
   current generator first — if it still renders quotes, record it in the PR as a code bug; do
   not mass-edit 65 files to hide it.
3. Done docs whose gate the code no longer meets (npm-token-set-but-broken, R8.33, R13.12, R9.4,
   R10.8, R13.11, portal-release-webhook, main-branch-enforcement,
   R11.4/docs-slider-drift-remainder, skill-provenance-on-clone): append a dated "Dust 2026-10-08:
   gate no longer met because …" note. Do not reopen them.
4. Queued docs already (partly) shipped (R6.3, R14.3 stage 1, R13.17, R14.2, R13.8, R7.3,
   R7.6-infra): dated note with evidence; close R6.3 only if its close rule is met.
   R13.14's "blocker cleared" cites the wrong §148 — fix the citation. R12.13: its R12.12
   prerequisite is shipped, but the live confirmation is still open (keep it queued).
5. **H4 (default rule):** R14.2–R14.5 and R5.1 each mean two things. Do not rename (ids are never
   reused); add an alias note to each task doc naming the other meaning and where it appears
   (SHIPPED.md, code comments).
6. ROADMAP.md prose: "137 done" header, "Where we are (validated 2026-07-30)" billing block,
   "§1–§100". Fix only the hand-written prose OUTSIDE the generated markers.

## Out of scope

- H2 (`blocked` state vs metadata) — open, USER.
- The spec header (DUST2.2).

## Verification bar

`golem task index --write` leaves ROADMAP clean; `golem wiki check` green by exit code. Commit on your own branch.
