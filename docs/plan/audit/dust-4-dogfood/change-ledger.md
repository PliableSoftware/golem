# Dust audit note: Change Ledger (DUST4.4 dogfood, one partition)

Read-only audit. Nothing in the slice was changed.

Docs in scope: `docs/wiki/concepts/Change Ledger.md` (W), the checkpoint skill
`.claude/skills/golem-checkpoint/SKILL.md` (S), spec lines about checkpoints in
`docs/golem-spec.md` (P).
Code read: `src/checkpoint/ledger.ts`, `src/checkpoint/git.ts`,
`src/checkpoint/index.ts`, `src/cli/checkpoint.ts`,
`src/cli/commands/checkpoint.ts`, `src/autonomy/classify.ts`,
`src/autonomy/gate.ts`, `src/cli/skills/footguns.ts`, `src/cli/skills/develop.ts`.

Class definitions used (the skill gives none, see FINDINGS F2):
- matches: the code does what the claim says, as written.
- drifted: the claim was written about this code and is now false in a specific.
- partial: true for some commands, inputs or conditions, not as stated.
- not started: documented as shipped or planned, no code.
- contradicted: code does the opposite, or two docs disagree.

| ID | Doc:line | Claim | Class | Evidence |
|---|---|---|---|---|
| W01 | Change Ledger.md:12-14 | `golem checkpoint` snapshots the worktree to a shadow git ref so a failed attempt can be discarded | matches | src/checkpoint/ledger.ts:282,290; src/cli/commands/checkpoint.ts:31-75 |
| W02 | Change Ledger.md:14 | Shipped in R8.9; writes nothing until run; never commits on the branch | matches | only importer of createCheckpoint outside the module is src/cli/commands/checkpoint.ts:46 (search `createCheckpoint` in src, no hook or MCP caller); ledger.ts:290 is the only write |
| W03 | Change Ledger.md:17-22 | create, list, show, restore, drop, prune exist, with `--note`, `<id\|latest>`, `--keep` | matches | src/cli/commands/checkpoint.ts:36-42,77,103-106,129-135,174-177,203-207 |
| W04 | Change Ledger.md:19 | `show` prints "exactly what a restore would do" | partial | text output lists at most 12 paths per block then "and N more": src/cli/checkpoint.ts:24,72-76; `--json` is full: src/cli/commands/checkpoint.ts:122 |
| W05 | Change Ledger.md:26-29 | ~83% of input cost is re-reading (§93) | matches | docs/wiki/concepts/Cache Observability.md:119 (doc-to-doc only; no code to check) |
| W06 | Change Ledger.md:31-33 | The ledger has no MCP tool | matches | search `checkpoint` in src/mcp and src/hooks: no hits |
| W07 | Change Ledger.md:33-35 | A `/golem-checkpoint` skill plus one paragraph in `/golem-develop` | matches | src/cli/skills/footguns.ts:64; src/cli/skills/develop.ts:39-43 |
| W08 | Change Ledger.md:41 | Touched: `refs/golem/ledger/<id>`, a commit object | matches | ledger.ts:48,282,285-290 |
| W09 | Change Ledger.md:42 | Worktree files touched on a restore only | matches | ledger.ts:539-566 (applyRestore), called only from ledger.ts:522 |
| W10 | Change Ledger.md:43 | Empty directories left by a deletion are removed | matches | ledger.ts:57-61,75-93 |
| W11 | Change Ledger.md:41 | Never touched: `refs/heads/*`, no branch, no commit of yours | matches | only `update-ref` target is the ledger prefix: ledger.ts:282,290 |
| W12 | Change Ledger.md:42 | Never touched: the index; staging in a throwaway `GIT_INDEX_FILE` | matches | ledger.ts:203,210,214; git.ts:57. The real index is copied (read) first, ledger.ts:206 |
| W13 | Change Ledger.md:43 | Never touched: `HEAD` never moves | matches | no HEAD write anywhere in ledger.ts or git.ts; git.ts:14-16 |
| W14 | Change Ledger.md:44 | `.golem/` excluded by pathspec whether ignored or not | matches | ledger.ts:64,210 |
| W15 | Change Ledger.md:45 | Nothing remote: default refspecs do not carry `refs/golem/*` | matches | no push or fetch code in src/checkpoint; ledger.ts:15-17 states it; git default push/fetch refspecs are `refs/heads` (git behaviour, not code) |
| W16 | Change Ledger.md:47-48 | Snapshot is a real commit parented on HEAD; `git diff refs/golem/ledger/<id>` works | matches | ledger.ts:283-284; src/cli/checkpoint.ts:61 |
| W17 | Change Ledger.md:52 | Opt-in: nothing runs until an explicit `golem checkpoint` | matches | same evidence as W02 |
| W18 | Change Ledger.md:53-54 | A restore prints EVERY file it will overwrite and delete, then asks | drifted | preview caps each list at `PREVIEW_PATHS = 12` and summarises the rest: src/cli/checkpoint.ts:24,72-76,91-92 |
| W19 | Change Ledger.md:54-55 | Non-interactive runs refuse without `--yes` | matches | src/cli/checkpoint.ts:149-155 |
| W20 | Change Ledger.md:55 | "Decision 26 consent convention, as in `golem wiki promote`" | partial | promote has the same `--yes` shape: src/cli/commands/wiki.ts:178; Decision 26 (docs/golem-spec.md:435) is the Ollama install and model-pull decision, not a general consent convention |
| W21 | Change Ledger.md:56-57 | `restore\|undo\|drop\|prune` classify as `destructive` | matches | src/autonomy/classify.ts:90; `undo` alias src/cli/commands/checkpoint.ts:131 |
| W22 | Change Ledger.md:57-58 | destructive is never-auto: no autonomy level approves it | matches | src/autonomy/gate.ts:32-34; docs/decisions/ADR-0002-autonomy-approval-gates.md:90 |
| W23 | Change Ledger.md:58 | `ask` overrides an allow-list | matches | src/autonomy/gate.ts:7 |
| W24 | Change Ledger.md:58-60 | Taking a checkpoint "stays unclassified-cheap" (no gate on the safe half) | drifted | `golem checkpoint create` is not in any list so it is `unknown`: classify.ts:328; at `outcome` level `unknown` is `ask`: gate.ts:45-46; ADR-0002:71 "unknown is never auto-allowed". Ungated only at manual (native prompt) and assisted: gate.ts:37-41 |
| W25 | Change Ledger.md:61-62 | A restore takes a `pre-restore` checkpoint first and prints the reversing command | matches | ledger.ts:515-520; src/cli/checkpoint.ts:106-108 |
| W26 | Change Ledger.md:63 | No git or not a repo gives a no-op naming the reason | matches | git.ts:144-152; ledger.ts:268,433,490 |
| W27 | Change Ledger.md:63-64 | A detached HEAD or dirty index gives a no-op naming the reason (all operations) | partial | only restoreCheckpoint refuses: ledger.ts:491-502; createCheckpoint (ledger.ts:267-268), listing, `show` (planRestore, ledger.ts:432-433), drop and prune do not look at either |
| W28 | Change Ledger.md:64-66 | Dirty index refused because staged content would no longer describe disk | matches | ledger.ts:497-501; git.ts:121-127 |
| W29 | Change Ledger.md:67 | Auto-prunes to the 50 newest on create | matches | ledger.ts:49,320; src/cli/commands/checkpoint.ts:42 |
| W30 | Change Ledger.md:67-68 | Re-checkpointing an unchanged tree reuses the existing ref | matches | ledger.ts:277-279,316-318 (compares to the newest only) |
| W31 | Change Ledger.md:72-76 | Snapshot and restore use git's own clean/smudge filters, so line endings follow git | matches | ledger.ts:33-39 (comment), 210,547-548 (git add / checkout-index); behaviour is git's, not asserted by a test read here |
| W32 | Change Ledger.md:80-86 | Linked pages `Cache Observability`, `Context Ledger`, `Dogfooding Golem` and `ADR-0002-autonomy-approval-gates.md` exist | matches | docs/wiki/concepts/ listing; docs/decisions/ listing |
| W33 | Change Ledger.md:83-84 | The CLI is named `checkpoint`, not `ledger`, to keep it apart from the context ledger | matches | src/cli/checkpoint.ts:16-17; src/cli/commands/checkpoint.ts:31-34 |
| W34 | Change Ledger.md:5 | Frontmatter sources exist | matches | docs/plan/tasks/R8.9.md, docs/plan/proposals/r8-context-economy.md, src/checkpoint/, src/cli/checkpoint.ts, src/autonomy/classify.ts |
| S01 | SKILL.md:15-17 | `create` is cheap and a no-op when nothing changed | matches | ledger.ts:277-279,316-318; src/cli/commands/checkpoint.ts:63-68 |
| S02 | SKILL.md:18 | `list` shows newest first | matches | ledger.ts:151,160 |
| S03 | SKILL.md:19-20 | `show` is exactly what a restore would overwrite and delete | partial | same cap of 12 as W04: src/cli/checkpoint.ts:72-76 |
| S04 | SKILL.md:21-23 | `restore` "always prompts"; never pass `--yes`; propose, show the plan, let them accept | partial | it prompts only on a TTY; non-TTY without `--yes` throws and the command exits 2: src/cli/checkpoint.ts:150-155, src/cli/commands/checkpoint.ts:169-171. An agent's Bash call has no TTY, so the agent cannot complete a restore the human accepted; the human must run it |
| S05 | SKILL.md:21-22 | `restore` is classified destructive (ADR-0002) | matches | classify.ts:90 |
| S06 | SKILL.md:25-26 | It will not commit on the branch, stage, move HEAD or push | matches | ledger.ts:203,282-290; git.ts:14-16 |
| S07 | SKILL.md:26 | It will not touch gitignored files | matches | ledger.ts:192,210 (`add --all` honours .gitignore, so ignored paths never enter either tree, so never enter a plan) |
| S08 | SKILL.md:27-28 | Snapshots live under `refs/golem/ledger/*`; a restore only writes worktree files | matches | ledger.ts:48,539-566 |
| S09 | SKILL.md:28-29 | `git diff refs/golem/ledger/<id>` is an ordinary diff | matches | ledger.ts:283-284 (real commit with tree) |
| S10 | SKILL.md:29-31 | No-op with a reason on no git, no repo, detached HEAD, dirty index | partial | same as W27: only restore refuses detached or dirty: ledger.ts:491-502 |
| P01 | golem-spec.md:33 | Checkpoints are shipped | matches | src/checkpoint/ledger.ts; src/cli/commands/checkpoint.ts |
| P02 | golem-spec.md:274 | Installed skills include `checkpoint` | matches | src/cli/skills/footguns.ts:64; src/cli/skills.ts:35 |

## Contradictions for the human

None. (W20 is a mis-citation, not a doc-vs-doc contradiction.)

## HIGH security items

None found. W22 and W23 (the destructive gate) match the code. W24 is a
documentation drift about `create`, not a weakening of the gate.

## Not audited

- Test files under tests/ were not read; claims are checked against source only.
- Behaviour of git itself (W15, W31) was taken from git semantics, not run.
