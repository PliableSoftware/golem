# DUST1.7 — hooks, guidance, snooze, autonomy, checkpoints, plan tasks

Dust Phase 1 audit, read-only. Evidence is `file:line` at `fd3aedc` (branch
`dust/DUST1.7`). Status: **IN PROGRESS** — autonomy, snooze park, spawn gate,
coder-first, guidance sections drafted; session/blocked, checkpoint, plan tasks,
init wiring, skills pending.

## Findings table

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| (see draft sections below; table assembled at close) | | | | | | |

## Draft notes — autonomy

- Bash newline chaining bypasses the safe-read classification. `SHELL_COMPOSITION_RE = /[;&|>`]|\$\(/` (`src/autonomy/classify.ts:107`) has no `\n`/`\r`; SAFE_BASH `^ls(\s|$)` matches `ls\n<anything>`. Probed: `"ls\nnode -e …rmSync…"` → `read` → `assisted` emits `allow`. No test covers newlines (`tests/unit/autonomy/classify.test.ts`, `grep -F '\n'` = 0).
- SAFE_BASH over-approves mutating forms: `git branch -D main`, `npx biome check --write .`, `git diff --output=<path>` all → `read` (probed).
- PermissionRequest converts ADR-0002's `ask` into a hard `deny` for outward/destructive (`src/autonomy/gate.ts:81-86`, `src/hooks/permission-request.ts:91-101`).

## Draft notes — hooks / snooze / spawn / guidance

- pre-tool-use order: park → spawn gate (+delegation ledger) → coder-first → autonomy (`src/hooks/pre-tool-use.ts:228,279,342,395`). Decision 39 names 3 stages; spawn gate inserted later.
- Decision 39 names guidance `local-coder` / `.claude/rules/golem-local-coder.md`; code key is `coder-first` (`guidance.ts:351`, `pre-tool-use.ts:345`).
- coder-first extensions TS/JS only (`coder-first-nudge.ts:31`).
- Decision 38 says `limit.json`; code writes `limit-state.json` (`src/proxy/limit-prediction.ts:129`).
- spawn gate ignores a passed `resetAtIso` (`spawn-gate.ts:168-172`); snooze-nudge checks it (`snooze-nudge.ts:114-115`).
- spawn-gate / delegation-ledger read-modify-write races under parallel fan-out.
- Guidance Rules wiki lists 3 seeded features incl. `local-coder`; registry has 9 seeded + 2 opt-in (`guidance.ts:337-407`). Wiki says wiring in `src/cli/main.ts`; actually `src/cli/commands/prompt-guidance.ts:230-298`.
- Rendered all 11 registry bodies; the 8 present in `.claude/rules/` match byte-for-byte; coder-first/prompt-translation/durable-tasks absent.
- DURABLE_TASKS snippet says tasks "can auto-resume" (`guidance.ts:165`) — Decision 37 dropped auto-resume.

## Draft notes — plan tasks

- 4 of 177 task docs fail `parsePlanTask` (`size: XS`): R8.23, R8.25, R8.26 (done), **R8.29 (queued)** — silently skipped by `PlanTaskStore.list` (`plan-task.ts:187-192`), absent from ROADMAP; drift test only asserts `length > 1`.
- Quoted scalars keep literal quotes (`plan-task.ts:81`): 65 task docs; ROADMAP rows show `"…"`.
- `task resume` reads only `FileTaskStore` (`commands/tasks.ts:232`) — plan tasks not resumable, contra Decision 55 / wiki / `plan-task.ts:25`.
- `escalateTask` → `state: queued`; `runQueueLocally` filters `state==="queued"` only (`multiplex.ts:139`) → escalated task re-serviced locally and marked done. `notBefore` ignored by `task run`. CLI escalate passes `null` grounding (`commands/tasks.ts:436`).
- `worktree` capture: schema only, no writer (`types.ts:94-100,121`); idempotency keys stored/displayed, never re-verified.
- `spawnResume` `failed` check dead: `'error'` is async (`src/cli/task.ts:215-222`).
