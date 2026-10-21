---
task: team-link-project-picker
title: "Let `golem team link` pick the portal project from a list, and re-link cleanly to another team or project"
state: queued
owner: agent
size: M
discipline: code
design: "src/cli/commands/team.ts (bindProjectTeam, promptForOrg, chooseOrganization, the link action); src/portal/binding.ts (bindTeam, readTeamBinding, binding.project); src/portal/client.ts (me()); docs/wiki/concepts/Project Team Binding.md. Portal side: PliableSoftware/golem-portal docs/api-contract.md (Projects), docs/projects-plan.md section 12."
gate: "`golem team link` in a TTY lists the chosen team's projects and writes team.project for the one picked; `--project <slug>` skips the prompt; a default pick writes no team.project key; re-running link against a different team replaces team.org_id and never leaves the previous team's team.project behind; a non-TTY or --json run never prompts and reports a stable state for an ambiguous or unknown project; an unreachable or older portal that lacks the projects endpoint links the team exactly as today and says the project was not chosen; tests cover each of these; golem verify exit 0."
depends_on: []
touches: [src/cli, src/portal, tests, docs/wiki]
created: 2026-10-21
---

## What this is

A repo names its portal project with `team.project` in the committed `.golem/settings.json`. Today the only way to set it is to type the slug by hand: `golem team link` chooses the team (prompting when the person is in several, or taking `--org`) and never touches `team.project`. A new admin has to leave the terminal, find the slug on the portal's project page, and edit JSON. A typo is a silent fall back to the default project (the response carries `project: "not_found"`, which `golem team status` reports, but only if the person thinks to run it).

Running `golem team link` again is already the way to move a repo to another team. Two things about that path are unverified or wrong today and belong in this task:

1. It is not confirmed that `bindTeam` replaces an existing `team.org_id`. Check, and make it do so with a clear line saying which team the repo moved from and to.
2. `link` never reads or clears `team.project`. Moving a repo from team A to team B leaves A's project slug in the file. On B that resolves as `not_found` and falls back to B's default project, which is quiet and wrong. A slug is only meaningful inside one team.

## What to build

1. **Portal call.** A new client method for `GET /api/v1/orgs/{orgId}/projects`. This endpoint does not exist yet; the portal ships it first, so this task is blocked in practice until the portal release is out (see "Portal side" below). The proposed shape, which the portal will confirm in `docs/api-contract.md`:
   ```json
   { "projects": [ { "slug": "default", "name": "Default", "description": "", "default": true } ] }
   ```
   Non-archived projects only, default first, then by name. Archived projects are left out because a repo naming one gets the default anyway. Treat unknown fields as ignorable and an unknown error `code` as a generic failure of its status, as everywhere else.
2. **Prompt.** After the team is settled, list that team's projects (`describeProject`: name, slug, and the description if there is one) and ask which one this repo uses. Enter or the default entry means the default project. Same rules as `promptForOrg`: only in a TTY, never with `--json`.
3. **Flags.** `--project <slug>` skips the prompt. A slug the list does not contain is refused with the list of valid ones (an unknown slug is exactly the typo this task exists to remove). Give `--project default` a defined meaning: remove `team.project` rather than write the string `default`, so the committed file stays minimal and the portal's own fallback does the work.
4. **Write.** `team.project` goes into the same project-scope committed file as `team.org_id`, written by the same function, so the two cannot disagree about which file they live in.
5. **Re-link.** When the chosen team differs from the existing `team.org_id`, replace it and drop any `team.project` that was not explicitly chosen in this run, and say so. When the team is the same and no `--project` was given, keep the existing `team.project` and offer it as the default pick instead of resetting it.
6. **Outcome states.** Extend `BindOutcome` with the project result, so `--json` consumers can tell `chosen`, `default`, `skipped_non_interactive`, `unknown_project` and `projects_unavailable` apart. A silent no-op is worse than an error: a link that records the team but not the project must say that the project was not recorded and why.
7. **Degrade.** If the endpoint is missing (older portal), unreachable, or answers `402`/`403`, the team link still succeeds exactly as today and the output names the one thing that did not happen. A project list must never be able to stop the team link, in the same spirit as the failure-mode table in `Project Team Binding.md`.
8. **Status.** `golem team status` already explains which project resolved and why. Make sure it still reads correctly after a re-link, in particular that a cleared `team.project` reads as the default project and not as a fallback.

## Tests

- TTY pick writes `team.project`; default pick writes none.
- `--project` known, unknown and `default`.
- Re-link to another team removes the old slug; re-link to the same team keeps it.
- Non-TTY and `--json` never prompt.
- Endpoint 404, 5xx, 402, 403 and a network failure each leave the team linked and report the project as not chosen.
- A fake portal serving the proposed response shape, so the test does not depend on the real portal.

## Out of scope

- Creating a project from the CLI. Projects are managed by team admins in the portal, and a member who is not an admin cannot create one.
- Per-project roles, which the portal has deferred.
- Changing how `team.project` is resolved at sync time. That shipped in v0.56.0.
- Showing archived projects. They can be added behind a flag later if anyone asks.

## Portal side (tracked there, not here)

The portal adds `GET /api/v1/orgs/{orgId}/projects` to the v1 contract: any entitled member of the team may call it (the settings and skills reads are already member-level; admin is only needed to change things), membership checked against Clerk on every request as for the other v1 routes, `403 not_a_member` indistinguishable from a missing team, `402 subscription_required` for a lapsed one. It returns the non-archived projects with `slug`, `name`, `description` and `default`. The portal will note the release in `docs/api-contract.md` and the harness reads that contract rather than this paragraph.
