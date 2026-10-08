# Dust Phase 1 contradictions: decisions record

**Date: 2026-10-08. Decided by: USER.** One place for Phase 2 (`DUST2.*`) and the out-of-band
security tasks (`DUSTSEC.*`) to cite. Item ids (R1, C1, A1, …, X1–X12) are the ones in
[`SUMMARY.md` → Contradictions for the human](SUMMARY.md#contradictions-for-the-human).

Do not re-open, weaken or reinterpret a USER decision below. A task that finds code evidence
against one stops and reports it; it does not pick a different answer.

## USER decisions (verbatim, 2026-10-08)

| id | decision | carried by |
|---|---|---|
| R1/S3 | On any pipeline error the proxy REDACTS THEN FORWARDS (re-run redaction alone on the original body); if redaction itself throws, FAIL CLOSED with 5xx. Rewrite the test at `tests/integration/pipeline-proxy.test.ts:191` that pins raw fail-open. Cover the unguarded throw sites named in SUMMARY S3. | DUSTSEC.1 |
| R2 | REMOVE the per-request `x-golem-bypass` header; fix the `golem-bypass` skill to point at `bypass_all`. | DUSTSEC.2 |
| R3/S2 | REMOVE `POST /__golem/pipeline/false` (`src/proxy/server.ts:206-211`). Redaction-off exists only as `bypass_all` (persisted, CLI-only, surfaced loudly). | DUSTSEC.2 |
| R4 | A PreToolUse hook DENIES agent Bash that runs `golem off` or sets `bypass_all`; reword the skill to say exactly what is enforced. | DUSTSEC.3 |
| R5 | Stop exporting the mutable `REDACTION_RULES` (freeze or export a copy); reword ADR-0005 "structurally" to "cannot via the API; a plugin has process authority anyway". | DUSTSEC.7 (code), DUST2.3 (ADR) |
| R6 | Plugin redaction rules apply on EVERY redaction path (hook, vibe, join-queue as well as proxy and MCP); amend ADR-0005 to name all paths. | DUSTSEC.8 (code), DUST2.3 (ADR) |
| R7 | Widen redaction to vibe `sources.json` and `candidates.jsonl`. | DUSTSEC.9 |
| R8 | The R12.12 hard deny at `PermissionRequest` applies ONLY when a relay channel is connected. First task step: VERIFY a "relay connected" signal exists at that hook; R12.13 (does the deny pre-empt the relay) is still unconfirmed, so record that in the task. | DUSTSEC.10, DUST2.3 (ADR-0002) |
| R9 | `owner: user` BINDS the worker lane: `workerTargetFromPersona` must refuse owner:user tasks. | DUSTSEC.11 |
| R10 | Amend ADR-0003 invariant 4 to "keys never enter model context or tool output"; model-chosen `coder` target stays (Decisions 27/35). | DUST2.3 |
| R11 | Keep `??=` (explicit parent value wins); reword D47 "configures nothing" to defaults only. | DUST2.2 |
| R12 | The "no tool call can change pipeline depth" rule binds model/MCP tool calls; a human write of `compression.level` via panel/remote is allowed. Reword. Redaction stays untouchable from every surface. | DUST2.2, DUST2.3, DUST2.4 |
| C1 | REWORD the hard rule (CLAUDE.md) and all docs from "byte-faithful at compression <= 1" to "lossless and prefix-stable at level <= 1". USER approved editing that hard rule. Recorded-shape tests keep guarding it. The CLAUDE.md edit is its own tiny task. | DUST2.1 (CLAUDE.md), DUST2.2/2.4 (docs), DUST2.10 (code comments) |
| C2 | Shim code follows D56(c): no compression (change `SHIM_POLICY = policyFor(1)`). | DUSTSEC.12 |
| A4 | Scope the non-goal: "no cloud-hosted proxy or data path; the hosted team portal is a separate control plane (D64)". | DUST2.2 |
| G1 | `inference.worker_targets` is LIVE: remove from `RETIRED_SETTINGS`, fix the test comment that says it warns, document it. | DUSTSEC.13 |
| G2 | Code follows ADR-0008: an invalid team value logs a warning and the team layer is skipped; the proxy still starts. | DUSTSEC.14 |
| P5/S4 | BIND the portal token to its issuer origin: send only to the issuing host, require https, never re-send a refreshed token to a different host. Covers `binding.ts:131-135`, `client.ts:118-126,159-165,187-193`, `config.ts:46-70`. | DUSTSEC.4 |
| V2 | An unknown `default_target` ALWAYS fails closed, single-target included (behaviour change). | DUSTSEC.15 |
| A1/S1 | Canonical npm name is `@pliable/golem`. Agent task: update `golem update` (`src/update/index.ts:22`, `status-update.ts:83`), installers (`install/install.sh`, `install/install.ps1`), `package-lock.json`, `ps` detection (`src/cli/commands/ps.ts`), VS Code extension id prefix (`init-vscode.ts:194`), README, CLAUDE.md, spec D16/D19/D41 + §2.1/§6, the Release Pipeline wiki page, the R7.5 gate. The user claims `golem-run` themselves. | DUSTSEC.16, `npm-claim-golem-run` (owner: user) |
| H1 | No decision; the snooze defaults flip is already in code and tests. DOC task only: `docs/wiki/concepts/Usage Limit Park.md:33` (still says default true) plus a superseding note on spec D45. | DUST2.7 (wiki), DUST2.2 (D45) |
| S5 | (No contradiction; a confirmed HIGH defect.) Fix out-of-band before Phase 3. | DUSTSEC.5 |
| S6 | (No contradiction.) Fix the Buzz keygen parser; R14.2 cannot ship without it. | DUSTSEC.6 |

## Default rule for everything else

**DOC FOLLOWS SHIPPED CODE, unless the item touches security, a hard rule, or a recorded USER
decision.** Each application below is marked in its task doc so the user can overturn it. Where
the rule is NOT applied (exception), the item is left open and named here.

| id | outcome | task |
|---|---|---|
| C3 | Default rule applied: document the CCR swap as dial-independent (it fires at `off`) | DUST2.4 |
| C4 | Default rule applied: narrow "everything lossy is reversible" to the stages that are; name Headroom stale-turn drops as unmarked | DUST2.4, DUST2.2 |
| C5 | Default rule applied: level-2 note states the sidecar requirement as level 3 does | DUST2.4 |
| C6 | Default rule applied: document the static Headroom-config check as it behaves; the false warning stays a Phase 3 bug | DUST2.4 |
| A2 | Default rule applied: "one engine" means logically; docs say two processes (daemon + `mcp serve`) | DUST2.2, DUST2.4 |
| A3 | Default rule applied: §1 identity follows Decision 32 (universal pre-LLM processor, Claude Code flagship) | DUST2.2 |
| A5 | Default rule applied: record that R6 shipped and D36's hold is superseded | DUST2.2 |
| A6 | Default rule applied: §5 rewritten to what ships; per-device utilization, canary quality-delta and `replay-eval` move to the not-started register (no task) | DUST2.2 |
| A7 | Default rule applied: D50(a)/(b)/(c) and D51(d) marked superseded by ADR-0004 | DUST2.2 |
| A8 | Default rule applied: amend D51(f) to record that the aliases still ship | DUST2.2 |
| A9 | Default rule applied: tier thresholds follow code (`<8 / 8–16 / >16` GiB) | DUST2.2 |
| A10 | Default rule applied: narrow the `golem ollama setup` promise to what it pulls | DUST2.2 |
| A11 | Default rule applied (flagged: Decision 7's "never a global default" may be a recorded decision): local answer is ON by default, as code and the distributed rule say | DUST2.2, DUST2.4, DUST2.9 |
| A12 | Default rule applied: D33 source set is "any markdown outside `docs/plan/`" | DUST2.2 |
| G3 | **Exception (security, S18): NOT applied.** Where enforced team policy must apply is left for the user / Phase 3 | — |
| G4 | Default rule applied: document the shipped duplicate runtime/setting rows | DUST2.6 |
| G5 | Default rule applied (flagged: D58(f) is a recorded decision for the CLI only): panel default write scope is `project` | DUST2.6 |
| V1 | Default rule applied: document that `gateway use` refuses keyless gateways and `list` shows `key MISSING` | DUST2.2 |
| V3 | Default rule applied: drop the model-name gateway selection claim from the `resolveDefaultTargetId` doc | DUST2.10 |
| M1 | Default rule applied: `coder` `outputSchema` widened to the keys the result already carries | DUST2.10 |
| M2 | **Exception (frozen contract): NOT applied.** Keep-or-remove of the `slider` prompt is left for the user | — |
| M3 | Default rule applied: `wiki_upsert` description says it writes files, not commits | DUST2.10 |
| M4 | Default rule applied: Decision 34 status recorded as shipped, default-off | DUST2.2 |
| M5 | Default rule applied: date-stamp the Tool Search figures and state the live count | DUST2.5 |
| M6 | Default rule applied: CLAUDE.md tool list marked as a subset, or lists all 11 | DUST2.9 |
| M7 | Default rule applied: Managed Tools states 6 deps and the caret range | DUST2.5 |
| K1 | Default rule applied: a superseding ADR records the polling watcher | DUST2.3 |
| K2 | Default rule applied: docs say the user page wins under graph-first search | DUST2.5 |
| K3 | Default rule applied: D29 and pages describe the bare `---` separator | DUST2.2, DUST2.5 |
| K4 | Default rule applied: retire "Qdrant server fully supported via config URL" | DUST2.2 |
| K5 | Default rule applied: Web Cache page records the green path as shipped (R9.12/R9.19) | DUST2.5 |
| K6 | Default rule applied: Wiki-First and Distillation drop the plan-gate (D44/D54); promote keeps its shipped TTY consent | DUST2.5 |
| K7 | Default rule applied: Web Cache freshness describes revalidation-gated `max-age`/`Expires` | DUST2.5 |
| K8 | Default rule applied: §3.1 rewritten to the wiki-primary design of Decision 28 | DUST2.2 |
| H2 | **Exception (recorded decision D55(d)): NOT applied.** State-vs-metadata for `blocked` left for the user | — |
| H3 | Default rule applied: the four `size: XS` docs become `size: S` | DUST2.9 |
| H4 | Default rule applied: no id is renamed (ids are never reused); alias notes added | DUST2.9 |
| P1 | Default rule applied: ADR-0007 amendment records that `host.ts` follows §3a | DUST2.3 |
| P2 | Default rule applied: ADR-0007 amendment maps the code's "invariant 8" to the ADR's numbering | DUST2.3 |
| P3 | **Exception (security, remote permission answering): NOT applied.** Left for the user | — |
| P4/S17 | **Exception (security): NOT applied.** Left for the user / Phase 3 | — |
| P6 | Default rule applied: document both policies as shipped | DUST2.6 |
| P7 | Default rule applied: ADR-0006 amendment notes for §2/§3a/§4/§7/§8 | DUST2.3 |
| T1 | Default rule applied: labels say "rewritten requests" | DUST2.10 |
| T2 | Default rule applied: savings figures labelled "estimated" | DUST2.10 |
| X1 | Default rule applied: D (two processes); see A2 | DUST2.2 |
| X2 | Superseded by USER decision G1 | DUSTSEC.13 |
| X3 | Default rule applied: the nested skills-layout claim is superseded (X) | DUST2.2 |
| X4 | Default rule applied: P (head/tail swap is partial coverage) | DUST2.2 |
| X5 | Default rule applied: D (macOS advisory is the shipped design) | DUST2.6 |
| X6 | Default rule applied: M as an optional add-on | DUST2.2 |
| X7 | Default rule applied: device-surface mTLS ships; hub↔worker mTLS is N | DUST2.25 |
| X8 | Default rule applied: P (`SHA256SUMS`, `.tgz` not asserted) | DUST2.21 |
| X9 | Default rule applied: D (live mechanism, docs updated) | DUST2.6 |
| X10 | Default rule applied: D (stable-id rename `runtime:slider` → `runtime:compression` documented) | DUST2.6 |
| X11 | Default rule applied: D (wiki file locations fixed) | DUST2.6 |
| X12 | Default rule applied: adapter-plus-pin is the shipped shape | DUST2.2 |
