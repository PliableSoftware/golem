# DUST1.8 — config, init, install, release and vibe: audit findings

Status: COMPLETE (2026-09-25). Read-only audit of branch `development` @ `fd3aedc`.
Every claim below was checked against `src/` or the workflows; "probe" means a throwaway
script run against the unmodified source with `tsx` (no repo file touched). No full suite was run.

## Bucket counts

| class | count |
|---|---|
| shipped-and-matches | 50 |
| shipped-but-drifted | 17 |
| partial | 8 |
| not-started | 3 |
| dead-or-superseded | 3 |
| **total classified** | **81** (+1 unverifiable: D41c) |

Plus 5 **Dead candidates** in code and 18 **Stale comments**, listed in their own sections.

Most serious first, the five findings that change behaviour rather than wording:

1. **Package name split.** `package.json` is `@pliable/golem` (renamed in `2fc7cd2`, a `fix:`
   commit about model shapes, 2026-09-23). `golem update`, both installers, the lockfile, CLAUDE.md,
   spec Decision 19/41 and the Release Pipeline page all still say `golem-run`. `golem update`
   therefore checks and installs a package the release no longer publishes.
2. **A team payload can stop the proxy starting.** A cached team row with an invalid value
   throws `ConfigError` through `loadConfigWithTeamLayer` into `runProxyForeground` (probed).
3. **Team policy is invisible to `golem config` and the whole control surface.** Proxy and
   `golem status` load the team origin; `golem config list/get/set`, the TUI panel, the VS Code
   webview and `config schema` use plain `loadConfig`, so `team!` locks never render and a write
   overridden by `team!` is not reported.
4. **`inference.worker_targets` retirement is unreachable.** Listed in `RETIRED_SETTINGS` (should
   raise), still a live schema leaf (so it never does), still read by status/local-config, and a
   test comment claims a third behaviour (warning). Loads silently (probed).
5. **Duplicate control rows.** `SettingMeta.ownedBy` is never set, so `compression.level` and
   `inference.model` render both as runtime controls and as settings rows (probed); the
   `ownedBy` test passes vacuously.

## Feature table

`CS` = wiki `concepts/Configuration Surfaces.md`, `SC` = `concepts/Settings Cascade.md`,
`VG` = `concepts/Personal Vibe Guide.md`, `RP` = `concepts/Release Pipeline.md`,
`D<n>` = spec Decision n, `§5.1` = spec §5.1, `ADR8` = ADR-0008, `CM` = CLAUDE.md.

### Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Seven origins, one `ORIGIN_ORDER`, pass 1 forward / pass 2 reversed | SC "Where it lives"; ADR8 §The two bands; D62(a)(b) | `src/config/loader.ts:98-106`, `:284-313` | `tests/unit/config-cascade-importance.test.ts:51`, `:134-186` | shipped-and-matches | | — |
| `"!important"` sibling array; unlisted key warns, malformed list throws | SC §Syntax; ADR8 §Syntax; D62(f) | `loader.ts:488-507`, `:491-497` | cascade test `:234`, `:249`, `:262` | shipped-and-matches | | — |
| env/override contribute normal only; file `!important` beats `GOLEM_*` | SC §GOLEM_*; ADR8 §The env reversal; D62(d) | `loader.ts:285-298` (env only in pass 1) | cascade test `:188`, `:203`, `:217` | shipped-and-matches | | — |
| `default!` is the floor for future non-negotiables | SC "The floor gets a home"; ADR8 §The floor (3) | nothing produces a default-band important declaration; defaults seeded at `loader.ts:233-242` with no important set | none | not-started | Slot only — ordering defined, no mechanism emits `default!`. Fine as intent, but SC/ADR8 read as if available. | none |
| `REMOTE_DENIED_SETTINGS` compiled in, dropped with `REFUSED` warning, re-checked after rename | SC §The floor; ADR8 §The floor (1)(2) | `loader.ts:144-153`, `:559-562`, `:614-619`, `:661-666` | cascade test `:295-331`; probe: denied key → REFUSED warning | shipped-and-matches | Doc names only `proxy.bypass_all`; code also denies `portal.url/issuer/client_id` and four `team.*` keys — docs lag, code looks right. | — |
| `LayerName` gains `team`; `ProvenanceEntry.important?: true` | SC §Provenance; ADR8 §Provenance | `loader.ts:81`, `:179` | cascade test `:65` | shipped-and-matches | | — |
| Team value provenance names the team | SC §Provenance; ADR8 | `src/portal/team-layer.ts:397`, `:511` (`teamLayerSource`) → `loader.ts:264` source | `tests/unit/portal/team-layer.test.ts` | shipped-and-matches | | — |
| "The team origin is a slot, not a feature … nothing fetches one yet" | SC "Where it lives" (last para); loader comment `loader.ts:90-93` | `src/portal/team-layer.ts:596-616` `loadConfigWithTeamLayer`, called at `src/cli/commands/proxy.ts:191`, `src/cli/status-collect.ts:145` | `tests/unit/portal/team-layer.test.ts` | shipped-but-drifted | `team-layer-fetch` shipped 2026-09-07 (SHIPPED.md row). Doc is stale; code is right. | — |
| Failure rule: nothing about a team link may stop the proxy starting | SC "What did not change"; ADR8 §What this does NOT change | `team-layer.ts:180-220` `translateTeamRows` does no value validation; `loader.ts:625-631` throws on invalid value; no catch at `team-layer.ts:614` or `proxy.ts:191` | none. **Probe:** `teamLayer {compression:{level:"9"}}` → `ConfigError: team X: invalid value for "compression.level"` | shipped-but-drifted | Code breaks the rule; comment at `proxy.ts:185-186` says "unable to fail". Doc side is right. | none |
| Pinned control renders locked with origin + recourse (`IMPORTANT_LOCKED`) | SC §Provenance; ADR8 §Provenance and the UI | `src/config/control-surface-types.ts:135-152`; used `control-surface-settings.ts:98-105` | `tests/unit/config-ui-model.test.ts` (partial) | partial | Mechanism exists, but the surface reads plain `loadConfig` (`src/cli/config.ts:4`, `:60`, `:89`; `control-surface-runtime.ts:24`), so a `team!` lock can never appear. Runtime compression control only checks `env` (`control-surface-runtime.ts:32`), ignoring importance. | none |
| `ApplyResult.overridden` reported for writes the cascade overrules | SC §Provenance; ADR8 | `control-surface-settings.ts:165-173`; `src/cli/config.ts:303` | `tests/unit/cli/config.test.ts` | partial | Blind to team (same cause). `sameValue` compare also reports a false "overridden" for merge-per-key `inference.personas` whenever a lower layer holds other personas (`config.ts:303` vs `loader.ts:372`). | none |
| Team cache per org `~/.golem/teams/<org_id>.json` | SC (D63 note); ADR8 amendment; D62(a) amended | `team-layer.ts:223`, `:305` | team-layer test | shipped-and-matches | | — |
| Hierarchy user → project → local → env → per-request headers | §5.1; D19 config line; D11 | `loader.ts:98-106`, `src/config/paths.ts:15-31` | `tests/unit/config-precedence.test.ts` | shipped-but-drifted | §5.1 and D19 omit `team`, and "env" is no longer above every file layer (D62). Spec §5.1 is stale; code right. | — |
| User scope is literal `~/.golem`, not env-paths | D19; VG §Where it lives | `paths.ts:20-23` | `config-precedence.test.ts` | shipped-and-matches | | — |
| `GOLEM_<SECTION>_<KEY>` env mapping | D19 | `src/config/env.ts:1-38` | `tests/unit/config-env.test.ts` | shipped-and-matches | | — |
| Retired keys raise, renamed keys migrate before importance | ADR8 §What this does NOT change | `loader.ts:575-620`; `migrations.ts:41-61`, `:91-104` | `tests/unit/config-migrations.test.ts` | partial | `inference.worker_targets` is in `RETIRED_SETTINGS` (`migrations.ts:98-103`) but still a leaf (`schema.ts:303`, default `:1082`), so `retirementFor` is never reached. **Probe:** a file with `worker_targets` loads with zero warnings. Test comment `config-migrations.test.ts:52-54` claims "kept as a deprecated leaf with a warning" — a third, also untrue, story. Still read by `status-collect.ts:242`, `local-config.ts:140`. | none |
| Existing installs resolve identically when nothing is important | SC last para; ADR8 Consequences 5; D62(f) | `loader.ts:305-313` (pass 2 skipped when set empty) | cascade test `:65` | shipped-and-matches | | — |

### Configuration Surfaces (CS)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `SETTING_META satisfies {[P in LeafPath]: SettingMeta}` — missing key is a compile error | CS §1 | `src/config/ui-model.ts:31-36`, `:787` | tsc | shipped-and-matches | | — |
| `deriveKind` from zod (toggle/enum/url/text/list/opaque), `kind` override for colour | CS §1 | `ui-model.ts:86-97`, `:609` | `config-ui-model.test.ts` | shipped-and-matches | | — |
| `SECTION_META` title/summary/order | CS §1 | `ui-model.ts:810-861` | `config-ui-model.test.ts` | shipped-and-matches | | — |
| `ownedBy` omits a runtime-owned key; "nothing is editable from two rows at once" | CS §1 | field declared `ui-model.ts:149`; filter `control-surface-settings.ts:50`; **no `ownedBy:` value anywhere in `SETTING_META`** | `config-ui-model.test.ts:44-55` passes vacuously | shipped-but-drifted | **Probe:** `settingControlGroups` emits `setting:compression.level`, `setting:inference.model`, `setting:brevity.level`, while `runtimeControlGroup` also emits `runtime:compression` and `runtime:account` (`control-surface-runtime.ts:33-82`). CS names `proxy.active_account`, which is migrated (`migrations.ts:43`). Which is right — the invariant or the duplicate — is for the human. | none |
| `collectControlSurface` / `applyControl` route to existing writers | CS §2 | `src/config/control-surface.ts:74`, `:127-157` | control-surface tests | shipped-but-drifted | CS names `useAccount`, `startDetached`; code uses `useGateway` (`control-surface-runtime.ts:222`) and `startDetached` (`:184`). Naming drift only. | — |
| Env-supplied controls are locked and refuse writes | CS §2 | `control-surface-settings.ts:101-102`, `:140-142` | control-surface tests | shipped-and-matches | `ENV_LOCKED` copy (`control-surface-types.ts:102-104`) says env "overrides every file layer" — false since D62. | — |
| `applyControl` throws for a locked control | `control-surface.ts:123` doc | `applySetting` refuses only `env` (`control-surface-settings.ts:140`); important- and opaque-locked rows write anyway | none | shipped-but-drifted | Comment overstates; UI hides the widget but the API accepts. | none |
| `danger` confirm only in the risky direction | CS §2 | `danger` carried on `Control` (`control-surface-settings.ts:123`); confirm logic in `src/tui/state.ts` (not owned) | tui-state test | shipped-and-matches | | — |
| Stable control ids `setting:/guidance:/runtime:` | CS §2 | `control-surface.ts:141-156` | control-surface tests | shipped-and-matches | | — |
| `golem config schema --json` feeds VS Code | CS §three front ends | `src/cli/commands/config.ts:81`, `:266` | `tests/unit/config-schema-asset.test.ts` | shipped-and-matches | | — |
| Bare `golem` is the panel; `--dir/--no-pet/--advanced`; unknown flags fall to commander; non-TTY bare prints help | CS §golem panel | `src/cli/main.ts:53-98` | `tests/unit/cli-panel-args.test.ts` | shipped-but-drifted | CS says `parsePanelArgs` lives in `main.ts`; it is in `src/cli/panel-args.ts` (`main.ts:57`). CS says main imports "exactly one of tui or program"; it also imports `panel-args.js` and `fast-path.js`. | — |
| `ui.*` section keys | CS §ui | `schema.ts:701-720`, defaults `:1169-1175` | `config-ui-model.test.ts` | shipped-and-matches | | — |
| `config set` coercion incl. objects (R9.9), whole-object replace, `{}` clears, named errors | CS §Object-valued | `src/cli/config.ts:162-247` | `tests/unit/cli/config.test.ts` | shipped-and-matches | | — |
| `--value-file` / stdin, both-given is an error | CS §Object-valued | `config.ts:116-155` | `cli/config.test.ts` | shipped-and-matches | | — |
| `models.*` keys; `catalog_url` read only by `models refresh` | CS §models | `schema.ts:720-742`, `:1176-1183` | — | shipped-and-matches | Reader side not re-verified (models partition). | — |

### Init (D43, D58, §5.1 commands/mechanism)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `.golem/settings.json` is a content-free `{}` marker; port + level in `settings.local.json` | D43(b) | `src/cli/init.ts:454-499` | `tests/integration/cli-init-wiring.test.ts` | shipped-but-drifted | D43 names `slider.level`, `golem slider`, `JsonFileSliderStore`, MCP `level` — all retired by ADR-0004; init writes `compression.level` (`init.ts:474`). D43 is right in spirit, stale in names. | — |
| Legacy project-scoped `proxy.port` still honoured | D43(b) | `init.ts:347-349` | cli-init tests | shipped-and-matches | | — |
| Claude Code wiring in `.claude/settings.local.json`; `claude.settings_scope` default `local` | D58(a)(b) | `src/cli/claude-settings-target.ts:1-60`; `schema.ts:779-802`, default `:1190-1193` | `cli-init-wiring.test.ts`, `cli-init-uninit.test.ts` | shipped-and-matches | | — |
| Scope moves writes, never reads; init sweeps the other file; uninit sweeps both; CA excluded | D58(c)(d) | `claude-settings-target.ts:21-29`; `src/cli/init-claude-settings.ts:118-130`, `:314-320`, `:393-410` | cli-init-uninit test | shipped-and-matches | statusLine/defaultMode skip (D58e) lives in `init-hooks.ts` — not owned, not verified. | — |
| `golem config set/unset` default `--scope local` | D58(f) | `src/cli/commands/config.ts:146-161`, `:199` | cli/config test | shipped-and-matches | TUI panel defaults to `project` (`src/tui/state.ts:120`) — see Contradictions. | — |
| Skills at `.claude/skills/golem/<cmd>/SKILL.md` → `/golem-<cmd>` | §5.1 Mechanism; D19; D14 | flat `.claude/skills/golem-<cmd>/` (`src/cli/init-skills.ts:57-59`, `:97-100`); nested layout migrated away `init.ts:420-425`, `init-skills.ts:160` | `cli-init-retired-skills.test.ts` | dead-or-superseded | Nested layout retired 2026-09-04 (never discoverable). Spec §5.1/D14/D19 not updated. | — |
| §5.1 command table (`/golem-index`, `/golem-search`, `/golem-devices`, `/golem-coder`, `/golem-note`) | §5.1 | installed set: `.claude/skills/` has 22 `golem-*` + `vibe`; none of those five | — | shipped-but-drifted | `/golem-compression`, `/golem-stats`, `/golem-expand`, `/golem-bypass`, `/golem-research`, `/golem-develop`, `/golem-wiki-ingest` match. The other five are absent as skills (may exist as MCP prompts — not verified). | none |
| `golem init` appends guidance to project CLAUDE.md | §5.1 last para | `init-hooks.ts:85`, `:209` "Golem never edits the user's CLAUDE.md"; guidance is `.claude/rules/` (`src/hooks/guidance.ts:3-9`) | — | dead-or-superseded | Superseded by guidance rules. | — |
| `UNPREFIXED_SKILLS` allowlist for `/vibe` | VG §Surfaces | `init-skills.ts:54-73` | `tests/unit/vibe-skill-install.test.ts` | shipped-and-matches | | — |
| MCP registered as `golem` stdio | D19 | `init.ts:255`, `:400-416` | cli-init tests | shipped-and-matches | D19's tool list still names `level` (retired, ADR-0004) and `golem_devices`. | — |

### Vibe (VG)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Layout `VIBE.md` / `guidelines/` / `snippets/` / `candidates.jsonl` / `sources.json` under `~/.golem/vibe` | VG §Where it lives | `src/vibe/paths.ts:20-27`, `:51` | `vibe-store.test.ts` | shipped-and-matches | | — |
| Brief capped at 4 KiB, truncated at a section boundary | VG §Where it lives | `paths.ts:38`; `store.ts:105-122`, `:140-145` | `vibe-store.test.ts` | shipped-and-matches | Over-drops: a section that ended exactly at the boundary is still cut (`store.ts:120`); with one heading it keeps a partial section — the case the comment says it avoids. Minor. | — |
| Gate: non-Golem dir performs zero reads; home dir is not a project | VG §The gate | `store.ts:79-84`; `paths.ts:71-87` | `tests/unit/vibe-gate.test.ts` | shipped-and-matches | | — |
| Measured by line counting; evidence on every rendered row | VG §Measured | `src/vibe/analyze.ts:216-249` (guideline rows carry `% of N`) | `vibe-analyze.test.ts` | partial | The brief rows (`seed.ts:140-144`) carry no evidence, and with zero candidates still assert `Quotes: double` / `Semicolons: no`. | none |
| Generated block between `vibe-measured` markers, human text preserved | VG §Generated versus human | `seed.ts:120-151` | `vibe-store.test.ts` | shipped-and-matches | | — |
| Confirmed block inserted ABOVE measured | VG §Measured, confirmed | `promote.ts:20-21`, `:39-60` | `vibe-promote.test.ts` | shipped-and-matches | | — |
| Every byte written to the guide is redacted before write | VG §Redaction | brief/guideline/snippet redacted `store.ts:141`, `:169`, `:227` | `vibe-store.test.ts` | partial | `sources.json` (`store.ts:248`) and `candidates.jsonl` (`candidates.ts:80`, carries the human's free-text `note`) are written unredacted. | none |
| Two-half capture: PostToolUse hash+reading, UserPromptSubmit re-read; ledger in `.golem/state/vibe-pending.json` | VG §How it learns | `capture.ts:21`, `:56`, `:77`; wired `src/hooks/post-tool-use.ts:226`, `src/hooks/session-hooks.ts:207` | `vibe-capture.test.ts` | shipped-and-matches | | — |
| Quiz asks only open candidates seen ≥ 2; `no` tombstones forever | VG §How it learns | `candidates.ts:48`, `:98`, `:121-126` | `vibe-capture.test.ts` (tombstone) | shipped-and-matches | `golem vibe confirm` (`commands/vibe.ts:180-203`) can confirm a tombstoned key — `transition` never checks state (`candidates.ts:147-163`). Header comment `candidates.ts:6-8` says "three times across three files"; threshold is 2 sightings, files not counted. | — |
| `/vibe quiz` is the only surface that writes a stated preference | VG §Surfaces | `golem vibe confirm` also writes (`commands/vibe.ts:180-203` → `applyConfirmed`) | — | shipped-but-drifted | Undocumented second writer. | — |
| `golem vibe show/seed/sources/path` | VG §Surfaces | `commands/vibe.ts:64`, `:91`, `:115`, `:137` | — | shipped-and-matches | `candidates/confirm/reject/sweep` undocumented (see below). | — |
| Seed from `git log --author`; prompt text as voice source | VG §Not yet built | no author/git use in `src/vibe/seed.ts` | — | not-started | As documented. | `vibe-authored-history` (queued) |
| Mark linter-enforced habits as enforced | VG §What a measurement proves | none | — | not-started | As documented. | `vibe-authored-history` |

### Distribution, versioning, update (D41, D16, D19, D4, D9)

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| One canonical version; `sync-version.mjs` in build generates `src/version.ts`; `index.ts` re-exports | D41a | `package.json` `build` script; `src/version.ts:1-4`; `src/index.ts:5` | — | shipped-and-matches | | — |
| `release.mjs` bumps both package.json + VERSION in lockstep, "all three move or none do" | D41a; RP §Why the version; `release-prepare.yml:92-94` | `scripts/release.mjs:51-63` | — | partial | Sequential writes, no rollback — not atomic. `package-lock.json` is not bumped: lock is `0.54.2`, everything else `0.54.3` (release commit `1b08402` touched 3 files). `release.mjs:66-77` still prints manual `git tag` / `npm publish` steps, contradicting RP (workflow tags and publishes). | none |
| Tiered installer npm → Bun binary → bootstrap Node | D41b | `install/install.sh`, `install/install.ps1` | — | shipped-but-drifted | Tier 1 installs `golem-run` (`install.sh:53-56`, `install.ps1:39-43`), which the release no longer publishes (package is `@pliable/golem`). | R7.5 (first publish) |
| golem.run UA routing | D41c | portal repo (not here) | — | — | Unverifiable here. | — |
| Bun cross-compiled binaries in CI | D41d | `scripts/build-binary.mjs`; `release.yml:116-139` | — | shipped-and-matches | D41d still says "NOT YET RUN locally" — CI runs it; local claim unverifiable. | — |
| `golem update` / `upgrade`, `--check [--json]`, cached 24 h, fail-soft, install-method aware | D41e | `src/cli/commands/status-update.ts:41-97`; `src/update/index.ts:24`, `:48-51`, `:86-107` | `tests/unit/update/update.test.ts` | shipped-but-drifted | Checks and installs `golem-run` (`update/index.ts:22`, `status-update.ts:83`) while `package.json` is `@pliable/golem`. Once `@pliable/golem` is published, update reports the old package's latest. | R7.5 |
| `updateAvailable` in status/statusline; VS Code badge + `golem.update` | D41e | `status-collect.ts:408`; `statusline.ts:629`, `:808-813`; `vscode-extension/extension.js:87`, `:162-166` | update test | shipped-and-matches | | — |
| TypeScript, Node ≥ 22, ESM, Biome, vitest, zod | D16 | `package.json` `type: module`, `engines.node >=22`; scripts | — | shipped-and-matches | | — |
| npm package `golem-run`, onboarding `npx golem-run init` | D19; D16; CM "npm **`golem-run`**" | `package.json` name `@pliable/golem`; lockfile name still `golem-run` | — | shipped-but-drifted | See Contradictions #1. | R7.5 |
| Python/uvx implementation | D4 | none | — | dead-or-superseded | Superseded by D16. | — |
| Native Win/macOS/Linux, 3-OS CI, `platformdirs` | D9 | `ci.yml:53-58`, `:107-166` | — | partial | macOS advisory only (`ci.yml:145-148`, not in `ci-gate` needs `:186`); `platformdirs` superseded by `~/.golem` + env-paths (`src/config/paths.ts`, `src/vibe/paths.ts`). | none |

### Release pipeline (RP, CM "Branches and releases")

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `ci.yml` trigger "PR to `main`; `workflow_call`" | RP §three workflows table | `ci.yml:17-28` — `pull_request: branches: [main, development]` | — | shipped-but-drifted | Table stale; the prose right below it (and CM) is right. | — |
| No `push:` trigger in CI | RP | `ci.yml:17-28` | — | shipped-and-matches | | — |
| Matrix: quality ubuntu 22/24 + windows 24; test ubuntu×2×10 + windows×24×10; macOS ×4 advisory; one `CI gate` | RP §matrix; CM | `ci.yml:53-58`, `:107-119`, `:145-166`, `:183-198` | — | shipped-and-matches | RP says "the 22 individual job names"; actual is 3 + 30 = 33 (`ci.yml:171-172` says 30+). | — |
| `release-prepare.yml` manual, development-only, bumps, pushes, opens PR, prints approval beat | RP §release-prepare, §one click | `release-prepare.yml:45-46`, `:64-67`, `:88-199` | — | shipped-and-matches | | — |
| `release.yml` on push to main calls `ci.yml`; resolve refuses an existing tag | RP | `release.yml:41-43`, `:65-71`, `:87-113` | — | shipped-and-matches | | — |
| Release asserts every required asset | RP §What a release publishes | `release.yml:278-287` | — | partial | Asserted list omits `SHA256SUMS` and the `.tgz` that RP lists as published. | none |
| `golem-run-<version>.tgz` asset | RP asset table | `release.yml:168-175` `npm pack` | — | shipped-but-drifted | With `@pliable/golem`, `npm pack` produces `pliable-golem-<v>.tgz`. | R7.5 |
| npm publish always, via OIDC trusted publisher, `--provenance` | RP §npm | `release.yml:476-499` | — | shipped-and-matches | Publishes a fresh build, not the attached tarball — they can differ. Trusted-publisher registration for the new scoped name unverifiable here. | — |
| VS Code publish gated on `VSCE_PAT` | RP | `release.yml:501-517` | — | shipped-and-matches | | — |
| `config-schema.json` rendered `--no-header` with isolated HOME + dir, asserted header-free / default+runtime layers | RP §config-schema | `release.yml:178-212` | `config-schema-asset.test.ts` | shipped-and-matches | | — |
| Portal webhook: OIDC bearer, own job with `id-token: write`, retry 5xx / stop 4xx, inert without `PORTAL_WEBHOOK_URL`, `notify_only` mode, local `aud`/`workflow_ref` check | RP §portal webhook | `release.yml:316-460` | — | shipped-and-matches | | — |
| `gh api repos/cloudcatalyst/golem/...` clearing commands; repository-settings evidence | RP §Clearing it, §Repository settings | `git remote` = `PliableSoftware/golem`; workflows use `$GITHUB_REPOSITORY` | — | shipped-but-drifted | Command examples name the old slug; `release-prepare.yml` prints the right one dynamically (`:194`). | — |
| "`development` requires nothing, matching the decision that CI runs only at the release boundary" | RP §Repository settings | contradicts `ci.yml:3-12` and RP §Where CI runs | — | shipped-but-drifted | Stale rationale inside the page itself. | — |
| PRs target `development`; merge release PR with a merge commit | CM | process — `release-prepare.yml:160-165` opens `development → main` | — | shipped-and-matches | Merge-style is a human rule; unverifiable. | — |
| CM "Running the tests" scripts: `test:changed`, `test:unit`, `test:serial`, `test:full`, `verify:deps`, `lint`, `format:check`, `typecheck` | CM | `package.json` scripts (all present); `vitest.config.ts:18` `testTimeout: 20_000` | — | shipped-and-matches | | — |
| `golem verify`: log path first, one `golem-verify:` line per check, build before `dist/` readers, exit code | CM; `golem-long-run-visibility` rule | `src/cli/verify.ts:44`, `:93-114`, `:146-159`, `:173-201`, `:244-272` | `verifyChecks`/`selectChecks` tests | shipped-and-matches | | — |

## Undocumented

Behaviour in owned src that no owned doc mentions:

- **Per-key merge for `inference.personas`** — `loader.ts:358-435` (`MERGE_PER_KEY_LEAVES`), per-field provenance `inference.personas.<id>.<field>`. SC/CS say only "a leaf replaces wholesale".
- **`portal.*` and `team.*` keys on the remote deny-list** — `loader.ts:119-153`. SC/ADR8 name only `proxy.bypass_all`.
- **`golem vibe candidates|confirm|reject|sweep`** — `src/cli/commands/vibe.ts:144-243`.
- **`golem config migrate`** (retired-name rewrite) and the version-change sweep — `src/cli/commands/config.ts:226`, `src/config/migrate-files.ts`, `src/cli/commands/proxy.ts:180`.
- **`src/cli/version-sync.ts`** — resyncs Claude Code wiring on version change from the proxy daemon.
- **`src/cli/managed-files.ts`** provenance ledger (`.golem/managed-files.json`) — referenced by init skills, not described in owned pages.
- **`src/cli/local-config.ts`** (`golem local …`) — local-coder enable / base URL.
- **`src/cli/verify-progress.ts`** — status-line segment for an in-flight verify (mentioned only in the guidance rule).
- **`src/pkg/`, `src/cli/pkg.ts`** — documented in `concepts/Managed Tools.md` (not owned); nothing in owned pages.
- **`src/shared/`** (`git-worktree.ts`, `json.ts`, `proxy-log.ts`) — internal utilities, all have callers.
- **Init step 9, team sync** — `init.ts:517-575`; D43/D58 and owned wiki pages predate it.

## Dead candidates

- `coerceLevel` — `src/config/control-surface-types.ts:205-213`. Only its definition references it (grep over `src tests vscode-extension scripts`: 1 hit). Error text also wrong ("expected 0–3" while accepting 0–5, key `slider.level` retired).
- `SettingMeta.ownedBy` — declared `ui-model.ts:149`, filter `control-surface-settings.ts:50`, never populated (`grep ownedBy src` finds no value). Test `config-ui-model.test.ts:44` is vacuous.
- `ApplyControlOptions.initProbe` — `control-surface-types.ts:183-197`; nothing reads it (`grep initProbe src` outside `cli/init*`: only the declaration). `applyRuntime` comment (`control-surface-runtime.ts:139-143`) says the probe is no longer needed.
- `RETIRED_SETTINGS` entry for `inference.worker_targets` — `migrations.ts:98-103`; unreachable because the leaf exists (`schema.ts:303`).
- Migration-table skip branch — `tests/unit/config-migrations.test.ts:55-57` skips `worker_targets → personas`, but no such entry exists in `SETTING_MIGRATIONS` (`migrations.ts:41-61`).

## Stale comments

- `src/cli/init.ts:5` — "`.claude/settings.json`" is the default target; it is `settings.local.json` (D58).
- `src/cli/init.ts:11` — nested `.claude/skills/golem/<cmd>/` layout; retired (`init.ts:420-425`).
- `src/cli/init.ts:12` — "`.golem/settings.json` created with defaults"; it is `{}` (`init.ts:455`).
- `src/cli/init.ts:13` — "Golem guidance (in the committed CLAUDE.md)"; Golem never edits CLAUDE.md.
- `src/cli/init.ts:431-440` — R13.12 step described via `inference.default_coder`, which is RETIRED (`migrations.ts:92-96`).
- `src/config/loader.ts:90-93` — "`team` is declared but not yet populated by any fetch"; it is (`team-layer.ts:596`).
- `src/config/loader.ts:129-137` — "The whole `team.*` section … is denied"; the set enumerates four keys (`:149-152`), so a new `team.*` leaf would NOT be denied automatically.
- `src/config/loader.ts:367-370` — explains why `inference.worker_targets` is not merged per key; the key is (nominally) retired.
- `src/config/control-surface-types.ts:98` — `SETTING_SCOPES` "most-local first"; the list is `project, local, user`.
- `src/config/control-surface-types.ts:102-104` — `ENV_LOCKED` "env overrides every file layer"; false since D62 (user-facing string).
- `src/config/control-surface-runtime.ts:122-124` — "the slider always writes local scope; the account writes project scope"; slider retired, account goes through `useGateway`.
- `src/config/control-surface.ts:14`, `:30`, `:121` — slider as a runtime control / `slider.level` as an owned leaf; retired.
- `src/config/control-surface.ts:123` — "Throws … for a locked control"; only env-locked throws.
- `src/cli/commands/proxy.ts:185-186` — team layer "unable to fail … cannot stop the proxy starting"; it can (probe above).
- `src/vibe/candidates.ts:6-8` — "three times across three files"; threshold is 2 sightings.
- `scripts/release.mjs:1-9`, `:66-77` — manual tag / `npm publish` steps and RELEASING.md framing; the workflows do both.
- `.github/workflows/release-prepare.yml:92-94` — "all three move together or none do"; no rollback, and the lockfile doesn't move.
- `src/update/index.ts:6`, `:174` — `golem-run` as the package name.

## Contradictions for the human

1. **Which npm name is Golem?** `package.json` says `@pliable/golem` (`2fc7cd2`, 2026-09-23, inside a `fix:` commit about model shapes). CLAUDE.md, spec D16/D19/D41, the Release Pipeline page, `package-lock.json`, both installers, `golem update` (`update/index.ts:22`, `status-update.ts:83`), `ps.ts` process detection (`src/cli/commands/ps.ts:388`, `:426`) and the VS Code extension id prefix (`init-vscode.ts:194`) all say `golem-run`. If the rename is intended, update/install/ps are functionally broken for the next release; if not, the next release publishes under an unintended scope.
2. **Team failure rule vs. the loader's strictness.** ADR-0008/SC promise a team link never stops the proxy; the loader hard-fails any origin with an invalid value, and team rows are not pre-validated. Either team rows get validated/skipped with a notice (as `translateTeamRows` already does for unknown sections), or the rule needs rewording.
3. **Team origin on the control surface.** `status-collect.ts:142-149` explicitly loads the team layer to avoid "believing you are under team policy when you are not"; `golem config`, the TUI, VS Code and `config schema` do not. Decide whether the surface should show team values/locks.
4. **`inference.worker_targets`: live, deprecated, or retired?** Schema + readers say live; `RETIRED_SETTINGS` says retired-and-raises; the migrations test says deprecated-with-warning; `ui-model.ts:308-312` says R14.3 moved routing to personas.
5. **One row per key, or both?** CS's `ownedBy` invariant vs. the shipped duplicate `runtime:compression` + `setting:compression.level` (and account/model).
6. **Panel default write scope.** D58(f) makes `local` the CLI default for the stated reason that a setting is usually personal; the TUI starts at `project` (`src/tui/state.ts:120`) and `SETTING_SCOPES` lists `project` first.
7. **Vibe redaction scope.** VG says every byte written to the guide is redacted; `sources.json` and `candidates.jsonl` (with free-text notes) are not. Either widen redaction or narrow the claim.

## Unverifiable here

- Portal side of the webhook, OIDC checks, and whether the portal has been told about `PliableSoftware/golem` (RP §Paused).
- npm Trusted Publisher registration for `@pliable/golem` vs `golem-run`.
- GitHub repository settings (default branch, `main` protection, repo variables).
- golem.run UA routing (D41c) — portal repo.
- Merge-commit-not-squash discipline (human process).
- D41d "not yet run locally" — needs Bun/non-Windows hardware.
- `init-hooks.ts` statusLine/defaultMode foreign-setting skip (D58e) — file not in this partition.
- Working-tree note: the main checkout (`D:\Personal\Repos\Golem`) has UNCOMMITTED edits flipping `snooze.enforce`/`spawn_gate` defaults in `src/config/schema.ts` and the matching rule text. The committed tree audited here is internally consistent (`schema.ts:1184-1189` `true/true`, `.claude/rules/golem-snooze-hold.md:19` "Enforcing by default"); not classified.
