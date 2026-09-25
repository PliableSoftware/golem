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
