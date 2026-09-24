# DUST1.9 — telemetry, status and UI surfaces audit (in progress)

Work in progress; sections filled as the audit proceeds.

## Early findings

- `src/cli/status-collect.ts:430-436` — `REDACTION_OFF_WARNING` is dropped whenever a newer
  Golem version is cached as available (the ternary's update branch never appends it).
- `src/telemetry/jsonl-store.ts:178`, `src/telemetry/cost-benchmark.ts:304,335` — literal NUL
  bytes in source; git renders every diff of these files as `Binary files differ`.
