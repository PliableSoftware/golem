---
task: team-portal-projects
title: "Portal projects: a repo names a portal project and Golem fetches that project's settings and skills"
state: queued
owner: agent
size: L
discipline: code
design: "ADR-0008 (settings cascade and importance); docs/wiki/concepts/Settings Cascade.md lines 40-45 (the sentence this reverses); src/portal/binding.ts (team.org_id and team.portal_url are committed at project scope); src/portal/team-layer.ts; src/cli/team-skills.ts. The portal side is specified in PliableSoftware/golem-portal docs/projects-plan.md."
gate: "Part 1 (docs): ADR-0008 amended or superseded and the Settings Cascade page rewritten, reviewed by the user before part 2 starts. Part 2 (code): a repo whose committed settings name a portal project receives that project's settings and skills as the team origin; a repo naming none receives the default project's exactly as today; every failure case in the table below degrades to the documented fallback with a single warning and never blocks a session. Failing-first tests cover each row of the table, and a project name with no team.org_id performs zero portal I/O. golem verify exit 0."
depends_on: []
touches: [src/portal, src/config, src/cli, docs/wiki, docs/decisions, tests]
created: 2026-10-21
---

## What this is

The golem-portal is adding **projects**. A portal project is a named group of Golem settings and skills that applies to one or more code repos. It is unrelated to the `project` settings origin here (a repo's `.golem/settings.json`), and the two must never share a word in user-facing text or in code names. Suggested internal name for the portal concept: "portal project".

There is no team-wide settings layer any more. Each portal project has its own settings and skills, a team always has a default project, and a project can be cloned. A project's settings reach the machine as the **existing team origin**. The cascade, `enforced` and `important` semantics, and the ranking in `ORIGIN_ORDER` do not change.

A repo joins a project by naming it in its committed `.golem/settings.json`, beside `team.org_id` and `team.portal_url`, which `golem team link` already writes at project scope. Naming a project is a choice, not access control: anyone who can edit the repo can name any project in their own team.

## Part 1: docs first (blocks part 2)

- `docs/wiki/concepts/Settings Cascade.md` lines 40-45 say "Per-project team values are deliberately not a feature". That was written when the only project was the repo. Rewrite it for the new meaning: a portal project groups repos, the repo file only names one, and the cascade is unchanged.
- ADR-0008 amend or supersede, whichever the repo's ADR convention prefers. Do not leave the two disagreeing.
- Present both to the user before starting part 2.

## Part 2: code

1. **A new setting** that names the portal project, in the `team` section next to `team.org_id` (suggested `team.project`; the harness owns the final name). It must appear in the published schema, because the portal fetches the schema and never copies it.
2. **Fetch.** When the key is set, request `GET {portalUrl}/api/v1/orgs/{orgId}/projects/{slug}/settings` and `.../skills`. When it is not set, use the existing endpoints, which return the default project. Existing endpoints stay byte-identical on the portal side.
3. **Resolve inside the caller's team only.** The team comes from the link, never from the repo file.
4. **Failure table.** The portal answers a not-found or archived project with the default project's data plus a `project` field stating `not_found` or `archived`. Treat it like this:

| Situation | Behaviour |
|---|---|
| Key not set | Existing behaviour, default project |
| Project found | Use it |
| `project: not_found` (missing, deleted, or another team's, deliberately indistinguishable) | Use the data returned (default project), warn once per slug naming it |
| `project: archived` | Same, warn once |
| Caller not in the team, no seat, subscription not active | Existing refusal. Ignore the project name. Local settings only |
| Portal unreachable or 5xx | Existing retry then last known good. Last known good is keyed per project, so a different project's cache is never served |
| 4xx other than the above | Do not retry (status codes are instructions to the sender) |
| `team.project` set but no `team.org_id` | Zero portal I/O, as today |

Decided behaviour, recorded here so it is not re-derived: an outage after a switch keeps the previous portal project's skills on disk, with a notice naming whose they are, because an unreachable portal never changes local state. And "warn once" means once per slug until the fallback reason changes, recorded as a `project_warned` marker in that portal project's cache file (cleared when the portal project resolves as found), not once per process.

5. **Skills.** Project skills land exactly where team skills land today, flat as `.claude/skills/golem-team-<name>/SKILL.md`. Switching a repo from one project to another must remove the previous project's managed skills and write the new ones, and must not touch anything outside the `golem-team-` prefix.
6. **`golem team status`** (or its equivalent) shows which project resolved and why, including the fallback reason.
7. **Warn once** means once per slug per session, never on every sync.

## Hard rules

- The cascade stays the authority here. Do not add a new origin to `ORIGIN_ORDER`.
- A silent no-op is worse than an error: a named project that fails to apply is reported.
- Never write that a project, or `enforced`, is a lock or cannot be overridden. A member's own `~/.golem` important declaration still wins.
- No marketing claim until this ships (`docs/marketing/CLAIMS.md`).

## Out of scope

- Connectors, billing and seats: team-wide, unchanged.
- Any client-side access control for projects. Per-project roles are deferred in the portal.
- Building the portal side (tracked in golem-portal).

## Notes for whoever picks this up

- Portal repo: `/root/golem-portal`, plan at `docs/projects-plan.md`. The endpoint paths and response field above are the portal's planned contract, not yet built. If the harness needs a different shape, say so before the portal builds it.
- Drift to fix while here, in the portal's docs rather than this repo: they say team skills sync into `.claude/skills/golem-team/<name>/`, but this repo writes the flat `golem-team-<name>/` form (`src/cli/team-skills.ts`).
