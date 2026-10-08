---
title: "Dust Phase 3: the refactor pass, 63 bugs and 12 deletions, and what independent review caught"
type: debrief
tags: [dust, dust3, refactor, security, redaction, review, dead-code]
sources: [docs/plan/audit/dust-1/SUMMARY.md, docs/plan/audit/dust-1/PHASE3-INDEX.md, docs/plan/tasks/DUST3.3.md]
created: 2026-10-08
updated: 2026-10-08
---

# Dust Phase 3: the refactor pass

Closes DUST3.1-DUST3.18 (PRs #242-#256). The audit is [[Dust Phase 1 — eleven audits, one baseline]], the rebaselined spec it was judged against is described in the Phase 2 debrief `2026-10-08-DUST2-rebaseline.md`, and the redaction rule most of the risk sat on is in [[Redaction Stage]].

## Outcome

- A planner re-verified every audit item against the current code first. 52 items did not reproduce (most were already fixed by the DUSTSEC batch or the Phase 2 pass). What remained became 18 task docs: 63 confirmed bugs, 12 safe deletions, 25 proposals needing a user decision, and a comment pass.
- Merged: the safe dead-code deletions (whole `context-guard` and `context-monitor` files, `resolveModel`, `coerceLevel`, `asFederatedSearch`, `windowedStats`, and others, each with a grep proof re-run before deleting); fixes in redaction and pipeline, status (including S12: `bypass_all` is now loud in `golem proxy status`), daemon credentials and gateways, inference targets, tasks and hooks, telemetry (literal NUL bytes removed from two source files), watch, team and portal, session transport, the vector store, and the wiki write path; and a comment and string pass over 80 files.
- Test count rose from 4296 to 4464 with no test deleted except those of deleted symbols.
- NOT done, by design: the 25 NEEDS-USER dead-code proposals (public config, CLI, MCP, plugin and interface surface) and one item the agent refused, a slider-0 branch in `src/tui/state.ts` that four tests pin.

## What independent review caught

Every hard-rule branch went through a read-only reviewer before merge, and several twice. The agents' own tests and verify runs passed in every case below, so this is the headline lesson.

- **Redaction (DUST3.3):** the first version let any placeholder-shaped password through unredacted (arbitrary text could ride in the placeholder's kind) and refused plugin rules that had worked before. Both fixed; the second also deviates from the task brief, because redaction outranks the brief.
- **Credentials (DUST3.5/6):** a regression that made every credential removal throw on a headless Linux machine, and a pre-existing leak: with no Gemini key stored, the client's Anthropic credential was forwarded to Google.
- **Hooks (DUST3.11):** `golem task review` rewrote the delegation ledger without the new lock, so a concurrent spawn's record could be erased and `golem task done` would close without review, bypassing the review gate. Plus a stale-lock race.
- **Session (DUST3.15):** two changes were reverted rather than fixed, because they touch a frozen contract or can lose audit lines (see the follow-ups).
- **Wiki (DUST3.8):** a draft slug and an explicit `rel_path` were stored raw into the committed wiki, and `promote` applied only built-in rules. The fix then refused 5 existing wiki pages until a second review caught it.
- **Vector store (DUST3.7):** a transient read error wiped the whole store, a lock race let two writers in, and an outside-project index target would have deleted the vectors it had just ingested. A second review found that a torn `meta.json` wedged every write.

## Lessons

- Agents' green tests prove the new test passes, not that nothing else got weaker. Review the hard-rule branches, and budget for a second round: three of the fix rounds introduced a new defect.
- A heuristic guard (the 32-character slug rule) needs a test that walks every existing real input, or it will refuse legitimate ones.
- Parallelism has a memory cost: eight agents running verify at once got typechecks killed (exit 137), so their own "before" baselines were unreliable. Re-run verify serially before merging.
- A no-behaviour-change pass needs machine evidence. The comment pass was held to comments and strings and checked by transpiling base and new with comments stripped and string contents masked.
- Merging by CI gate needs the gate for the pushed head, not a stale one.
- Three Windows-only flakes surfaced during the batch (a device-sessions rename, a webcache test, a typecheck OOM).

## Follow-ups filed

`vector-store-lock-and-outside-watch`, `session-dropframe-seq-and-hostlog` (user decision), `proxy-runtime-webcache-windows-flake`, `dust3-leftovers`. Phases 4 and 5 are not started.

## Sources

- `docs/plan/audit/dust-1/SUMMARY.md`, `docs/plan/audit/dust-1/PHASE3-INDEX.md`
- PRs #242-#256
