# DUST1.7 — hooks, guidance, snooze, autonomy, checkpoints, plan tasks

Dust Phase 1 audit, read-only. Evidence is `file:line` at `fd3aedc` (branch
`dust/DUST1.7`) unless marked **[main-wt]**, which means the uncommitted working
tree of the main checkout `D:\Personal\Repos\Golem` on 2026-09-25 (the USER
decision flipping `snooze.enforce` / `snooze.spawn_gate` to default `false`
exists ONLY there: `src/config/schema.ts`, `src/hooks/guidance.ts`, and the two
regenerated rules — not committed to `development`). Status: **COMPLETE**.

## Bucket counts

| class | count |
|---|---|
| shipped-and-matches | 12 |
| shipped-but-drifted | 21 |
| partial | 2 |
| not-started | 1 |
| dead-or-superseded | 4 |
| **total rows** | **40** |

## Findings table

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 1 | `snooze.enforce` default | spec D45 (`golem-spec.md:486` "**default true**"); wiki `Usage Limit Park.md:33` "default **true**" | `src/config/schema.ts:1185` `enforce: true` at `fd3aedc`; **[main-wt]** `enforce: false` + JSDoc "Default false (USER decision, changed 2026-09-25)" | `tests/integration/cli-status.test.ts:711-713,716-723` pin **true** ("enforce defaults on") | shipped-but-drifted | Docs match committed code but NOT the 2026-09-25 USER decision. Once the flip lands, spec D45 + wiki are wrong AND `cli-status.test.ts:716-723` goes red. Code side ([main-wt]) looks right per USER; spec/wiki/test lag. | none |
| 2 | `snooze.spawn_gate` default | wiki `Spawn Headroom Gate.md:79` table `true`; rule `golem-subagent-headroom.md` | `schema.ts:1186` `spawn_gate: true` at `fd3aedc`; **[main-wt]** `false` | no test pins the default (grep `spawn_gate` in tests: only render tests at `cli-status.test.ts:810-822` with explicit input) | shipped-but-drifted | Wiki still says `true`. Spec has **no mention of `spawn_gate` at all** (grep `golem-spec.md` = 0) — the gate itself is undocumented in the spec. | none |
| 3 | Park enforce/advisory wording in code | `pre-tool-use.ts:65-66` comment "default true"; `src/mcp/snooze-note.ts:5` "Decision 45 made snooze enforcement the default" | same | — | shipped-but-drifted | Stale once flip lands; neither file is in the [main-wt] diff. `ui-model.ts:642-657` labels are neutral (fine). | none |
| 4 | Park mechanism: 0.9 threshold, fresh-only enforce, stale warn-once, exempt set | wiki `Usage Limit Park.md:25-45`; spec D45 | `snooze-nudge.ts:36` `DEFAULT_NUDGE_UTILIZATION = 0.9`; `:99-107` stale one-shot per `observedAtIso`; `:112-113`; `pre-tool-use.ts:127-131` `PARK_EXEMPT_TOOLS` | `tests/unit/hooks/snooze-nudge.test.ts`, `pre-tool-use.test.ts:181-225` | shipped-and-matches | Wiki correct. Spec D45 says "every non-`snooze` tool call is denied" — code also exempts `ToolSearch` + `mcp__golem__expand` (R9.23); spec wording lags. | none |
| 5 | D38 limit-state file name | spec D38 (`:470`) `.golem/state/limit.json` | `src/proxy/limit-prediction.ts:129` writes `limit-state.json` | — | shipped-but-drifted | Spec name wrong; code looks right. | none |
| 6 | D38 park instruction | spec D38 "document where you're up to (`golem task add`), then snooze" | park instruction routes to `snooze` `note` (rule `golem-snooze-hold.md`; `snooze-nudge.ts` deny text) | `snooze-nudge.test.ts` | shipped-but-drifted | Spec describes the pre-`note` flow the rule now forbids ("Do NOT try `golem task add` first"). | none |
| 7 | D38 on-by-default wiring | spec D38 "init wires `golem hook pre-tool-use` and seeds `snooze-hold`" | `src/cli/init-hooks.ts:229`; guidance registry seeds `snooze-hold` | `tests/integration/cli-init-wiring.test.ts` | shipped-and-matches | | — |
| 8 | Spawn headroom gate logic | wiki `Spawn Headroom Gate.md` | `src/hooks/spawn-gate.ts`; `pre-tool-use.ts:279` | `tests/unit/hooks/spawn-gate.test.ts` | shipped-but-drifted | Wiki does not mention: gate ignores a passed `resetAtIso` (`spawn-gate.ts:168-172`, whereas `snooze-nudge.ts:113` checks it); `spawn-gate`/`delegation-ledger` read-modify-write is racy under parallel fan-out. | none |
| 9 | D37 auto-resume removal | spec D37 | `src/proxy/limit-detector.ts`, `limit-capture.ts` absent; `onUsageLimit` only in a comment (`src/proxy/types.ts:212`); `limit_autoresume` grep = 0 | — | shipped-and-matches | | — |
| 10 | DURABLE_TASKS guidance snippet | D37 | `guidance.ts:165` "it survives restarts and can auto-resume" | — | shipped-but-drifted | Contradicts D37 (auto-resume dropped). Snippet is opt-in (not seeded), so low blast radius. | none |
| 11 | D39 coder-first key/rule name | spec D39 `local-coder`, `.claude/rules/golem-local-coder.md`, `guidanceEnabled(projectDir,"local-coder")` | registry key `coder-first` (`guidance.ts:351`); gate checks `coder-first` (`pre-tool-use.ts:345`) | `tests/unit/hooks/coder-first-nudge.test.ts` | shipped-but-drifted | Renamed; spec not updated. Also extensions TS/JS only (`coder-first-nudge.ts:31`) vs D39 "code files". | none |
| 12 | D39 gate ordering | spec D39 "snooze first, then coder-first, then autonomy" | `pre-tool-use.ts:228` park → `:279` spawn gate (+delegation ledger) → `:342` coder-first → `:395` autonomy | `pre-tool-use.test.ts` | shipped-but-drifted | Spawn gate inserted later; D39 ordering is 3-stage. | none |
| 13 | D40 autonomy `enabled` flag, fail-closed, enable/disable | spec D40; ADR-0002 header note (`ADR-0002:18-28`) | `src/autonomy/policy.ts:58-89` (missing/invalid → manual + enabled); `src/cli/commands/autonomy.ts:74,90`; `pre-tool-use.ts:395-400` | `tests/unit/autonomy/gate.test.ts`, `classify.test.ts` | shipped-and-matches | | — |
| 14 | D40 "corrected the misleading init comment" | spec D40 | `src/cli/init-hooks.ts:227-228` still: "autonomy gate (inert at the default `manual` level)" | — | shipped-but-drifted | The exact misleading claim D40 says was fixed survives in init-hooks. Stale comment. | none |
| 15 | ADR-0002 levels + matrix + invalid→manual | ADR-0002 `:54-94,112-114` | `policy.ts:18-22,77-81`; `gate.ts` `decideGate` | `tests/unit/autonomy/gate.test.ts` | shipped-and-matches | | — |
| 16 | ADR-0002 audit log | ADR-0002 `:119-121` | `src/autonomy/log.ts` (`autonomy-log.jsonl`); `pre-tool-use.ts:407-414` | none found (no `log` test under `tests/unit/autonomy/`); direct read only | shipped-and-matches | Untested. | — |
| 17 | ADR-0002 destructive/outward → `ask` (human) | ADR-0002 `:86-94` matrix "**ask**", `:116-118` | `PermissionRequest` returns hard `deny` for both classes whenever gate enabled (`gate.ts:81-86`, `permission-request.ts:87-101`); wired by default (`init-hooks.ts:233`) | `tests/unit/hooks/permission-request.test.ts` | shipped-but-drifted | ADR still says "ask → human"; wiki `Autonomy Gate.md:35-57` documents the R12.12 deny. Consequence nobody states: in a default-init project the human is never offered the dialog for `git push`/`gh pr`/`rm -rf` — it is denied. See Contradictions. | none |
| 18 | ADR-0002 read MCP set incl. `level` | ADR-0002 `:73` "search/fetch/stats/expand/level" | `classify.ts:23-32` (level removed, R11.1 note `:216-221`) | `classify.test.ts` | dead-or-superseded | ADR text superseded by ADR-0004. | none |
| 19 | ADR-0002 "misclassification only escalates; unknown never auto-allowed" | ADR-0002 `:69-71,105-111` | `SHELL_COMPOSITION_RE = /[;&\|>\`]\|\$\(/` (`classify.ts:107`) has no `\n`/`\r`; `^ls(\s\|$)` matches `ls\n<anything>` | probed: `"ls\nnode -e …rmSync…"` → `read` → `assisted` emits `allow`; `classify.test.ts` has 0 newline cases | shipped-but-drifted | **Defect** against the ADR invariant. Also over-approves: `git branch -D main`, `npx biome check --write .`, `git diff --output=<path>` → `read` (probed). | none |
| 20 | Autonomy Gate wiki (two hooks, shapes, fail-safe) | wiki `Autonomy Gate.md:20-80` | `pre-tool-use.ts`; `permission-request.ts:73-110` | as above | shipped-and-matches | | — |
| 21 | Blocked read model: v2, kinds, non-block types, staleness, pending-tool correlation, 2 000-char cap, fail-closed redaction | wiki `Blocked State Read Model.md` | `session-state.ts:98,146,154,305-345`; `session-hooks.ts:70-87`; `tool-argument.ts:21-38`; `pre-tool-use.ts:380,422` | `tests/unit/hooks/blocked-read-model.test.ts`, `tests/unit/cli/blocked-view.test.ts` | shipped-and-matches | Gap: wiki says pending call recorded only on non-`allow`; with gate **disabled** every call is recorded (`pre-tool-use.ts:396-399`). Undocumented, not wrong. | — |
| 22 | Change Ledger: shadow refs, temp index, `.golem/` excluded, pre-restore, 50 keep, refusals, destructive class | wiki `Change Ledger.md` | `ledger.ts:46,49,64,203-212,263-300,484-520`; `git.ts:34-57,120-144`; `cli/commands/checkpoint.ts:32-33,131` (`cp`, `undo` aliases); `cli/checkpoint.ts:140-154` (`--yes`); `classify.ts:71` | `tests/integration/checkpoint-ledger-{core,prune,restore,scope}.test.ts`, `tests/unit/cli/checkpoint.test.ts` | shipped-and-matches | Property 5 lists detached/dirty-index refusals; `createCheckpoint` only refuses no-repo (`ledger.ts:268`) — refusals are restore-only (`:491-500`). Wiki wording ambiguous, not wrong. | — |
| 23 | Guidance Rules wiki feature list + wiring location | wiki `Guidance Rules.md` (3 seeded features incl. `local-coder`; wiring "in `src/cli/main.ts`") | registry: 9 seeded + 2 opt-in (`guidance.ts:337-407`); wiring `src/cli/commands/prompt-guidance.ts:230-298` | `tests/unit/hooks/guidance-seed-record.test.ts` | shipped-but-drifted | Wiki stale on count, key name and file. | none |
| 24 | Generated `.claude/rules/golem-*.md` == registry | task brief "Also verify" | rendered all 11 registry bodies at `fd3aedc`; the 8 present match byte-for-byte; `coder-first`/`prompt-translation`/`durable-tasks` not installed here | — | shipped-and-matches | **[main-wt]** `golem-snooze-hold.md` + `golem-subagent-headroom.md` are regenerated from the uncommitted `guidance.ts`, so they match THAT registry, not `development`'s. Committing one without the other breaks the match. | — |
| 25 | Plan task frontmatter parse (all docs load) | wiki `Plan Tasks.md`; D55 (c) `size` S/M/L | `PLAN_TASK_SIZES` (`types.ts:50`); `PlanTaskStore.list` silently skips unparseable (`plan-task.ts:187-192`) | drift test only asserts `length > 1` (`plan-tasks-roadmap.test.ts:32`) | partial | 4 of 177 docs use `size: XS` and vanish: R8.23, R8.25, R8.26 (done), **R8.29 (queued — absent from ROADMAP)**. | none |
| 26 | Quoted scalar values | D55 (c) hand-rolled parser | `plan-task.ts:81` stores value verbatim; only list items strip quotes (`:49`) | — | shipped-but-drifted | 65 task docs quote `title:`; ROADMAP rows render literal `"…"`. Defect. | none |
| 27 | `golem task resume` for plan tasks | D55; wiki `Plan Tasks.md:46`; `plan-task.ts:25` | `commands/tasks.ts:232` reads only `FileTaskStore` | — | partial | Plan tasks are not resumable, contra the three claims. | none |
| 28 | Escalate / local multiplex | wiki `Plan Tasks.md`; R5.3 | `escalateTask` sets `state: queued`; `runQueueLocally` filters `state==="queued"` only (`multiplex.ts:139`) → escalated task re-serviced locally and marked done; `notBefore` ignored by `task run`; CLI escalate passes `null` grounding (`commands/tasks.ts:436`) | `tests/unit/tasks/multiplex.test.ts` (no escalate-then-run case) | shipped-but-drifted | Defect. | none |
| 29 | Task `worktree` capture | `types.ts` schema docs | schema only (`types.ts:94-100,121`); no writer; idempotency keys stored/displayed, never re-verified | `types.test.ts` | not-started | | none |
| 30 | `spawnResume` failure detection | `src/cli/task.ts` | `failed` check dead — `'error'` is async (`task.ts:215-222`) | — | shipped-but-drifted | Defect: spawn failure never reported as failed. | none |
| 31 | Drift guards | D55 (e); wiki `Plan Tasks.md:81-93` | `tests/integration/plan-tasks-roadmap.test.ts:32-130` (all listed guards present) | same | shipped-and-matches | Weakness: see #25. | — |
| 32 | README frontmatter table vs parser | `docs/plan/tasks/README.md:31-43` | parser reads `created`/`updated` (`plan-task.ts:98,116-117`); `TASK_STATES` includes `blocked` (`types.ts:20-28`) | — | shipped-but-drifted | README omits `created`/`updated`. README lists `blocked` as a state (matches code) while D55 (d) and wiki `Plan Tasks.md:74` say "`blocked` is metadata, not a state". | none |
| 33 | `golem task done` refuses on unreviewed delegations | none in owned docs | `commands/tasks.ts:307-311,329-345`; `src/hooks/delegation-ledger.ts` | `tests/unit/hooks/delegation-ledger.test.ts` | shipped-but-drifted | Behaviour exists; README / Plan Tasks wiki never mention the refusal or `golem task review`. (Undocumented.) | none |
| 34 | §5.1 slash-command table | spec §5.1 (`golem-spec.md:248-258`) | skills installed: 22 `golem-*` + `vibe` (`skills.ts:29-39`, `init-skills.ts:54`); `/golem-index`, `/golem-search`, `/golem-devices`, `/golem-coder` exist only as MCP prompts `/mcp__golem__*` (`src/mcp/prompts.ts:108,126,143,156`); `/golem-note` not a skill | `tests/unit/cli/skills.test.ts`, `tests/contract/skills-tools-layering.contract.test.ts` | shipped-but-drifted | Four listed `/golem-*` commands don't exist as skills; 18 real skills unlisted. | none |
| 35 | §5.1 mechanism path | spec §5.1 "`.claude/skills/golem/<cmd>/SKILL.md`" | flat `.claude/skills/golem-<cmd>/` (`skills.ts:4-7` says nested layout "was never discoverable") | `skills.test.ts` | shipped-but-drifted | Code right; spec wrong. | none |
| 36 | §5.1 / D11 settings hierarchy | spec §5.1 "user → project → local → env → per-request" | loader adds team scope and `!important` (`src/config/loader.ts:35,137,307`; ADR-0008) | config tests (not owned) | shipped-but-drifted | Partition overlaps config owner; noted only. | none |
| 37 | D11 `.claude/commands/` files | spec D11 | no writer (grep `.claude/commands` in `src/cli/init*` = 0) | — | dead-or-superseded | Superseded by D14 skills. | — |
| 38 | D14 `/eol/<cmd>` nested namespace | spec D14 | flat `/golem-<cmd>` (`skills.ts:4-7`) | `skills.test.ts` | dead-or-superseded | D14 superseded twice (rename + flat layout, §150/§152); no later Decision records it. | none |
| 39 | `/mcp__golem__slider` prompt | ADR-0004 / R11.1 retire slider + `level` tool | `src/mcp/prompts.ts:13-40` still registers `slider`, instructing the model to call the retired `level` tool and `golem slider 0` | — | dead-or-superseded | Outside owned src (`src/mcp/`) — flag for the MCP partition. Reached via §5.1 "MCP prompts" claim. | none |
| 40 | D10 PostToolUse CCR hook wiring | spec D10 | `init-hooks.ts:207-211` `addPostToolUseHook` | (hook body → DUST1.3) | shipped-and-matches | Wiring only; behaviour owned by DUST1.3. | — |

## Undocumented

- `src/hooks/host-gate.ts` — R13.3 hosted-session PreToolUse gate (`fast-path.ts:303`). No owned wiki/spec page names it (grep `host-gate` in `docs/wiki`, spec = 0 outside debriefs).
- `src/hooks/delegation-ledger.ts` + `golem task review` — R14.6 review gate on `task done` (row 33). Only `Architecture.md` mentions delegation, not the refusal.
- `src/cli/task-grounding.ts` — KB grounding for `golem task run` (LE3). No owned doc.
- Gate-disabled path records every call as pending (`pre-tool-use.ts:396-399`) — Blocked model wiki silent.
- `src/hooks/redact.ts` `stripKnownSecrets` always-on floor — documented only in `Distillation Pipeline.md`, not in hooks docs (PostToolUse owner is DUST1.3).
- `src/hooks/settings-extras.ts` / `settings-writer.ts` — status line, `defaultMode`, `fallbackModel`, `AskUserQuestion` PostToolUse matcher (`init-hooks.ts:220-240`): no owned page lists what init writes to `.claude/settings.json`.
- `spawn_gate` / `spawn_cost_fraction` — absent from spec entirely (row 2).

## Dead candidates

- `spawnResume` failure branch (`src/cli/task.ts:215-222`) — unreachable (`'error'` is async).
- Task `worktree` capture fields (`src/tasks/types.ts:94-100,121`) — no writer.
- `/mcp__golem__slider` prompt (`src/mcp/prompts.ts:13-40`) — targets a retired tool (not owned).
- `identityRedact` (`src/hooks/redact.ts`) — test-injection only per its own doc; confirm no prod caller in DUST1.3.

## Stale comments

- `src/cli/init-hooks.ts:227-228` — "autonomy gate (inert at the default `manual` level)"; false since D40/ADR-0002 note (outward/destructive gated at every level, and now denied at PermissionRequest).
- `src/hooks/pre-tool-use.ts:65-66` — "default true" (stale once the [main-wt] flip lands).
- `src/mcp/snooze-note.ts:5` — "Decision 45 made snooze enforcement the default" (same).
- `tests/unit/hooks/pre-tool-use.test.ts:103-104` — "Real default is now enforce=true (Decision 45)" (same).
- `src/hooks/guidance.ts:165` — DURABLE_TASKS "can auto-resume" vs D37.
- `src/tasks/plan-task.ts:25` — claims plan tasks are resumable; `task resume` does not read them.

## Contradictions for the human

1. **Snooze defaults flip is half-landed.** USER decision 2026-09-25 exists only as uncommitted edits in the main checkout (`schema.ts`, `guidance.ts`, two rules, plus an unrelated `.claude/settings.json` plugin enable). Spec D45, wiki `Usage Limit Park.md:33`, wiki `Spawn Headroom Gate.md:79` and `tests/integration/cli-status.test.ts:711-723` all still say default **true**; the test will fail when the flip is committed. D45 is marked ACCEPTED/USER with "default true" — needs a superseding note or new Decision.
2. **ADR-0002 "ask → human" vs R12.12 hard deny.** Default `golem init` wires `PermissionRequest`, which denies every outward/destructive call while the gate is enabled. The human is never asked; the only escape is `golem autonomy disable` or running it themselves. The wiki explains the channel-relay reason but not this user-visible consequence. This repo's own `.claude/settings.json` does not wire the hook, so the effect is not dogfooded. Is "never offered" the intended policy, or should the deny be conditional on a connected permission-relay channel?
3. **`blocked` — state or metadata?** `TASK_STATES` and README include `blocked`; D55 (d) and the Plan Tasks wiki say it is metadata only.
4. **`size: XS` in 4 task docs** vs parser S/M/L — fix the docs or widen the enum? (R8.29 is queued and invisible.)

## Unverifiable here

- Whether a `PermissionRequest` `deny` pre-empts the dialog in the **interactive** TUI (§141 observed headless `-p` only).
- Newline-chained Bash reaching `allow` end-to-end in a live session (probed at `classifyAction` + `decideGate` only).
- Spawn-gate / delegation-ledger races — reasoned from read-modify-write code, not reproduced.
- D38 "quota restores next turn after a real reset" — spec itself lists it as manual verification.
