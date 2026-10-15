# Dust skill dogfood: summary

Counts recounted mechanically from the table in `change-ledger.md` (every table row that carries a class), by the orchestrator, not copied from the note's own header.

| Class | Rows |
|---|---|
| matches | 38 |
| drifted | 2 |
| partial | 6 |
| not started | 0 |
| contradicted | 0 |
| **total** | **46** |

Slice: the Change Ledger (one wiki page, the checkpoint skill and two spec lines) against `src/checkpoint/` plus the CLI and autonomy gate. One partition. About four times the dozen claims the brief expected.

Drifted: W18 (the restore preview caps at 12 paths, not "every file") and W24 (`create` classifies as `unknown`, which is `ask` at the outcome level, not "cheap").

Partial: W04 and S03 (`show` truncates at 12), W20 (Decision 26 is the Ollama consent decision, not this one), W27 and S10 (a detached HEAD and a dirty index only block `restore`), S04 (`restore` refuses without `--yes` outside a TTY, so an agent cannot complete one).

No HIGH security items. No contradictions listed for the human. The slice's own drift was not fixed and no tasks were filed for it: this was a read-only dogfood of the skill, not a rebaseline.

Skill findings: see `FINDINGS.md` (11 defects, 9 fixed in the skill, 2 filed as DUST4.6).
