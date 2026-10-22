---
title: Team link project picker — portal projects in the CLI
type: debrief
tags: [team, portal, cli, binding]
sources: [docs/plan/tasks/team-link-project-picker.md, src/cli/commands/team.ts, src/portal/binding.ts, src/portal/client.ts, src/config/write-setting.ts, tests/unit/cli/team-link-project.test.ts, tests/unit/portal/binding-portal-project.test.ts, tests/unit/portal/client-projects.test.ts, tests/unit/config/write-settings-batch.test.ts, docs/wiki/concepts/Project Team Binding.md]
created: 2026-10-21
updated: 2026-10-21
---

# Team link project picker — portal projects in the CLI

`golem team link` now lists the chosen team's portal projects and prompts which one this repo uses. A new setting `team.project` (slug, e.g. `payments`) is written alongside `team.org_id`. Removes typo risk and eliminates silent fallback to the default project. Portal contract: `GET /api/v1/orgs/{orgId}/projects` returns a list of non-archived projects with `slug`, `name`, `description`, and `default` flag.

## Design decisions

**Atomic writes.** Three separate settings writes (`team.org_id`, `team.project`, and marker keys) became one atomic operation via a new `writeSettings` function in `src/config/write-setting.ts`. The old `writeSetting` function now delegates to it for the single-key path. Reviewed and behaviour confirmed identical; decouples link/unlink operations from any intermediate state.

**Re-link cleanly.** Switching to another team drops the old team's `team.project` slug (a slug is only meaningful inside one team). Same team preserves the slug and offers it as the default pick instead of resetting it. Re-link always updates `team.org_id`, never leaves the previous team's project behind.

**Degrade without stopping.** Portal endpoint failures (404, 402, 403, 5xx, network timeout at 10s) leave the team linked and report the project as not chosen. The team link never blocks on an unavailable portal project list — consistent with [[Project Team Binding]]'s failure-mode principle.

**New exit codes.** Exit 2 added when `--project <slug>` cannot be recorded to settings (e.g. a permission or disk error). Distinct from other exits.

**Non-TTY silent.** Non-TTY runs and `--json` never prompt and never call the project list without an explicit `--project` flag. Reports a stable state for ambiguous or missing project settings.

## What was built

- `src/portal/client.ts` — new `listProjects()` method wrapping `GET /api/v1/orgs/{orgId}/projects`
- `src/cli/commands/team.ts` — prompt after the team is settled (TTY only), list projects with name and description, enter or default entry chooses default project, `--project <slug>` skips prompt and validates slug
- `src/config/write-setting.ts` — new `writeSettings` function for atomic multi-key writes, old `writeSetting` delegates to it
- `src/portal/binding.ts` — `bindTeam` and `readTeamBinding` updated to handle `team.project`, read/clear it on re-link, re-link logic
- `BindOutcome` extended with states `chosen`, `default`, `kept`, `skipped`, `skipped_non_interactive`, `unknown_project`, `projects_unavailable`
- Tests: 573 lines in `team-link-project.test.ts` covering TTY pick, `--project` flag (known/unknown/`default`), re-link to different team and same team, non-TTY/`--json` silence, endpoint failures (404, 5xx, network), a fake portal service
- Tests: 97 lines in `binding-portal-project.test.ts` covering `team.project` read/write/clear
- Tests: 128 lines in `client-projects.test.ts` covering the portal client method

## Defects found and fixed (two review rounds)

**First review (independent):**
1. Portal project list request had no timeout, hung the link. Added 10s timeout.
2. Ctrl-D at the new prompt exited 13 (unhandled EOF). Added EOF handling and settle the prompt.
3. Smaller issues (naming, test assertions).

All fixed failing-test-first.

**Second review:** No blocking defects. Fixes confirmed correct.

## Lessons learned

**New prompts on the common path need EOF and timeout handling from the start.** The new project prompt runs after the team is settled, which is the single-team common case — a production prompt must handle Ctrl-D and must not hang if the source is slow or absent. Testing both conditions from day one would have caught this.

**Portal list must never block the team link.** A ten-second timeout is short enough to be invisible for a fast portal and long enough for the request to succeed in most network conditions. If the list is unavailable, the team is still linked; the project is simply not chosen.

## Verification

- `golem verify` exit 0, 6051 passed / 8 skipped
- Tests cover all gates: prompt in TTY, silence in non-TTY, `--project` validation, re-link logic, endpoint failures, EOF and timeout handling

## Behavioural changes

- `golem team link` now prompts for the portal project in a TTY (unless `--project` is given or the team has only one project, decided by the portal)
- `--project` with `--no-bind` now exits 2 on stderr (previously a thrown error, exit 1)
- Re-link to another team removes the old team's project slug
- Non-TTY run with unknown or missing `team.project` does not prompt, reports skipped

## Remaining edges (unreachable from current callers)

- Retired and live key names in one `writeSettings` call
- Empty `changes` object still rewrites the file
- Portal list timeout starts before token load/refresh, so a slow refresh can consume it

## See also

- [[Project Team Binding]] — the team link contract and failure modes
- [[Team Layer]] — how team settings reach a machine
- [[Settings Cascade]] — origin order and importance

