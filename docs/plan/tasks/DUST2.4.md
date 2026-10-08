---
task: DUST2.4
title: "Wiki rebaseline: proxy, redaction and compression pages"
state: queued
owner: agent
size: M
discipline: write
design: "SUMMARY.md drift groups 'wiki: Architecture / Cache Observability / Compression / Context Ledger / Conversation Store / Plugin Seams / Redaction Path Placeholders / Redaction Stage' (:580-622, :671-694); DECISIONS.md C1, C3–C6, R2–R6, R12, A2, A11"
gate: "Every SUMMARY drift row listed below is fixed on its page with the code file:line the row's DUST1.x note cites; 'byte-faithful' no longer describes level ≤ 1 on any page here; default-rule choices are marked; golem wiki check green by exit code."
depends_on: [DUST2.1]
touches: [docs/wiki/concepts]
created: 2026-10-08
---

## What this is

Bring the proxy/redaction/compression wiki pages in line with code. Evidence for each row is in the
named DUST1.x note (look the row up by its ref, e.g. `1.1/r005` = DUST1.1 row 5).

## Rows

| page | rows (SUMMARY ref) | notes |
|---|---|---|
| `concepts/Redaction Stage.md` | 1.1/r001, r005, r006, r007, r008 **HR** | r007 idempotence: say what is true today (S10 `connection-password` re-match is a known Phase 3 bug — name it, do not claim idempotence) |
| `concepts/Redaction Path Placeholders.md` | 1.1/r020 **HR** | |
| `concepts/Plugin Seams.md` | 1.1/r041 | plus R5/R6 wording (plugin rules on every path, "cannot via the API") |
| `concepts/Compression.md` | 1.3/r002 **HR**, r003 | C1 wording; C4 narrow "everything lossy is reversible"; C5 sidecar note at level 2 |
| `concepts/Compression Levels.md` | C1 wording | C3: CCR swap is dial-independent (fires at `off`) |
| `concepts/Cache Observability.md` | 1.3/r027 | |
| `concepts/Context Ledger.md` | 1.9/r059, r061 | |
| `concepts/Conversation Store.md` | 1.10/r032 | |
| `concepts/Architecture.md` | 1.11/r051, r052 **HR**, r053, r057 | A2 two processes; A11 local answer ON by default (flag as default rule); `golem account use` → `golem gateway use` |

Also apply: R2/R3 (the endpoint and header are removed — if a page documents them, describe
the decided state as "removed by DUSTSEC.2" until that lands), R12 scope, C6 (describe the
Headroom-config check as it behaves).

## Out of scope

- Knowledge/config/session pages (DUST2.5–2.7), syntheses and WIKI.md index (DUST2.8).
- Fixing any code bug the page reveals — note it in the PR, do not file Phase 3 tasks.

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.
