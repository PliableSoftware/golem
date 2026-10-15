---
task: vector-store-outside-chunk-migration
title: "Migrate old relative-keyed outside-target chunks; fix the relative project_id collision"
state: queued
owner: agent
size: S
discipline: code
design: "Follow-ups recorded in docs/plan/tasks/vector-store-lock-and-outside-watch.md (shipped in #305); projectBaseDir in src/knowledge/ingest.ts; external: keys"
gate: "Failing-first tests for both repros pass: (1) chunks written by an outside `golem index <dir> --watch` before the external: namespace are removed or re-keyed so `golem search` no longer returns the old relative `README.md` chunk from the outside directory, for an explicit index as well as the auto-index sync path; (2) with a relative `project_id` or `--dir .`, an outside target is keyed `external:<absolute path>` and editing `../other/README.md` leaves the project's own `README.md` chunks intact; golem verify green by exit code."
depends_on: []
touches: [src/knowledge, src/cli/auto-index.ts, tests]
created: 2026-10-15
---

## What this is

#305 gave files outside the project an `external:<absolute POSIX path>` key so an outside `--watch`
no longer deletes the project's chunks. Two follow-ups were recorded, with repros, and not fixed:

1. **No migration.** Chunks written before the namespace stay under their old relative `sourcePath`
   (for example `README.md`) and are still served by `search` as orphans. Repro: on an old build run
   `golem index ../other` (project id = this repo), upgrade, then `golem search`. The auto-index sync
   path removes them via the manifest; an explicit index does not.
2. **Relative project id.** `projectBaseDir` returns the target itself for a relative project id, so a
   relative `project_id` or `--dir .` still keys an outside target relative to itself and can collide
   with project files.

## Out of scope

- The other residuals in the source task (two breakers on a few-millisecond interleave, half-commit, a
  synchronous `#readDisk`, swallowed watcher errors, leftover `.break.clear.*` and `.take.*` files).
