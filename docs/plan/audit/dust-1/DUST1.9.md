# DUST1.9 — telemetry, status and UI surfaces audit (in progress)

Work in progress; sections filled as the audit proceeds.

## Early findings

- `src/cli/status-collect.ts:429-436` — `REDACTION_OFF_WARNING` is dropped whenever a newer
  Golem version is cached as available (the ternary's update branch never appends it).
- `src/telemetry/jsonl-store.ts:178`, `src/telemetry/cost-benchmark.ts:304,335` — literal NUL
  bytes in source; git renders every diff of these files as `Binary files differ`.
- `src/cli/commands/note-dashboard-watch.ts:107` — dashboard picks its stats source ONCE at
  startup; started before telemetry has a request it serves the empty in-process live source
  for its whole life.
- `src/pipeline/pipeline.ts:747-751` — request telemetry and the context ledger are emitted only
  when the pipeline rewrote the request; `requests` in `golem stats`/dashboard counts rewritten
  requests only, and `stats --context` goes stale on unchanged traffic.
- Every `tokens before/after/saved` figure is `estimateTokens` (chars/4,
  `src/compression/tokens.ts`), printed with no "estimate" label (`src/cli/stats.ts:204-219`).
- Spec §5 `golem replay-eval`, dashboard cache/cost/per-device/canary tiles: no code.
