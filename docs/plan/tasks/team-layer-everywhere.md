---
task: team-layer-everywhere
title: "Apply the team layer on every surface that reads settings, through one loader (USER decision G3)"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md G3 (USER, 2026-10-09); SUMMARY.md contradiction G3; ADR-0008; docs/wiki/concepts/Team Layer.md and Settings Cascade.md. golem status loads the team layer; config, the TUI, VS Code, hooks, MCP and the hot-reload do not."
gate: "Every code path that reads effective settings gets the team layer through ONE loader entry point (no surface rebuilds its own settings view without it): golem status, golem config, the TUI, the VS Code extension's settings read, the hooks, the MCP server and the settings hot-reload; a test per surface family shows a team-set value is visible and enforced there, and that the REMOTE_DENIED_SETTINGS floor still applies; an invalid team value still warns and is skipped and never stops the proxy, a hook or the MCP server (ADR-0008, DUSTSEC.14); a hook must not slow down noticeably (the team layer comes from a cache, measure the added latency per hook call and state it); a project with no team binding behaves exactly as before; golem verify exit 0; an independent read-only review before merge, because it changes what policy is enforced where."
depends_on: []
touches: [src/config, src/portal/team-layer.ts, src/hooks, src/mcp, src/tui, src/cli, vscode-extension, tests]
created: 2026-10-09
---

## What this is

The user decided team policy must apply everywhere, so a member cannot bypass it by using a different command. Find every call site that builds settings without the team layer (grep for `loadConfig` and for any direct reads of the settings files), route them through the shared loader, and prove it with tests. Be careful with hooks: they run on every tool call, so the team layer must come from the local cache and never from a network call on the hook path.

## Out of scope

- Deciding which keys a team may set (see the P4 decision: teams may set `security.*`; the floor stays as it is).
- The portal sync itself.

## Inventory of settings readers (written before any code change, 2026-10-09)

Method: `grep -rnE "loadConfig|loadConfigWithTeamLayer|settingsFilePaths|settings(\.local)?\.json" src vscode-extension`, comments and tests dropped. "Team-aware today" = the call passes through `loadConfigWithTeamLayer` (cache only, no network). The raw `loadConfig` is not.

Surface counts (84 `loadConfig`-family call sites outside the loader, the team-layer module and tests): status 3 (1 team-aware: `status-collect.ts:145`), proxy start 1 team-aware (`commands/proxy.ts:210`, listed under cli), config 7, hooks 2, mcp 1, tui 1, hot-reload 3, cli 67. Only 2 of 84 are team-aware today.

### A. Readers that build effective settings (every one gets converted)

| Site | Surface | Team-aware today |
|---|---|---|
| `src/plugins/redaction-init.ts:29` | cli | NO |
| `src/config/control-surface.ts:95` | config | NO |
| `src/config/control-surface-runtime.ts:24` | config | NO |
| `src/config/control-surface-runtime.ts:158` | config | NO |
| `src/config/control-surface-runtime.ts:175` | config | NO |
| `src/tui/index.ts:85` | tui | NO |
| `src/cli/distill.ts:65` | cli | NO |
| `src/cli/distill-note.ts:63` | cli | NO |
| `src/cli/task-grounding.ts:42` | cli | NO |
| `src/cli/devices.ts:63` | cli | NO |
| `src/cli/local-config.ts:131` | cli | NO |
| `src/cli/local-config.ts:201` | cli | NO |
| `src/cli/persona-sync.ts:54` | hot-reload | NO |
| `src/cli/persona-sync.ts:56` | hot-reload | NO |
| `src/cli/build-knowledge.ts:91` | cli | NO |
| `src/cli/targets.ts:118` | cli | NO |
| `src/cli/targets.ts:232` | cli | NO |
| `src/cli/targets.ts:292` | cli | NO |
| `src/cli/commands/init-uninit.ts:41` | cli | NO |
| `src/cli/commands/init-uninit.ts:146` | cli | NO |
| `src/cli/commands/init-uninit.ts:204` | cli | NO |
| `src/cli/commands/tasks.ts:59` | cli | NO |
| `src/cli/commands/team.ts:74` | cli | NO |
| `src/cli/commands/team.ts:429` | cli | NO |
| `src/cli/commands/team.ts:512` | cli | NO |
| `src/cli/commands/team.ts:703` | cli | NO |
| `src/cli/commands/prompt-guidance.ts:53` | cli | NO |
| `src/cli/commands/prompt-guidance.ts:321` | cli | NO |
| `src/cli/commands/prompt-guidance.ts:328` | cli | NO |
| `src/cli/commands/prompt-guidance.ts:336` | cli | NO |
| `src/cli/commands/prompt-guidance.ts:355` | cli | NO |
| `src/cli/commands/ps.ts:800` | cli | NO |
| `src/cli/commands/proxy.ts:77` | cli | NO |
| `src/cli/commands/proxy.ts:210` | cli | yes |
| `src/cli/commands/proxy.ts:486` | cli | NO |
| `src/cli/commands/proxy.ts:516` | cli | NO |
| `src/cli/commands/session-host.ts:89` | cli | NO |
| `src/cli/commands/session-host.ts:213` | cli | NO |
| `src/cli/commands/mcp-serve.ts:176` | mcp | NO |
| `src/cli/commands/select-target.ts:35` | cli | NO |
| `src/cli/commands/bench.ts:170` | cli | NO |
| `src/cli/commands/bench.ts:237` | cli | NO |
| `src/cli/commands/bench.ts:313` | cli | NO |
| `src/cli/commands/config.ts:59` | config | NO |
| `src/cli/commands/pkg-models.ts:104` | cli | NO |
| `src/cli/commands/pkg-models.ts:128` | cli | NO |
| `src/cli/commands/local-ollama.ts:180` | cli | NO |
| `src/cli/commands/wiki.ts:70` | cli | NO |
| `src/cli/commands/wiki.ts:91` | cli | NO |
| `src/cli/commands/wiki.ts:186` | cli | NO |
| `src/cli/commands/dials-stats.ts:147` | cli | NO |
| `src/cli/commands/device.ts:179` | cli | NO |
| `src/cli/commands/device.ts:211` | cli | NO |
| `src/cli/commands/device.ts:284` | cli | NO |
| `src/cli/commands/session.ts:76` | cli | NO |
| `src/cli/commands/note-dashboard-watch.ts:99` | cli | NO |
| `src/cli/pkg.ts:35` | cli | NO |
| `src/cli/statusline.ts:682` | status | NO |
| `src/cli/dials.ts:77` | cli | NO |
| `src/cli/gateways/credentials.ts:41` | cli | NO |
| `src/cli/gateways/credentials.ts:240` | cli | NO |
| `src/cli/gateways/registry.ts:125` | cli | NO |
| `src/cli/config.ts:60` | config | NO |
| `src/cli/config.ts:89` | config | NO |
| `src/cli/proxy-runtime.ts:218` | hot-reload | NO |
| `src/cli/claude-settings-target.ts:89` | cli | NO |
| `src/cli/fast-path.ts:299` | cli | NO |
| `src/cli/status-collect.ts:145` | status | yes |
| `src/cli/status-collect.ts:504` | status | NO |
| `src/cli/init.ts:530` | cli | NO |
| `src/cli/personas.ts:70` | cli | NO |
| `src/cli/personas.ts:236` | cli | NO |
| `src/cli/gateways.ts:81` | cli | NO |
| `src/cli/gateways.ts:189` | cli | NO |
| `src/cli/gateways.ts:284` | cli | NO |
| `src/cli/synthesize.ts:57` | cli | NO |
| `src/cli/plugin.ts:40` | cli | NO |
| `src/cli/ollama.ts:59` | cli | NO |
| `src/cli/ollama.ts:154` | cli | NO |
| `src/hooks/pre-tool-use.ts:71` | hooks | NO |
| `src/hooks/pre-tool-use.ts:93` | hooks | NO |
| `src/buzz/acp-turn.ts:143` | cli | NO |
| `src/buzz/acp-turn.ts:238` | cli | NO |
| `src/buzz/provision.ts:173` | cli | NO |

Not matched by the grep because they hand the loader's result on or wrap it: `src/portal/team-layer.ts:600,614` (the existing two-pass wrapper, `loadConfigWithTeamLayer`, which becomes the single entry point), and the `typeof loadConfig` type positions in `persona-sync.ts` and `buzz/acp-turn.ts`.

### B. Direct readers of the settings FILES (not through `loadConfig`)

| Site | What it does | Decision |
|---|---|---|
| `src/config/loader.ts:255` `readSettingsFile` | the loader's own file read | the loader; stays |
| `src/config/write-setting.ts:77,139` | read-modify-write of ONE scope file for `golem config set/unset` | excluded: a writer must edit the raw local file, never the merged view |
| `src/config/migrate-files.ts:314` | version migration sweep over the three local files | excluded: rewrites local files |
| `src/portal/binding.ts:349` | reads the committed project `team` section to learn the binding | excluded: `golem team unlink` must report what the PROJECT FILE says, not the resolved value, so it can remove it (the binding is local-only; `team.*` keys are on the remote deny floor) |
| `src/cli/persona-watcher.ts:75-76` | polls the two local files' mtimes for hot-reload | converted: also polls the team cache file, else a `golem team sync` is never seen by a running daemon |
| `src/session/known-projects.ts:129`, `src/cli/init-hooks.ts:112`, `src/cli/init-vscode.ts:70,100`, `src/cli/claude-settings-target.ts:45-46`, `src/cli/status-render.ts:192` | existence check, a .gitignore line, other tools' files, a label string | excluded: no Golem setting value is read |
| `src/cli/init.ts:325,345,346,387,599` | init/uninit read the RAW local/project files: `proxy.port` (explicit port, back-compat), `proxy.upstream_base_url` (idempotent-write check), and marker presence | excluded, precisely: they decide what to WRITE into those two files, so they must see only what the files hold; an effective read would persist env/team values into the local file. This is a real value read (the earlier claim "reads no setting value" was wrong) and is exempted per line in the guard test |
| `src/config/control-surface-types.ts:113-116`, `src/config/ui-model.ts:337,695` | scope labels and prose | excluded: strings |
| `vscode-extension/extension.js` (stats/status/config) | shells out to `golem status/stats --json` and `golem config set/unset` | no change needed: covered by the CLI conversion; the extension reads no settings file itself |
| `src/config/control-surface-settings.ts` | control-surface (config UI) view | goes through `control-surface-runtime.ts` loads (section A) |

### Outcome (2026-10-09)

- Entry point: `loadEffectiveConfig` (`src/config/effective.ts`), cache only, lazy team import for linked projects. `loadConfigWithTeamLayer` is gone (moved and renamed). The raw `loadConfig` stays exported only for the cascade's own tests; a guard test enforces it.
- Counts: 84 section-A sites, 2 team-aware before, 82 converted; section B: 12 direct file readers, 1 converted (`persona-watcher`, now also polls `~/.golem/teams/`), 11 deliberately excluded with reasons above.
- Hook latency (fresh measurement, in-process, 30 runs): unlinked +0 ms (raw 1.9 ms vs 1.25 ms, noise); linked with cache +4.4 ms per call (5.5 ms vs 1.1 ms); first linked call in a fresh process ~18 ms for the lazy `team-layer` import. No memo: the cache file is re-read per call, so staleness is zero beyond the last `golem team sync`.
- Tests: `tests/unit/config/team-layer-everywhere.test.ts` (29: status, config get/list, TUI, MCP, two hook reads, dial reload, persona watcher) and `tests/unit/config/loader-entry-point.test.ts` (3, the bypass guard).

### Review fixes (2026-10-09, independent review)

- Interim stricter-only floor (P4): `plugins.enabled`, `plugins.load`, `telemetry.dashboard_lan`, `proxy.upstream_base_url` added to `REMOTE_DENIED_SETTINGS`; `security.write_lan` and `security.join_injection` may be set by a team to `false` only (`REMOTE_FALSE_ONLY_SETTINGS`, `src/config/loader.ts`). The per-key direction table stays in `team-security-stricter-only`.
- `leafSchema` and the section check use `Object.hasOwn`; `translateTeamRows` drops a `__proto__` leaf; `loadEffectiveConfig` falls back to the local result with a warning if applying the layer throws anything.
- Guard test is per LINE, covers single quotes, template literals, `files.local` style reads, and fails on stale exemptions.
- `writeTeamLayerCache` uses `replaceViaTemp`.
- `team.notice` for a linked team that is NOT applied (sync off, no cache, portal denial) is appended to `warnings` inside `loadEffectiveConfig`, so status, TUI, config (now printed on stderr and carried in `--json`), MCP (stderr) and the proxy all show it.

### Second review (2026-10-09): the deny-list is replaced by a default-deny table

- `src/config/team-policy.ts` classifies every one of the 78 schema leaves (settable, false-only, true-only, lower-only, narrow-roots, denied); unknown keys are denied; `TEAM_POLICY` is a total `Record` over the schema's leaf paths and `tests/unit/config/team-policy.test.ts` fails when the schema has a leaf with no class. `REMOTE_DENIED_SETTINGS` and `REMOTE_FALSE_ONLY_SETTINGS` are derived from it. The interim lists from the first review are gone.
- Relative rules (`lower-only`, `narrow-roots`) are judged in the loader against the member's own value at the moment the team layer applies; the loader reports refused keys in `GolemConfig.refused`, and `loadEffectiveConfig` removes them from `team.applied`.
- `translateTeamRows` reports policy-refused rows as `REFUSED:` in `skipped` (so `golem team sync` lists them as refused) and settles duplicate keys last-wins before judging.
- `loadEffectiveConfig`: a ConfigError stays the loader's quiet "SKIPPED"; any other throw returns the local result but is LOUD: warning `TEAM POLICY NOT APPLIED`, `teamFailure` on the result, one stderr line per process.
- `readTeamLayerCache` returns null only for ENOENT or a corrupt file; sharing violations are retried (win32, via `win-fs-retry`) and then thrown, which the loader path reports as above.
- Examples swapped in existing tests: none beyond the first review's `security.join_injection` -> `snooze.enforce` (both still settable by a team: `snooze.enforce` is true-only and the tests send true).

### Third review (2026-10-09): table corrections

- `plugins.enabled` denied (false disables org redaction plugins); `compression.force_semantic_on_caching`, `knowledge.read_skeleton_enabled` false-only; `compression.level` lower-only over off < 1 < 2 < 3 against the member's effective value; `knowledge.enabled`, `local_answer_enabled`, `rerank_enabled` false-only; `brevity.level` denied; every timeout denied (`proxy.request/connect/idle_timeout_ms`, `inference.request_timeout_ms`, `knowledge.lsp_timeout_ms`; availability is the member's call and no floor is justified). `portal.link_timeout_ms` stays settable: the sign-in wait is a convenience with no security weight (ADR-0008 floor note, locked by `tests/unit/portal/settings.test.ts`).
- `knowledge.auto_index_max_files`: a team may not send 0 (no cap) unless the member's value is 0.
- `narrow-roots` matches the consumer (`device-sessions.ts` exact membership after `resolveWorktreeRoot`): every team root must equal a member root after resolving; relative entries refused; descendants refused.
- Member-relative rules now run after Zod, so the dry run and the real pass cannot disagree (user 67108864 + team 40000000.5 used to throw).
- REFUSED warnings print the value only for boolean, number and level rules; never for denied keys or roots. Test uses a URL with a password and an API-key-shaped string, built at runtime, across load warnings, refused/skipped lists, status, the control surface, MCP stderr and translate output.
- Examples swapped in existing tests: the hot-reload surface row now has the member at level "3" and the team at "1" (a team may only lower); the cascade test "puts a normal team value above user" has the user at "3" (was "off") so the team's "1" is a lowering.
- The totality guard is the type plus `team-policy.test.ts`, not the loader-entry-point guard.

### Fourth review (2026-10-09): honesty and leaks

- A skipped layer (invalid value) now yields `applied: []`, `GolemConfig.teamSkipped`, and a warning saying "team policy is NOT in force" on every surface.
- Invalid-value errors from a REMOTE origin carry the key only ("the value is not shown"): Zod's "received ..." text is gone. A member's own invalid value still shows detail.
- `knowledge.auto_index_max_files`: with a member cap of 0, any positive team number is accepted as a tightening.
- `team.applied` is reconciled against what the loader resolved: refused, overridden (by the winning member layer) and unknown rows move to `skipped`.
- `knowledge.repo_map_enabled` and `knowledge.syntax_aware_chunking` are false-only.
- Policy refusals are omitted from the portal's `unknown_keys` (the portal contract in `team-settings-layer.md` defines only that field); `golem team sync` marks member-relative rows `[pending]`.
