---
title: Portal Projects — settings, skills, and fallback
type: debrief
tags: [portal, team, settings, skills]
sources: [docs/plan/tasks/team-portal-projects.md, docs/decisions/ADR-0008-settings-cascade-and-importance.md, docs/wiki/concepts/Settings Cascade.md, src/portal/team-project.ts, src/cli/team-skills.ts, tests/unit/portal/team-portal-projects.test.ts, tests/unit/cli/team-skills-portal-projects.test.ts]
created: 2026-10-21
updated: 2026-10-21
---

# Portal Projects — settings, skills, and fallback

Repos now name their portal project explicitly, and Golem fetches that project's settings and skills from the portal. A project is a named group of settings and skills on the portal, shared by one or more repos. Default behaviour (no project named) unchanged: each repo gets the team's default project.

## Part 1: Documentation amendments (user-approved)

- ADR-0008 amended to clarify that any origin may declare `!important`, and importance reverses origin order (see [[Settings Cascade]])
- [[Settings Cascade]] rewritten: portal projects group repos, the repo file names one project per repo, cascade unchanged

## Part 2: Implementation

**New setting.** `team.project` (slug, e.g. `payments`) in the `team` section next to `team.org_id`. Published in the config schema. Empty = default project, exactly as today. Inert when `team.org_id` is unset (zero portal I/O).

**Fetch.** When the key is set, requests `GET {portalUrl}/api/v1/orgs/{orgId}/projects/{slug}/settings` and `.../skills`. Falls back to existing endpoints when the key is not set, returning the default project. Existing endpoints stay byte-identical on the portal side.

**Scope.** Resolves inside the caller's team only. Team comes from the link, never from the repo file.

**Failure table.** Portal answers missing/deleted/archived projects with the default project's data plus a `project` field stating `not_found` or `archived`:

| Situation | Behaviour |
|---|---|
| Key not set | Existing behaviour, default project |
| Project found | Use it |
| `project: not_found` (missing, deleted, or another team's) | Use data returned (default project), warn once per slug naming it |
| `project: archived` | Same, warn once |
| Caller not in team, no seat, subscription not active | Existing refusal. Ignore project name. Local settings only |
| Portal unreachable or 5xx | Existing retry then last known good (keyed per project, different cache per project) |
| 4xx other than the above | Do not retry. Status codes are instructions to the sender |
| `team.project` set but no `team.org_id` | Zero portal I/O, as today |

**Skills.** Project skills land flat in `.claude/skills/golem-team-<name>/SKILL.md`. Switching projects removes the previous project's managed skills and writes the new ones, never touches anything outside the `golem-team-` prefix. Org-wide denial stamped into the cache file (`denied` field, date + reason).

**Warn-once.** Recorded in the per-portal-project cache file (`project_warned` field). Once per slug per session, never on every sync.

**Cache.** Per-portal-project cache files keyed by `(portal_url, org_id, project_slug)`. Separate cache per project avoids serving a different project's last-known-good.

**Skills outage.** Switching projects after a skills 4xx error (e.g. portal down): keeps the old project's skills on disk with a notice that the new project's skills could not be fetched, so the session works. User decision: not fetching stale skills at startup when a 4xx cached failure exists.

**API error handling.** When the settings endpoint returns 4xx (not 404, not overloaded), the cache file (`denied` field) records it, and subsequent fetches refuse the project without retrying until the cache expires or is cleared. Skills endpoint 4xx does NOT block settings: settings succeed, skills stay unchanged (old project's skills kept, none applied for new project).

**`golem team status`** shows which portal project resolved and why, including fallback reason.

## Defects found and fixed (independent review)

Six defects reported by independent review, all fixed failing-test-first:

1. **Org-wide denial stamp.** Cache file now records `denied` on 4xx with reason, enforced on read. Settings refuse the project without retry when cached denial exists.
2. **Skills 4xx wipes installed skills.** Changed: 4xx on skills keeps old skills on disk, not empty set.
3. **Slug case/cache mismatch.** Slug validated strictly (`/^[a-z0-9][a-z0-9-]{0,63}$/`), cache key matching tightened.
4. **Per-process warn-once.** Warn-once now recorded in cache file (`project_warned` field), survives session restart.
5. Low-severity items (naming, error messaging).

## Verification

- `golem verify` exit 0, 5965 passed / 8 skipped
- One unrelated load flake observed: `tests/integration/device-interrupt-remote.test.ts` unhandled ENOENT in teardown, passed 3/3 in isolation and on rerun

## Open contract points (portal side, not yet sent)

Portal has not yet confirmed:
- `project` field assumed absent/null (new response field)
- Slug charset and length constraints
- 404 on `/projects/` routes from older portal versions (keeps existing skills)

## Hard rules (per task spec)

- Cascade stays authoritative: no new origin added to `ORIGIN_ORDER`
- Named project that fails to apply is reported: never a silent no-op
- No claim that project or `enforced` is a lock or cannot be overridden
- No marketing claim until shipped (do not add to `docs/marketing/CLAIMS.md`)

## See also

- [[Settings Cascade]] — the seven origins and two bands
- [[Team Layer]] — how team settings reach a machine
- ADR-0008 — any origin may declare `!important`, importance reverses origin order (see `docs/decisions/ADR-0008-settings-cascade-and-importance.md`)
