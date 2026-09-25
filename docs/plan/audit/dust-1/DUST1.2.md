# DUST1.2 — providers, routing, gateways & credentials: audit findings

Read-only audit, 2026-09-25, branch `dust/DUST1.2` off `development@fd3aedc`.
DRAFT — being extended; see final version below this line once complete.

## Findings table (draft)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `claude-cli` retirement leaves no live path | DUST1.2 brief "Also verify"; R13.12 | `src/providers/index.ts:125`, `:149-151`, `:188`, `:258`, `:331`; `src/cli/commands/mcp-serve.ts:9,120-122`; `src/inference/target-dispatcher.ts:486-491,902,920` | — | not-started | Retirement never happened: R13.12 deliberately split removal into R13.14 (queued, blocked on a live check). Path is fully live. | R13.14 |
