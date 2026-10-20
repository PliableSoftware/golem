# Dust skill dogfood 2: summary

Counts recounted mechanically across both tables with `grep -c "^| [AB][0-9]*.* | <class> |" change-ledger-*.md`, summed per class, not copied from the notes' headers.

| Class | Rows |
|---|---|
| matches | 16 |
| drifted | 0 |
| partial | 4 |
| not started | 0 |
| contradicted | 0 |
| **total** | **20** (equals the 20 table rows, `grep -c '^| [AB][0-9]'`) |

Slice: `docs/wiki/concepts/Change Ledger.md`, split into partition A (lines 12-35, the CLI surface, 11 rows, branch `task/dust4-6-cli`) and partition B (lines 37-76, the store, 9 rows, branch `task/dust4-6-store`). One worktree and one branch each; the two branches merged into `task/dust4-6` with no conflict.

Header check: A's header says 9 matches and 2 partial, which agrees with the recount. B's header says 6 matches and 3 partial; the recount is 7 and 2. A summed-headers SUMMARY would have been 15 matches and 5 partial: wrong in two cells.

Partial: A06 (`show` text output caps at 12 paths), A08 (restore prompts only on a TTY), B05 (detached HEAD and dirty index only block `restore`), B08 (an unchanged tree is reused only against the newest checkpoint). A06, A08 and B05 repeat DUST4.4 rows W04, S04 and W27; B08 is new. The slice's own drift was not fixed: read-only.

Skill findings: see `FINDINGS.md`.

Limit: one agent wrote both notes, one after the other, so concurrency between auditors was not exercised. What was exercised is the shape: separate worktrees and branches, separate notes, a merge, a cross-table recount.
