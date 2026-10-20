# Dust audit note: Change Ledger, store (DUST4.6, partition B)

Read-only. Docs in scope: `docs/wiki/concepts/Change Ledger.md` lines 37-76.
Code read: `src/checkpoint/ledger.ts`, `src/checkpoint/git.ts`.
Own header counts: matches 6, partial 3, drifted 0, not started 0, contradicted 0 (total 9).

| ID | Doc:line | Claim | Class | Evidence |
|---|---|---|---|---|
| B01 | Change Ledger.md:41 | touches `refs/golem/ledger/<id>`, a commit object | matches | src/checkpoint/ledger.ts:46,280-287 (`commit-tree`, `update-ref`) |
| B02 | Change Ledger.md:42 | staging happens in a throwaway `GIT_INDEX_FILE` | matches | src/checkpoint/git.ts:34,57; src/checkpoint/ledger.ts:16 |
| B03 | Change Ledger.md:44 | `.golem/` excluded by pathspec | matches | src/checkpoint/ledger.ts:64 |
| B04 | Change Ledger.md:47 | snapshot is a commit parented on HEAD | matches | src/checkpoint/ledger.ts:283 (`-p repo.head`; no parent on an unborn HEAD) |
| B05 | Change Ledger.md:63-66 | detached HEAD or dirty index refuses | partial | only `restore` refuses: src/checkpoint/ledger.ts:491-497; `create` refuses only on no git or not a repo: ledger.ts:267-268 |
| B06 | Change Ledger.md:61-62 | restore takes a `pre-restore` checkpoint first | matches | src/checkpoint/ledger.ts:81,133 (kind); search `pre-restore` in ledger.ts |
| B07 | Change Ledger.md:67 | auto-prunes to the 50 newest on create | matches | src/checkpoint/ledger.ts:49,273,320 |
| B08 | Change Ledger.md:67-68 | re-checkpointing an unchanged tree reuses the ref | partial | compares only against the newest checkpoint's tree: src/checkpoint/ledger.ts:276-279; skips pruning |
| B09 | Change Ledger.md:72-75 | snapshot and restore go through git filters | matches | src/checkpoint/ledger.ts:31-37 (comment); staging uses `git add` in the temp index |
