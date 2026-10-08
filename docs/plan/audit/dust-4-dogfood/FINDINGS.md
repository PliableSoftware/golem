# Dust skill dogfood: findings

Task DUST4.4, run 2026-10-08. One agent followed the Phase 1 text of the `golem-dust` skill literally on a small slice (the Change Ledger: one wiki page, the `golem-checkpoint` skill and two spec lines, against `src/checkpoint/` plus the CLI and autonomy gate) and recorded every place the skill text was wrong, missing or ambiguous. The audit note is `change-ledger.md` in this directory. The findings below are the agent's, transcribed by the orchestrator because the harness did not let the subagent write this file.

F1-F9 were fixed in `src/cli/skills/dust.ts`, with a test in `tests/unit/cli/skills.test.ts` and the installed copy regenerated. F10 and F11 are filed as `docs/plan/tasks/DUST4.6.md`.

| # | Defect in the skill text | What the agent did | Resolution |
|---|---|---|---|
| F1 | No table shape and no place for the SUMMARY | Invented one row per claim with the class in its own cell | Fixed: the skill states the table shape |
| F2 | The five classes (matches, drifted, partial, not started, contradicted) were undefined | Chose its own meanings | Fixed: one line per class |
| F3 | "Claim" and "documented" had no unit or scope | Treated one checkable sentence as one claim, and included skills and spec lines as documents | Fixed |
| F4 | No guidance for a claim the code cannot settle, or for a claim of absence | Marked such rows partial with the reason | Fixed |
| F5 | The single-partition case was unclear | Treated the whole slice as one partition | Fixed |
| F6 | "HIGH" security items were undefined | Used its own bar | Fixed |
| F7 | A truncated read looks like a read: a 592-line source file came back as an excerpt | Noticed and re-read it in ranges | Fixed: the skill says to confirm a read was complete |
| F8 | "Check bytes" did not say against what; the proxy showed a redaction marker the file did not contain | Ran `git grep` on the file and diffed | Fixed |
| F9 | Unclear whether to read earlier audit notes first | Read none until its own table was done | Fixed: do not, until your own table is done |
| F10 | Parallel worktrees and the cross-note recount were not exercised (one partition only) | not applicable | Filed in DUST4.6 |
| F11 | A non-Golem scratch repository layout was not tried | not applicable | Filed in DUST4.6 |

## Verdict

Mostly, but not without luck. The skill gave the right outline: read-only, classify with `path:line` evidence, recount mechanically. Someone with only the skill text would have had to guess the class meanings, the claim unit, the table format, what HIGH means and how to treat unverifiable claims, which would make two auditors' counts incomparable.

This grade is weak. The agent had also read `CLAUDE.md` and the Dust Method wiki page, and wrote the fixes itself. It did not independently re-grade the 38 matches rows, and one partition does not test the parallel and cross-note parts of the method.
