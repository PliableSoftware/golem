---
task: DUSTSEC.16
title: "Canonical npm name is @pliable/golem — move every consumer off golem-run"
state: done
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md A1/S1 (USER, 2026-10-08); SUMMARY.md S1; DUST1.1 h8, DUST1.8 h1, DUST1.11 rows 14/74/80"
gate: "`golem update` checks @pliable/golem and reports the published version (before: 404 on golem-run); install.sh / install.ps1 npm rung installs @pliable/golem; ps detection matches a process started from the new package; `git grep -n golem-run` returns only intentional mentions (history, the deprecation note, the user task). golem verify green by exit code; golem wiki check green."
depends_on: []
touches: [src/update/index.ts, src/cli/commands/status-update.ts, src/cli/commands/ps.ts, src/cli/init-vscode.ts, install/install.sh, install/install.ps1, package-lock.json, README.md, CLAUDE.md, docs/golem-spec.md, docs/wiki/concepts/Release Pipeline.md, docs/plan/tasks/R7.5.md]
created: 2026-10-08
updated: 2026-10-08T10:26:15.273Z
---

## What this is

`package.json` `name` became `@pliable/golem` in `2fc7cd2` (2026-09-23); `@pliable/golem@0.54.2`
is published and `golem-run` is a 404 (checked 2026-09-26). Every consumer still names `golem-run`,
so `golem update` is broken and the installers would install whoever squats the old name.

**USER decision (verbatim, A1/S1):** canonical npm name is `@pliable/golem`. Agent task: update
`golem update` (`src/update/index.ts:22`, `status-update.ts:83`), installers (`install/install.sh`,
`install/install.ps1`), `package-lock.json`, `ps` detection (`src/cli/commands/ps.ts`), VS Code
extension id prefix (`init-vscode.ts:194`), README, CLAUDE.md, spec D16/D19/D41 + §2.1/§6, the
Release Pipeline wiki page, the R7.5 gate. The user claims `golem-run` themselves.

## Evidence

- `src/update/index.ts:22` `PACKAGE_NAME = "golem-run"`; `src/cli/commands/status-update.ts:83`
- `install/install.sh:53-56`, `install/install.ps1:39-43`
- `src/cli/commands/ps.ts:388`, `:426`; `src/cli/init-vscode.ts:194`
- Release Pipeline drift 1.8/r073 (`golem-run-<version>.tgz` asset)

## The work

1. Code first (update, ps, init-vscode), then installers, then `package-lock.json` (regenerate via
   npm, do not hand-edit), then docs.
2. **Scoped-name traps:** the registry URL for a scoped package encodes the slash
   (`@pliable%2fgolem`); the release tarball name changes (`pliable-golem-<v>.tgz`) — check the
   release workflow's asset list and the portal webhook/asset contract for the old filename;
   `ps` matching must handle the `@pliable/golem` path segment on all three OSes.
3. VS Code extension id prefix: confirm what the marketplace id actually is before changing it;
   if the extension's own id did not change, say so and leave it.
4. Docs: README install line, CLAUDE.md "What this project is", spec D16/D19/D41 and §2.1/§6
   (name edits ONLY — the full spec rewrite is DUST2.2, which depends on this task), Release
   Pipeline page, R7.5 gate text.
5. Do NOT publish, deprecate or claim anything on npm — that is `npm-claim-golem-run` (owner: user).

## Hard rules

- Cross-platform: installers and `ps` tested/considered on Linux, macOS, Windows.
- Never hand-edit a version (`scripts/release.mjs` owns versions).

## Out of scope

- Any outward-facing npm action. Other Release Pipeline drift rows (DUST2.6).

## Verification bar

`golem verify` green by exit code; `golem wiki check`. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
