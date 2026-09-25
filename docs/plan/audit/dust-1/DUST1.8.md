# DUST1.8 — config, init, install, release and vibe: audit findings

Status: IN PROGRESS (interim commit). Sections below grow as the audit completes.

## Interim findings so far

- Settings Cascade "team origin is a slot, not a feature" — DRIFTED: `team-layer-fetch` shipped
  (`src/portal/team-layer.ts:596` `loadConfigWithTeamLayer`, called at
  `src/cli/commands/proxy.ts:191`, `src/cli/status-collect.ts:145`).
- Failure rule ("nothing about a team link may stop the proxy starting") — CONTRADICTED by code: a
  cached team row with an invalid value reaches `applyObjectLayer` and throws `ConfigError`
  (`src/config/loader.ts:625-631`); `translateTeamRows` (`src/portal/team-layer.ts:180-220`) does no
  value validation; no catch in `loadConfigWithTeamLayer` or `runProxyForeground`. Probed
  2026-09-25: `teamLayer: {settings: {compression: {level: "9"}}}` → `ConfigError`.
