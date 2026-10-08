---
task: DUST2.2
title: "Rebaseline docs/golem-spec.md from the verified state — decisions, contracts and ADR references"
state: queued
owner: agent
size: L
discipline: write
design: "docs/plan/audit/dust-1/PLAN.md Phase 2; SUMMARY.md 'Phase 2 inputs' (Gaps :180-292, spec drift groups :383-575, hygiene :747-779); DECISIONS.md; docs/decisions/ADR-0001..0008"
gate: "docs/golem-spec.md is rewritten so that every spec drift row in SUMMARY.md:383-575 is either fixed or explicitly superseded with a dated note; every gap row is in the spec as shipped, partial (with its task id) or in a 'Not started' register; every DECISIONS.md item routed to DUST2.2 is applied and marked; header version/date matches the log; no ADR body is copied in (ADRs referenced by id). A reviewer can trace each change to a SUMMARY row ref. golem wiki check green by exit code."
depends_on: [DUST2.1, DUSTSEC.16]
touches: [docs/golem-spec.md]
created: 2026-10-08
---

## What this is

Reverse-engineer a new `docs/golem-spec.md` from the Phase 1 verified state. It stays a SPEC:
architecture, decisions and contracts, citing ADRs by id. The ADR log lives in `docs/decisions/`
and is not reproduced. Code is ground truth (DEFAULT RULE: doc follows shipped code) except
where DECISIONS.md says otherwise.

## Inputs, in reading order

1. `docs/plan/audit/dust-1/DECISIONS.md` — binding. Items routed here: R11, R12, A4, H1 (D45
   superseding note), C1 (wording), C4, A2, A3, A5–A12, V1, M4, K3, K4, K8, X1, X3, X4, X6, X12.
2. SUMMARY.md spec drift groups (`:383-575`): Decisions 18, 19, 20/21/32/36, 22, 26–29, 33, 34,
   37–43, 45–51, 53, 55, 56, 64 and §1, §2, §3, §5, §6, §7, §9. Open the DUST1.x note for a row's
   file:line evidence only when the row text is not enough.
3. SUMMARY.md Gaps (`:180-292`). For each P/N row: if a DUST2.11–DUST2.25 task covers it, cite the
   task id; if not, list it in a **"Not started (no task)"** register with its row ref — these are
   the aspirational claims (G05 SDK, G06/G07 caches, G13 media, G14 digest, 20g translation, WASM
   and declarative plugin rules, eval harness, canary, Qdrant server, shared collection,
   Classifier/Router, Extractor, llama.cpp/vLLM, git-aware context, Batch-API queueing, hub
   capability table, per-device utilization, canary quality-delta, `replay-eval`).
4. Hygiene (`:776-779`): header v1.17 / 2026-07-16 vs log v1.32 / Decision 64; the `:8` naming note.

## Key rewordings (from DECISIONS.md, apply verbatim in meaning)

- C1: "byte-faithful at compression ≤ 1" → "lossless and prefix-stable at level ≤ 1" everywhere,
  incl. §4 and D22 ("the Anthropic path stays byte-faithful" → state what the code does).
- R12: "no tool call can change pipeline depth" binds model/MCP tool calls; a human write of
  `compression.level` via panel/remote is allowed. Redaction stays untouchable from every surface.
- R11: D47 "exporting configures nothing" → defaults only; `??=` (explicit parent value wins) stays.
- A4: non-goal → "no cloud-hosted proxy or data path; the hosted team portal is a separate control
  plane (D64)".
- H1: D45 gets a superseding note: `snooze.enforce` and `snooze.spawn_gate` default **false**
  (USER, 2026-09-25; `src/config/schema.ts:1197-1198`).
- The four renames that cause most drift (SUMMARY :298-305): slider → two dials (ADR-0004);
  `account` → `gateway` (R9.23); D27/D35 MCP tool names; `golem-run` → `@pliable/golem`
  (already done by DUSTSEC.16 — keep it).

## Structure

Keep decision numbers stable (other docs cite "Decision 33"). A superseded decision keeps its
number with a one-line superseded note pointing at its successor/ADR. Mark each DEFAULT-RULE choice
inline (e.g. `<!-- dust2: default rule, DECISIONS.md A9 -->` or a visible "(doc follows code,
2026-10-08)") so the user can overturn it.

## Out of scope

- ADR edits (DUST2.3). Wiki pages (DUST2.4–2.8). Code.
- Items DECISIONS.md marks as exceptions (G3, M2, H2, P3, P4): describe current behaviour neutrally
  and say "open — left for the user"; do not decide them.
- Writing Phase 3+ task docs.

## Verification bar

`golem wiki check` green by exit code. Commit early and often on your own branch (this is long).
