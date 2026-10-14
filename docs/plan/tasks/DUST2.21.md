---
task: DUST2.21
title: "Release lockstep and CI: release.mjs moves all versions or none; release asserts SHA256SUMS and the tarball"
state: queued
owner: agent
size: S
discipline: code
design: "wiki Release Pipeline; SUMMARY.md Gaps 1.8/r057 (P), 1.8/r066 + 1.11/r005 (G18), 1.8/r072 + 1.10/r069 (G23); DECISIONS.md X5, X8"
gate: "scripts/release.mjs updates package.json, vscode-extension/package.json and VERSION atomically (a failure part-way leaves none changed — tested); the release workflow's required-asset assertion includes SHA256SUMS and the npm tarball under its @pliable/golem name. golem verify green by exit code."
depends_on: [DUSTSEC.16]
touches: [scripts/release.mjs, .github/workflows, tests]
created: 2026-10-08
---

## What this is

Roadmap gap. r057 "all three move or none do" is partial; X8: `SHA256SUMS` and `.tgz` are missing
from the asserted list. X5: macOS stays advisory by design (doc follows code) — not in scope.

## Out of scope

- Cutting a release (owner: user flow). Branch protection settings.

## Delivered (2026-10-14, branch fix/dust2-21-release-lockstep)

- `scripts/release.mjs`: plan all edits in memory (package.json, vscode-extension/package.json,
  package-lock.json, src/version.ts), validate, write temps, rename, restore on any failure.
  `scripts/sync-version.mjs` exports `versionTsContent` so the template is not duplicated.
- `release.yml` required-asset loop now includes `SHA256SUMS` and `pliable-golem-${VERSION}.tgz`.
- Tests: `tests/unit/release-script-atomic.test.ts` (injected write/rename failures on temp copies).

**Not locally testable:** the workflow assertion actually failing on a missing asset, and the
`version` output feeding the tarball name, run only inside a real release (the user's act). Local
coverage is a text check of the list plus YAML parse. Residual: a process kill between renames can
still leave a mix; `git checkout` repairs it.
