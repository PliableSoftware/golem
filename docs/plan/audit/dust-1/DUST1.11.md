# DUST1.11 — cross-cutting audit (draft, in progress)

Branch `dust/DUST1.11`, base `fd3aedc`. Read-only; this file is the only change.

Interim snapshot: spec §1/§2/§7/§8/§9, Decisions 20/21/32/36, Architecture.md and
README done. Unowned-code sweep, plan hygiene and WIKI.md index still being folded in.

## Early findings

- Unowned code: exactly 28 files, all `src/cli/commands/`, unclaimed by DUST1.1–DUST1.10 (path-prefix match of every `src/**` path named in those briefs against every non-test `src/**/*.ts`).
- Decisions 1–64 all claimed; none above 64 exist (`docs/golem-spec.md:523` is 64, the last).
- `docs/wiki/concepts/Architecture.md:164` teaches `golem account use <id>`; replaced by `golem gateway use` (`src/cli/commands/gateway.ts:58`).
- Two processes, not one: MCP is a per-session stdio child (`.mcp.json:4-7`, `src/cli/commands/mcp-serve.ts:141`), proxy is a detached daemon (`src/cli/proxy-daemon.ts:451`). Spec §2.1:114, Architecture.md:42, README.md:23 all say "one process".
- Local answer is default ON (`src/config/schema.ts:1137`); Architecture.md:103 and README.md:42 call it "opt-in".
- Slash-command naming `/golem/*` (spec:19, spec:275, README.md:18) vs shipped `/golem-<cmd>`.
- Decision 36 put R5/R6 ON HOLD (spec:465); R6 shipped 2026-07-23 (`docs/plan/SHIPPED.md:28`) with no Decision recording the lift.
