# DUST1.9 — telemetry, status and UI surfaces audit

Read-only audit, 2026-09-25, against `development` @ `fd3aedc`. Owned claims: spec §5 (not
§5.1), Decisions 50 and 51, `docs/wiki/concepts/Context Ledger.md`, plus the "honest
observability" sweep. `src/cli/watch.ts` (`golem watch`, the sidecar status screen) is
included here.

**Method caveat:** this worktree has no `node_modules`, so no test was run. "Test evidence"
means a test file that exercises the behaviour, found by reading it. It does not mean a green
run.

## Bucket counts

| class | count |
|---|---|
| shipped-and-matches | 45 |
| shipped-but-drifted | 12 |
| partial | 3 |
| not-started | 3 |
| dead-or-superseded | 4 |
| **total classified rows** | **67** |
| (unverifiable measurement rows, not classified) | 3 |

Separately: 11 defects (D1–D11), 10 dead-candidate symbols, 9 stale-comment sites.

## Findings table

Legend: S&M shipped-and-matches · DRIFT shipped-but-drifted · PART partial · NS not-started ·
DEAD dead-or-superseded.

### Spec §5 — Telemetry & UX

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| Dashboard exists as a local web UI | spec §5 b1 | `src/dashboard/server.ts:1-16,50,179-229`; `src/cli/commands/note-dashboard-watch.ts:89` | `tests/integration/dashboard.test.ts` | S&M | Loopback by default. `--lan` / `telemetry.dashboard_lan` is opt-in (`server.ts:53`) | — |
| Dashboard: tokens saved/spent | spec §5 b1 | `server.ts:396-400` (saved, before→after) | `dashboard.test.ts` | PART | "Saved" and before→after are shown, and both are chars/4 estimates (see H1). Billed spend is not shown | none |
| Dashboard: cache hit rates | spec §5 b1 | not in `server.ts`. It lives in `golem stats --cache` (`commands/dials-stats.ts:163-176`, `telemetry/cache-report.ts:99,195`) | `tests/unit/telemetry/cache-report.test.ts` | PART | The metric exists, but on a different surface from the one the spec names | none |
| Dashboard: cost estimate | spec §5 b1 | not in `server.ts`. It lives in `golem bench cost` (`commands/bench.ts:81`, `telemetry/cost-benchmark.ts:433`) | `tests/unit/telemetry/cost-benchmark.test.ts` | PART | Same as above: exists, but on a different surface | none |
| Dashboard: per-stage savings attribution | spec §5 b1 | `server.ts:246-258,412-420`; `cli/stats.ts:99-106` | `dashboard.test.ts` | S&M | — | — |
| Dashboard: per-device utilization | spec §5 b1 | none. `utilization` in src means rate-limit use only (`status-collect.ts:467`). `golem devices` reports hardware tier and pulled models, not utilization | — | NS | — | none |
| Dashboard: quality-delta from canary runs | spec §5 b1 | none. No `canary` or `quality.delta` anywhere in `src/` | — | NS | — | none |
| `golem status` | spec §5 b2 | `commands/status-update.ts:24`; `cli/status-collect.ts:136` | `tests/integration/cli-status.test.ts`, `tests/contract/vscode-status-fields.contract.test.ts` | S&M | But see D1 (the redaction-off warning can be dropped) | — |
| `golem devices` | spec §5 b2 | `commands/local-ollama.ts:239` | (not owned) | S&M | — | — |
| `golem index <path>` | spec §5 b2 | `commands/local-ollama.ts:155` | (not owned) | S&M | — | — |
| `golem compression 3` | spec §5 b2 | `commands/dials-stats.ts:33` (dial off/1/2/3) | (not owned) | S&M | — | — |
| `golem replay-eval` | spec §5 b2 | none. No `replay-eval` anywhere in `src/` or `docs/plan/tasks/` | — | NS | — | none |

### Decision 50

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `SETTING_META` is `satisfies`-checked over `LeafPath` | D50(a) | `src/config/ui-model.ts:787` | compile-time | S&M | — | — |
| Widget kind derived from zod (`deriveKind`) | D50(a) | `ui-model.ts:86-89` | — | S&M | — | — |
| `ownedBy` hides `slider.level` / `proxy.active_account` | D50(a) | the field is declared at `ui-model.ts:149` and read at `control-surface-settings.ts:50`, but **no `SETTING_META` entry sets it**. Both keys are retired (`schema.ts:218`, ADR-0004) | — | DEAD | The mechanism has no users left | none |
| Writes route through `setConfig/writeGuidanceRule/setSliderLevel/useAccount/startDetached` | D50(b) | compression now goes through `setDial` (`control-surface-runtime.ts:144`). `startDetached` is at `:184` | — | DRIFT | The code is right under ADR-0004, and the Decision text is stale. Comments at `control-surface.ts:20` and `control-surface-runtime.ts:4` still name `setSliderLevel` | none |
| An env-layer control is locked | D50(b) | `control-surface-runtime.ts:32,49-50` | — | S&M | — | — |
| `danger` confirms only in the risky direction | D50(b) | `src/tui/state.ts:346-368` | `tests/unit/tui-state.test.ts` | S&M | This holds for toggles. The enum branch (`=== "0"`, `state.ts:366`) is dead, see Dead candidates | — |
| Stable control ids `setting:/guidance:/runtime:` | D50(b) | `control-surface-runtime.ts:34,63,92`; `control-surface.ts:153` | — | DRIFT | `runtime:slider` became `runtime:compression`. The contract changed shape under ADR-0004, and D50 is not annotated | none |
| `golem config schema [--json]` | D50(b) | `commands/config.ts:255` | (not owned) | S&M | — | — |
| `golem ui` / alias `golem settings` | D50(c) | removed. `main.ts:58-65` answers with a migration message | `tests/unit/cli-panel-args.test.ts` | DEAD | Superseded by D51(f), and the spec marks only D50(d) as superseded | — |
| Bare `golem` opens the panel only with no args and both stdin/stdout a TTY, decided before commander | D50(c) | `src/cli/main.ts:68-84` | `cli-panel-args.test.ts`, `tui-lazy-import.test.ts:52` | S&M | — | — |
| `ui` section: `pet`, `pet_color`, `color`, `advanced` | D50(c) | `src/config/schema.ts:708-718,1170-1174` | — | S&M | — | — |
| ink + React accepted | D50(d) | `package.json` has 6 deps and no ink/react | `tui-lazy-import.test.ts:133` | DEAD | Superseded by D51, as the spec already records | — |
| Guard: the panel is reachable only by dynamic import | D50(d) | `main.ts` (dynamic only) | `tui-lazy-import.test.ts:52-163` | S&M | — | — |
| Guard: `src/tui/state.ts` is a pure reducer | D50(d) | `state.ts` (`reducePanel`, effects returned) | `tui-state.test.ts` (32 tests) | S&M | — | — |
| U+25A0 pet is drawn in a fixed-width box, `--no-pet` escape hatch | D50 caveat | `src/tui/render.ts:71`; `cli/panel-args.ts:13` | `tests/unit/tui-render.test.ts` | S&M | — | — |

### Decision 51

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| ink replaced by `render/screen/keys/ansi/width` (~765 lines) | D51(a) | `src/tui/{render,screen,keys,ansi,width}.ts` = 267+97+175+148+111 = **798** lines | `tui-render.test.ts`, `tui-keys.test.ts` | S&M | +33 lines of growth, not significant | — |
| Back to 6 runtime dependencies | D51(a) | `package.json` `dependencies` = 6 | `tui-lazy-import.test.ts:133` | S&M | — | — |
| `header.ts` / `controls.ts` are pure | D51 interfaces | `src/tui/header.ts`, `src/tui/controls.ts` | `tui-render.test.ts` | S&M | — | — |
| ANSI pre-paint splash deleted | D51(b) | no `splash` / `pre-paint` in `src/` | — | S&M | — | — |
| Panel paints in ~170ms | D51(b) | — | — | (unverifiable) | See Unverifiable | — |
| `tui-state.test.ts`: 32 tests passed unchanged | D51(c) | — | `tests/unit/tui-state.test.ts` has 32 `it`/`test` | S&M | — | — |
| Colour detection over the `NO_COLOR/FORCE_COLOR/COLORTERM/TERM/WT_SESSION` matrix | D51(c) | `src/tui/ansi.ts:47-70` | `tui-render.test.ts` imports `ansi` | S&M | — | — |
| `main.ts` is a dependency-free router | D51(d) | `src/cli/main.ts` | `tui-lazy-import.test.ts:52,61` | S&M | — | — |
| `fast-path.ts` serves hooks and statusline without commander | D51(d) | `src/cli/fast-path.ts:244-249` | — | S&M | — | — |
| `cli/slider-read.ts` is the read-only half | D51(d) | **the file does not exist** | — | DEAD | Removed with the slider (ADR-0004). D51 is not annotated | none |
| `cli/upstream-display.ts` read-only half | D51(d) | `src/cli/upstream-display.ts` | — | S&M | — | — |
| Standing constraint: display never pays for write machinery | D51(d) | `statusline.ts:911-918` runs a full telemetry `aggregate()` on every prompt, and its result is never rendered (D7) | — | DRIFT | Hot-path I/O with no output | none |
| Latency figures (hook 126/135ms, statusline 275ms) | D51(d) | — | — | (unverifiable) | — | — |
| Proxy adds +4.4ms p50 | D51(e) | — | — | (unverifiable) | — | — |
| `golem ui` / `settings` removed, bare `golem` IS the panel | D51(f) | `main.ts:58-84` | `cli-panel-args.test.ts` | S&M | — | — |
| Panel flags `--dir`, `--no-pet`, `--advanced` via `parsePanelArgs` | D51(f) | `cli/panel-args.ts:13-68` | `cli-panel-args.test.ts:26-47` | S&M | — | — |
| An unrecognised flag falls through to commander | D51(f) | `panel-args.ts:65` | `cli-panel-args.test.ts:56` | S&M | — | — |
| Bare `golem` outside a TTY prints help, and panel flags outside a TTY explain why | D51(f) | `main.ts:69-84` | — | S&M | — | — |
| A test asserts documented flags equal accepted flags | D51(f) | `program.ts:18-20` | `cli-panel-args.test.ts:90` | S&M | — | — |
| `ui`/`settings` recognised "for one release" (exit 2) | D51(f) | `panel-args.ts:75`; `main.ts:58-65` | — | DRIFT | Introduced in `c3fa9f1` (first tag v0.50.0) and still present at v0.54.3. Either the text or the code is wrong; the human decides | none |
| `golem status` deliberately kept | D51(f) | `status-update.ts:24` | `cli-status.test.ts` | S&M | — | — |
| `ControlSurface.header` nullable | D51 interfaces | `src/config/control-surface.ts:61` | — | S&M | — | — |
| `PanelState` gains `version` / `projectDir` | D51 interfaces | `src/tui/header.ts:97` | `tui-render.test.ts` | S&M | — | — |

### Context Ledger wiki page

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| `golem stats --context` | wiki | `commands/dials-stats.ts:116,143-161`; `cli/context.ts:159` | `tests/unit/cli/context.test.ts` | S&M | — | — |
| Exhaustive buckets (8 names) | wiki "What it reports" | `src/proxy/context-ledger.ts:40-60,288-300` | `tests/unit/proxy/context-ledger.test.ts` | S&M | — | — |
| Top 8 biggest blocks | wiki | `context-ledger.ts:171,405` | same | S&M | — | — |
| `tool_result` grouped by producing tool | wiki | `context-ledger.ts:72,142` (`perTool`) | same | S&M | — | — |
| `tools` block decomposed per definition, owner from `mcp__` prefix, `defer_loading` | wiki | `context-ledger.ts:202-210,214-280` | same | S&M | — | — |
| No prompt content, ever | wiki | the schema holds numbers and names only (`context-ledger.ts:53-160`) | same (per page) | S&M | — | — |
| Clock-free; the caller stamps `capturedAt` | wiki | `context-ledger.ts:131,160,431-435`; `cli/proxy-build/telemetry-hooks.ts:49` | same | S&M | The stamp is applied in proxy-build, not "the CLI layer", but it is the same idea | — |
| Latest-only, atomic temp+rename, fail-open | wiki | `context-ledger.ts:437-442`; `telemetry-hooks.ts:49` (`.catch(() => {})`) | same | S&M | — | — |
| "One atomic ... write **per request**" | wiki | the ledger rides the pipeline event, which is emitted **only when the request was rewritten** (`pipeline/pipeline.ts:745-751` returns early; `:764-775` emits) | — | DRIFT | On unchanged traffic the ledger silently goes stale and shows an older capture. The code comment at `pipeline.ts:735-738` admits this; the page does not | none |
| Estimates, not a tokenizer | wiki | `context-ledger.ts:35,175`; `context.ts:224` prints "Counts are estimates" | — | S&M | — | — |
| "Never written at level 0" | wiki | level 0 is retired (ADR-0004). The real conditions are `proxy.bypass_all` / the shim (`proxy/server.ts:350`) **or** an unchanged request | — | DRIFT | `cli/context.ts:168` still prints "(Level 0 is a full bypass and is never recorded.)" | none |

### Honest observability — does each number have a source, and is an estimate called one?

| feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|
| H1 `golem stats` / dashboard / `watch` token figures | task brief | every before/after/saved number is `estimateTokens` (chars/4): `pipeline.ts:759-761`, `compression/tokens.ts:1-20`. None of `stats.ts:204-219`, `server.ts:396-400`, `watch.ts:112-131` labels them as estimates, and `TELEMETRY_WINDOW_NOTE` (`stats.ts:124`) does not either | `tests/integration/cli-stats.test.ts` | DRIFT | Presented as measured when they are estimated. `stats --context` and the brevity report do label theirs (`context.ts:224`, `stats.ts:283`) | none |
| H2 `requests` count | task brief | counts `kind:"request"` events, which are emitted only for **rewritten** requests (`pipeline.ts:747-751`) | — | DRIFT | "requests: N" in `stats.ts:204`, the dashboard `server.ts:401` and `watch.ts:116` reads as proxied requests, but it is rewritten requests only | none |
| H3 `golem bench cost` "Golem's measured contribution" | task brief | `avoided upstream` tokens come from `estimateTokens` (`pipeline.ts:539-540,724`) and are printed under "measured" (`cost-benchmark.ts:440,449`) | `cost-benchmark.test.ts` | DRIFT | `drafted_locally` is marked `~… est` (`:446`), but avoided-upstream is not | none |
| H4 `golem watch` when Golem net-adds tokens | task brief | `watch.ts:112-120` prints "no savings recorded yet" whenever `tokens_after > tokens_before` | `tests/unit/cli/watch.test.ts` | DRIFT | A net cost (for example a brevity directive on an otherwise unchanged body) is hidden as "nothing yet" | none |
| H5 `/api/state` compression when state collection fails | task brief | `session-report.ts:176` uses `golem?.compression ?? 1`, which reports "1 lossless" as fact when it is unknown | `tests/unit/cli/session-report.test.ts` | DRIFT | Nearby fields use `null` for "unknown" (`session-report.ts:32-34` doc) | none |
| H6 `golem status` limits line | task brief | utilization comes from rate-limit headers, with age and STALE shown (`status-render.ts:118-140`, `status-collect.ts:456-482`) | `cli-status.test.ts` | S&M | — | — |
| H7 statusline quota meter | task brief | 5h/7d % comes from Claude Code's own stdin JSON (`statusline.ts:258-269`, `quota-bars.ts:179`) | `tests/unit/cli/quota-bars.test.ts` | S&M | — | — |
| H8 cost bench `$` | task brief | priced from the catalog, with the source, as-of date and fuzzy-match qualifier on each row (`cost-benchmark.ts:463-492`) | `cost-benchmark.test.ts` | S&M | The header "billed spend" is catalog price × billed tokens. The row labels make that clear enough | — |
| H9 dashboard vs `golem stats` horizon | task brief | the dashboard uses the all-time aggregate (`note-dashboard-watch.ts:107,117`) while `golem stats` defaults to `--window 24h` (`dials-stats.ts:113,191-199`) | — | DRIFT | The same "Tokens saved" label covers different horizons. "All-time" is also really at most two rotation generations (`jsonl-store.ts:43-45`) | none |

## Defects found in passing (Phase 3 input, most serious first)

- **D1 — the redaction-off warning is dropped when an update is available.**
  `src/cli/status-collect.ts:429-436`: when a newer version is cached, the ternary's first branch
  returns `[...updateWarnings, ...warnings]` and never appends `REDACTION_OFF_WARNING`. The panel
  renders these same `report.warnings` (`src/tui/render.ts:80-84`). The panel header flags
  bypass **by colour alone** (`src/tui/header.ts:47-54`, `tone: "error"`, value text unchanged),
  so with `NO_COLOR` / `ui.color never` and an update pending, `golem status` and the panel both
  show nothing about bypass. The statusline (`statusline.ts:542`) and `watch` (`watch.ts:101-103`)
  are unaffected. Breaks the CLAUDE.md rule "surfaced loudly".
- **D2 — the dashboard stats source is frozen at startup.**
  `src/cli/commands/note-dashboard-watch.ts:107` calls `statsSourceForCli` once, and `:117`
  reuses it on every poll. A dashboard started before telemetry has a request serves
  `liveStatsSource` (the in-process `NativeLosslessCompression`, which never compresses in that
  process) for its whole life, so it shows zeros forever with the `LIVE_STATS_NOTE` caveat.
- **D3 — the telemetry rollup can be trusted across a rotation.**
  `src/telemetry/jsonl-store.ts:526-530` trusts the cache when `size >= entry.size && mtime >=
  entry.mtime`. After a rotation (`:504`), a fresh `events.jsonl` that regrows past `entry.size`
  before any `aggregate()` call sees the shrink will pass that check. `:538` then reads the NEW
  file from the OLD offset. The result is old[0..offset] + new[offset..], which drops old[offset..]
  and new[0..offset]. This contradicts the module doc at `:24-31` ("never a wrong number"). The
  window is narrow when the statusline polls each prompt, and wide for a project that only runs
  `golem stats` occasionally.
- **D4 — a partial trailing line advances the watermark.** The incremental path (`:538-544`)
  and full reparse (`:593,606`) set the checkpoint offset to the bytes read, including an
  unterminated last line from a concurrent append. `parseEvent` drops that fragment, and the next
  read starts mid-line, so the event is lost permanently.
- **D5 — `golem watch` ignores `NO_COLOR` and non-TTY output.**
  `note-dashboard-watch.ts:170` declares `--no-color` alone, which in commander makes `color`
  default to `true`. So `opts.color` is always a boolean, and the TTY/`NO_COLOR` fallback at
  `watch.ts:185` never runs. Piped `golem watch` emits ANSI.
- **D6 — the `golem watch` footer misreports its cadence.** `watch.ts:159` prints
  `WATCH_REFRESH_MS` (2s) even when `--interval` set something else (`:183`).
- **D7 — the statusline pays for data it never shows.** `statusline.ts:911-918` runs
  `openTelemetryStore(dir).aggregate()` on every prompt to fill `tokensBefore/After`
  (`:134-135`), and no renderer reads them (grep: only the assignment). The proxy's
  `/__golem/statusline` (`proxy/server.ts:214-219`) serialises them, which is the only consumer.
- **D8 — literal NUL bytes in source.** `src/telemetry/jsonl-store.ts:178` (`ROLLUP_ALL_KEY`)
  and `src/telemetry/cost-benchmark.ts:304,335` (map key separator). git classifies both files
  as binary (`git show --stat` shows `Bin 30513 -> 32371 bytes`), `grep` needs `-a`, and
  reviews see no diff. Use `\u0000` escapes.
- **D9 — the watch loop can overlap itself.** `setInterval(() => void draw(), refreshMs)`
  (`watch.ts:221`) does not wait for a slow `collectSessionStateReport` (local-model probe), so
  frames can overlap. Also, with `running === null` the header shows the filled "running" glyph
  (`watch.ts:79`).
- **D10 — storage sizing reads the wrong CCR directory in a linked worktree.**
  `src/cli/storage-size.ts:57` measures `<projectDir>/.golem/ccr`, but the CCR store resolves to
  the **main** worktree root (`compression/native-lossless.ts:362`). In a linked worktree it
  reports 0 or the wrong size.
- **D11 — minor wasted work.** `windowedStatsWithFallback` folds the `all` window before the loop
  and then again inside it (`telemetry/windowed-stats.ts:114-118`).

## Undocumented

Exported behaviour that no owned doc mentions. "Elsewhere" means an unowned wiki page covers it.

- `golem stats --window 24h|7d|all` with automatic widening (`windowed-stats.ts:104-121`,
  `stats.ts:134-173`). No wiki page found.
- `golem stats --brevity` (`stats.ts:246-288`). Decision 52, not owned.
- `golem stats --cache` (`telemetry/cache-report.ts`). Elsewhere: `concepts/Cache Observability.md`.
- `golem bench cost` and the models.dev price catalog (`telemetry/cost-benchmark.ts`,
  `telemetry/model-catalog.ts:444-567`). Only `WIKI.md` and a debrief mention models.dev.
- Context-window warning against the catalog (`cli/context.ts:117-150`,
  `model-catalog.ts:335`). Not on the Context Ledger page.
- Statusline quota braille meter (`cli/quota-bars.ts`). Only one wiki page references it.
- On-disk storage sizes in `/api/state` and `watch` (`cli/storage-size.ts`). No wiki hit.
- `golem watch` (`cli/watch.ts`). Only `syntheses/r5-autonomy-orchestration-batch.md` and the
  `WIKI.md` index mention it.
- Consolidated `/api/state` read model (`cli/session-report.ts`). Elsewhere: `Architecture.md`,
  `Blocked State Read Model.md`.
- Dashboard PWA manifest and icons (`dashboard/icon.ts`, `server.ts:199-218`) and the LAN bind
  (`dashboard/lan.ts`). Elsewhere: `Session Transport.md`, `Device Authentication.md`.
- `golem status` fields `webfetch_green`, `workers`, `targets`, `teams`, `devices`, `limits`,
  `vscode`, `unreachable_headroom_config` (`status-collect.ts:342-448`). Spec §5 lists only the
  command.
- Proxy `GET /__golem/statusline` JSON endpoint (`proxy/server.ts:214-227`). Not owned src; no doc.

## Dead candidates

| symbol | evidence | note |
|---|---|---|
| `_levelFallbackName` | `src/cli/session-report.ts:234`, no references (grep `src` `tests`) | Also names "passthrough", which is retired |
| enum branch of `needsConfirm` (`=== "0"`) | `src/tui/state.ts:366`. Every `danger` in `ui-model.ts` (`:168,547,556,595`) is on a boolean leaf. `runtime:compression` copies `compression.level`'s meta, which has none (`control-surface-runtime.ts:51`) | Slider level 0 no longer exists |
| `SettingMeta.ownedBy` | declared `ui-model.ts:149`, read `control-surface-settings.ts:50`, never set | See D50(a) row |
| `aggregateUsageByLevel`, `usageReportRows` | no `src` caller outside `src/telemetry/` (grep); tests only | Leftover from the slider A/B |
| `aggregateUsageBySemanticForced`, `semanticForcedReportRows` | only comment references in `config/schema.ts:416`, `pipeline.ts:238` | Staged for **R2.6** (queued), not dead |
| `aggregateAvoidedUpstream` | no `src` caller outside telemetry (grep). `cost-benchmark` folds events itself | — |
| `windowedStats` (no-fallback variant) | re-exported by `telemetry/index.ts:75`, with no caller or test | — |
| `DIM` in `src/tui/ansi.ts` | defined once, never referenced in `src` | — |
| `GolemState.tokensBefore/After` | populated `statusline.ts:914`, never rendered | See D7 |
| `liveStatsSource` in steady state | reachable only when telemetry has 0 requests (`mcp-compression.ts:24-33`) | Keep, but see D2 |

## Stale comments

- `src/cli/stats.ts:1-14` and `LIVE_STATS_NOTE` `:36-38` say durable history "starts when
  telemetry (task A4) lands". It has landed, since `collectWindowedStats` (`:134`) and
  `telemetryStatsSource` exist. The note text reaches users via D2.
- `src/cli/statusline.ts:6-7` says it shows "slider, upstream, cumulative savings". The slider is
  retired and savings are not rendered (`:499-501` says so itself).
- `src/cli/statusline.ts:236` says "Human-facing name for a slider level".
- `src/cli/session-report.ts:16` cites `getSliderInfo`, which no longer exists.
- `src/tui/state.ts:363-364` says "Slider level 0 is the passthrough bypass (Decision 30)".
  `:403` says "write `user` to the slider".
- `src/cli/context.ts:168` prints "Level 0 is a full bypass" to users.
- `src/config/control-surface.ts:20`, `src/config/control-surface-runtime.ts:4` name
  `setSliderLevel` (not owned src, cited for D50).
- `src/tui/header.ts:44-46` says bypass is "flagged in the header ... so it cannot be running
  unnoticed", but it is flagged only by colour (see D1).
- `src/telemetry/jsonl-store.ts:24-31,558` claim "never a wrong number", which is contradicted
  by D3/D4.

## Contradictions for the human (not resolved here)

1. **What does `requests` mean?** The code counts rewritten requests only (H2). The label, the
   dashboard tile and the ledger page's "per request" all read as every proxied request. Decide
   between emitting a request event for unchanged traffic too, and relabelling.
2. **Should the savings figures say "estimated"?** H1/H3. The spec's honest-observability
   principle suggests yes, and the code currently does not.
3. **The D51(f) one-release window for `golem ui`/`golem settings`** has run four minor versions.
   Either drop it or amend D51.
4. **Spec §5 dashboard scope.** Cache hit rate and cost live on `stats --cache` / `bench cost`,
   not the dashboard, and per-device utilization, canary quality-delta and `replay-eval` have no
   code or task. Decide whether to rewrite §5 to match, or to file tasks.
5. **Decisions 50(a)/(b)/(c) and 51(d)** still describe `setSliderLevel`, `ownedBy` on
   `slider.level`, `runtime:slider` and `slider-read.ts`, all retired by ADR-0004. Only D50(d) is
   marked superseded.

## Unverifiable here

- No tests were executed (the worktree has no `node_modules`). Every "test evidence" cell is
  from reading the test file.
- D51 latency measurements: panel ~170ms, hooks 126/135ms, statusline 275ms, proxy +4.4ms p50.
- The exact commander version's `--no-*` default semantics (D5) are from commander's documented
  behaviour and were not executed.
- The D3/D4 races were found by reading the code. No reproduction was attempted.
- The wiki page's §93/§95/§100 capture numbers (18,827 tokens, 93.9% built-ins, and so on) are
  historical measurements.
