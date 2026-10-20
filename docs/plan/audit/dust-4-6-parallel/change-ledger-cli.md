# Dust audit note: Change Ledger, CLI surface (DUST4.6, partition A)

Read-only. Docs in scope: `docs/wiki/concepts/Change Ledger.md` lines 12-35.
Code read: `src/cli/commands/checkpoint.ts`, `src/cli/checkpoint.ts`, `src/cli/skills/footguns.ts`.
Own header counts: matches 9, partial 2, drifted 0, not started 0, contradicted 0 (total 11).

| ID | Doc:line | Claim | Class | Evidence |
|---|---|---|---|---|
| A01 | Change Ledger.md:12 | `golem checkpoint` snapshots the tree to a shadow ref | matches | src/cli/commands/checkpoint.ts:31-50 |
| A02 | Change Ledger.md:13-14 | writes nothing until you run it | matches | search `createCheckpoint` in src outside src/checkpoint: only src/cli/commands/checkpoint.ts:46,50 |
| A03 | Change Ledger.md:17 | `create --note` exists | matches | src/cli/commands/checkpoint.ts:36,41 |
| A04 | Change Ledger.md:18 | `list` exists | matches | src/cli/commands/checkpoint.ts:77-80 |
| A05 | Change Ledger.md:19 | `show <id\|latest>` exists | matches | src/cli/commands/checkpoint.ts:103-106 |
| A06 | Change Ledger.md:19 | `show` prints exactly what a restore would do | partial | text output caps paths at 12: src/cli/checkpoint.ts:24; `--json` is full: src/cli/commands/checkpoint.ts:122 |
| A07 | Change Ledger.md:20 | `restore <id\|latest>` exists | matches | src/cli/commands/checkpoint.ts:129-135 |
| A08 | Change Ledger.md:20 | restore prompts | partial | prompts on a TTY only; non-TTY without `--yes` throws: src/cli/checkpoint.ts:149-156 |
| A09 | Change Ledger.md:21 | `drop <id>` exists | matches | src/cli/commands/checkpoint.ts:174-177 |
| A10 | Change Ledger.md:21 | `prune --keep 20` exists | matches | src/cli/commands/checkpoint.ts:203-207 (default is 50, 20 is an example) |
| A11 | Change Ledger.md:31 | the ledger has no MCP tool | matches | search `checkpoint` in src/mcp and src/hooks: no hits |
