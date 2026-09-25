# DUST1.10 — portal, team layer, Buzz, remote/hosted sessions: audit findings

Status: IN PROGRESS (draft committed early per task brief). Read-only audit, 2026-09-25,
branch `dust/DUST1.10` off `development` @ `fd3aedc`.

## Findings so far (portal / team layer)

- `loadConfigWithTeamLayer` is called only by `src/cli/status-collect.ts:145` and
  `src/cli/commands/proxy.ts:191`; ~45 other `loadConfig` call sites do not apply the team layer.
- `src/cli/proxy-runtime.ts:217` dial hot-reload uses plain `loadConfig` (`reloadDials: true` at
  `src/cli/commands/proxy.ts:314`), so a team-set `compression.*`/`brevity.*` is lost after the first reload.
- `src/portal/team-skills.ts:83-89` uses `.optional()` for wire fields; `team-layer.ts:101-104` records
  that the live portal sends `null`, which `.optional()` rejects.
- 200-with-non-JSON: `team-skills.ts:199` → `unreachable`; `team-layer.ts:847` → `api_error`.
- `src/buzz/acp-agent.ts:75,102,139`: a `session/cancel` with no turn in flight poisons the next turn.
- Stale comments: `src/cli/init-team.ts:80`, `:163-164`.
