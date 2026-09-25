# DUST1.11 — cross-cutting audit (draft, in progress)

Branch `dust/DUST1.11`, base `fd3aedc`. Read-only; this file is the only change.

## Early findings (to be folded into the table)

- Unowned code: only `src/cli/commands/` (28 files) is unclaimed by DUST1.1–DUST1.10.
- Decisions 1–64 all claimed; none above 64 exist.
- WIKI.md Index: 225 entries, 0 dangling; 6 pages unlisted.
- `docs/wiki/concepts/Architecture.md:164` teaches `golem account use <id>`; command removed by R9.23, replaced by `golem gateway use` (`src/cli/commands/gateway.ts:58`).
