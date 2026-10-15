---
task: DUST2.16
title: Settings cascade gaps: default! floor, locked controls rendered with origin + recourse, ApplyResult.overridden
state: done
owner: agent
size: M
discipline: code
design: ADR-0008; wiki Settings Cascade, Configuration Surfaces; SUMMARY.md Gaps 1.8/r004 (N), r010 (P), r011 (P)
gate: `default!` is honoured as a floor; a pinned control renders locked with its origin and recourse on every surface (IMPORTANT_LOCKED); a write the cascade overrules returns ApplyResult.overridden and the surface says so; tests for each. golem verify green by exit code.
depends_on: []
touches: [src/config, src/cli, src/tui, tests]
created: 2026-10-08
updated: 2026-10-15T06:12:50.236Z
---

## What this is

Roadmap gap from ADR-0008 (DUST1.8 rows 4, 10, 11). Evidence per row is in DUST1.8.

## The work

1. r004: `default!` is described as the floor for future non-negotiables but nothing reads it —
   define and enforce it in the cascade resolver.
2. r010: render a pinned control as locked, with the origin that pinned it and how to change it,
   on the panel, `golem config`, the TUI and VS Code alike.
3. r011: populate `ApplyResult.overridden` when a write lands below a higher-precedence origin,
   and have each surface tell the user their write had no effect.

## Out of scope

- G3/S18 team policy reach (open, USER). G5 panel default scope (doc follows code).

## Status 2026-10-14 (branch `feat/dust2-16-cascade-gaps`)

Much of r010/r011 had already landed (`loadEffectiveConfig`, `IMPORTANT_LOCKED`, the settings
`overridden`). What this pass closed:

- **r004 `default!`** — `src/config/default-floor.ts` + `applyDefaultFloor` in `loader.ts`.
  Semantics, as implemented (no new precedence): a `default!` key resolves to its compiled-in
  default after both bands, so it beats `user!`, `team!`, `project!`, `local!`, env and headers;
  provenance is `{ layer: "default", important: true }`. It is admitted only for a boolean that the
  team policy classes `true-only`/`false-only` whose default is already the strict value, so it can
  only make a setting stricter or equal. `proxy.bypass_all` is rejected by name. Origins that
  declared the key get a warning naming origin and key, never the value.
- **r010** — runtime compression/gateway controls now lock on importance (they checked `env` only);
  `config get/list --json` and `status --json` carry `important` + `locked`; `config get`/`set` print
  it; the TUI wraps the reason instead of clipping the recourse; VS Code prints it inline.
- **r011** — the dial's `overriddenBy` carries `important`; `config set` says when `default!` won; the
  merge-per-key false positive (`inference.personas`) is fixed; the VS Code extension relays the CLI's
  override note.

Tests: `tests/unit/config/default-floor.test.ts`, `tests/unit/config/cascade-gaps.test.ts`,
`tests/unit/tui-locked-reason.test.ts`, `vscode-extension/render.test.js`.

### Open USER decisions

1. **Which keys should `default!` pin?** The registry (`DEFAULT_IMPORTANT_KEYS`) is empty on purpose:
   nothing shipped today is a non-negotiable. Candidates are the `false-only` booleans whose default
   is `false` (e.g. `knowledge.lsp_enabled`, `security.write_lan`), but pinning one removes a
   capability from every user, so it is a product call, not an agent one.
2. **Should the API refuse (not just report) a write to an important-locked key?** Today the write
   lands and `overridden` says it has no effect (ADR-0008 consequence 4 reads this way). Refusing
   would make `default!` writes impossible to leave behind in a file; the safe reading kept here is
   report-only.

## Outcome

shipped in #314
