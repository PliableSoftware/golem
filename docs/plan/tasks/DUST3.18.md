---
task: DUST3.18
title: "Stale comments and strings that contradict the rebaselined spec: slider-era wording, retired command names, wrong defaults and dead cross-references (strings and comments only)"
state: done
owner: agent
size: L
discipline: code
design: "SUMMARY.md 'Stale comments' (DUST1.1-DUST1.11), re-verified 2026-10-08 against docs/golem-spec.md and the code; DUST2.10 fixed the rest. Ground truth: the rebaselined spec, then the code beside the comment."
gate: "golem verify exit 0 before AND after; suite test count unchanged; `git diff` touches only comments, JSDoc, tool/prompt description text and user-facing message strings (plus the one test assertion named below); no identifier, control flow or config key changes."
depends_on: [DUST3.1, DUST3.2]
touches: [src/pipeline, src/proxy/server.ts, src/cli, src/credentials, src/providers, src/compression, src/prompt, src/mcp, src/knowledge, src/hooks, src/config, src/pkg, src/tools, src/wiki, src/inference, src/tui, src/session, src/vibe, src/buzz, scripts/release.mjs, tests/unit/tools/catalog.test.ts, tests/unit/knowledge/extractors.test.ts]
created: 2026-10-08
updated: 2026-10-08T18:33:50.771Z
---

## What this is

Comments and strings that contradict the code beside them or the rebaselined spec, still present
on 2026-10-08. **Strings and comments only.** If a fix would need a behaviour change to become
true, do not make it. Reword the comment to describe what the code does now, and list the
behaviour gap in your report.

Work in your own worktree (`git worktree add ../golem-dust3-18 -b dust3-18 development`). Commit
per directory. Bug tasks DUST3.3-DUST3.17 edit some of the same files. Rebase onto whatever has
landed. If a line below has already been rewritten, skip it.

Line numbers are from 2026-10-08. Locate by the quoted text.

## Not in this task (a bug task owns the fix and the comment)

`pipeline.ts` idempotency comment and `redaction.ts:20`, `redaction-rules.ts:16` (DUST3.3);
`proxy-daemon.ts:454-456`, `route-resolver.ts:23` (DUST3.5); `providers/gateways.ts:46`,
`schema.ts:196` (DUST3.6); `rerank.ts:9-12,96-97` (DUST3.8); `fast-path.ts:332-336` (DUST3.9);
`ollama-bootstrap.ts:11-12`, `cases.ts:83` (DUST3.10); `jsonl-store.ts:30-31,558-559` (DUST3.12);
`init.ts:552-553` (DUST3.14); `host-log.ts:22`, `session-bus.ts:111` (DUST3.15);
`acp-agent.ts:56-58,73-74`, `provision.ts:242` (DUST3.16); `tui/state.ts:363-364` (deleted in
DUST3.2); `schema.ts:480` watch_paths (DUST2.14); the `slider` prompt and the "8 frozen prompts"
count (NEEDS-USER, M2).

## The list

**src/pipeline**
- `pipeline.ts:21,163,210,288,508,740`: "slider ≥2/≥3", "persisted slider level", "`slider.level`", "\"off\" at slider 0". Say `compression.level` (semantic from level 2) or the compression dial.
- `redaction-rules.ts:334,403`: "verification-notes §137". It is §140.
- `redaction.ts:325`: "Runs over the ENTIRE JSON". Say every string value; object keys are not redacted (S9 is open).

**src/proxy**
- `server.ts:213-214`: "Every terminal path below now reports". Body-read and gunzip failures (`:530,:580`) destroy without reporting. Reword; do not add `report()`.

**src/cli**
- `proxy-build/sidecars.ts:38`: "first ≥3 request". It is ≥2. `:65,70`: "OFF by default", "opt-in gate". `knowledge.local_answer_enabled` defaults ON (`schema.ts:1150`).
- `plugin.ts:33-34`: "what you see here is what the proxy got". It is a fresh load and can differ from the running proxy.
- `gateways.ts:66`: drop "or exporting the env var". `:168-169,181,196,291`: `account login/use/add/remove` becomes `gateway …`. The `:196,:291` lines are user-facing `InitError` text.
- `gateways/credentials.ts:222,224`: name `envVarForGateway`. `gateways/registry.ts:188-189`: `active` is the gateway id, or the target id when `accountId` is null.
- `commands/mcp-serve.ts:63`: describe the target-id lookup as it is. Do not change the mapping.
- `targets.ts:19`: "In R9.1 the registry is inert". It has routed since R9.2. `:252`: `<gateway>/<model>` is `<gateway>:<model>`. `:375` (user-facing): drop "(stored now, enforced in R9.3)".
- `commands/target.ts:80,110,165` (user-facing): `account login` / `proxy.accounts` become `gateway add/login` / `proxy.gateways`.
- `local-model.ts:4-5`: local answers are the D33 extractive KB path at any level.
- `wiki.ts:464`, `notes.ts:13`, `promote.ts:9,12`: drop "plan-gated" (D44). The separator is a bare `---`, not dated. Also fix the `tests/unit/.../promote.test.ts:99` comment.
- `agents.ts:2-6`: renders every persona's definition; `init-agents.ts` is gone. `init-personas.ts:24-26`: scribe is ledgered now.
- `init-hooks.ts:228-229`: the gate is not "inert at manual"; outward and destructive actions are gated at every level.
- `init.ts:5`: `.claude/settings.local.json` by default (`claude.settings_scope`). `:11` and `:270`: flat `.claude/skills/golem-<cmd>/`. `:12`: created as an empty `{}` marker. `:13`: guidance goes to `.claude/rules/`, and CLAUDE.md is untouched. `:431-439`: `inference.personas.<id>.model`, not `default_coder`.
- `statusline.ts:6-7,235`, `session-report.ts:16` (`getSliderInfo` is gone), `context.ts:168` (user-facing: `proxy.bypass_all` is the full bypass): slider becomes compression dial.
- `commands/session-host.ts:136`: "Invariant 8" becomes ADR-0007 invariant 7. See the note below.
- `commands/init-uninit.ts:82-84`: most sessions pick the change up live (§125); restart only if denied.
- `commands/ps.ts:17`: idle-prune does kill by age when the parent is dead (`:727-740`). Say so.
- `commands/pkg-models.ts:6`: `golem plugin` shipped (R8.11).
- `init-team.ts:80,163-164`: both pieces shipped; init passes `syncTeamLayerForInit`.

**src/credentials**: `index.ts:12-13`, `store.ts:32`: the MCP server does resolve credentials (`credentialEnvForProxy`). `backends.ts:10`: `pwsh`, falling back to `powershell.exe`.

**src/providers**: `index.ts:2,15-16`: the barrel for all providers and translators. `targets.ts:8,12,22`: `proxy.gateways`, routed since R9.2. `openai-translate.ts:427`, `gemini-translate.ts:212` (user-facing): add "or the target's `models[]` / `golem target add --model`".

**src/compression**: `semantic.ts:2,9-10,12,19`, `index.ts:41`, `headroom-adapter.ts:8,582`, `headroom-ccr-bridge.ts:5`: slider becomes `compression.level ≥2`. `headroom-adapter.ts:31`: the pin lives in `./pins.ts`. `headroom-worker.py:24,236,245`: compression dial; `stale_turns` is level 2. `context-substitution.ts:28-29`: `effective-level.ts`'s `isCachingUpstream`.

**src/prompt**: `compact.ts:19`: `golem pkg install` (R8.14, shipped).

**src/mcp**: `prompts.ts:57` (`stats` prompt text): "current slider level" becomes "compression level". `server.ts:78-79`: drop `level` from the instrumented list. `wiki-tools.ts:106` (tool description): "`---` separator". Runs after DUST3.8. `coder-tools.ts:156,173` (tool description): `worker_targets.coder`, then `personas.coder.model`, then `inference.model`. `snooze-note.ts:5`: enforcement is opt-in (advisory default since 2026-09-25).

**src/knowledge**: `driver.ts:5,10-12,137`: `FileVectorDriver` is the default; in-memory is for tests. `index.ts:142,158-159`: `vector_db_url` throws NotImplementedYet. `raw-fetch.ts:11-15`: seeded by the PreToolUse hook's fetch. `extractors.ts:49`: drop the false "used by the `golem ext` registry". `extractors.ts:41` (user-facing): `golem ext status` becomes `golem pkg`. Update the matching assertion in `tests/unit/knowledge/extractors.test.ts:125`.

**src/hooks**: `web-fetch.ts:4-13,134,156`: the pre hook fetches raw, ingests and serves via deny. DUST2.13 edits this file; rebase. `guidance.ts:165`: resume is manual (`golem task resume`, D37). This text generates `.claude/rules/`; regenerate the managed rule files and commit them if a drift test requires it. `host-gate.ts:108-109`: R13.5/R13.6 shipped but are not wired as an answerer.

**src/config**: `schema.ts:623`: PreToolUse hook. `schema.ts:943`: flat `.claude/skills/golem-team-<name>/`. `loader.ts:90`: populated by team-layer fetch. `loader.ts:129`: four enumerated `team.*` keys, not the whole section (do not change the denial). `control-surface-types.ts:98`: order is project, local, user. `:103`: env overrides file layers unless a file declares `!important`. `control-surface-runtime.ts:4`, `control-surface.ts:14,20,30,121`: slider/`setSliderLevel` becomes the compression dial/`setDial`. `control-surface-runtime.ts:122-123`: describe the dial and account scopes as they are. `control-surface.ts:123`: throws only for an env-locked setting.

**src/pkg**: `lsp/index.ts:2`, `lsp/bridge.ts:97`, `lsp/servers.ts:5`: `src/ext/` becomes `src/pkg/`.

**src/tools**: `ext-shrink.ts:14`: `golem pkg`. `catalog.ts:7`: mark the `level` figure as historical. Tests: `tests/unit/tools/catalog.test.ts:8` ("6 remaining tools"), `:44-45` (the figure is now ~1116).

**src/wiki**: `federated-wiki-reader.ts:7,12,45,49`: `src/mcp/search.ts`; "wins on title collision" is for `readPage` only.

**src/inference**: `coder-route.ts:2,49,54,67,98`: it resolves `personas.coder.model` (`default_coder` retired R14.1). Keep the `via: "default_coder"` value; it is pinned by `coder-route.test.ts:73,82`. `target-dispatcher.ts:24`: step 2 is `worker_targets[worker]`, else `personas[worker].model`. `personas.ts:19-24`: lane resolution lives in `persona-lane.ts`.

**src/tui**: `state.ts:403`: dial. `header.ts:44-45`: bypass is flagged by colour on Level only (S11 is DUST3.4).

**src/session**: `host-gate.ts:101-102` (as hooks). `chat-page.ts:22-23,37-38`: D61 setting (unbuilt); R13.7 renders `joined`. `host.ts:21,112,211,278`: invariant 7. `conversation-store.ts:8`: R13.8 shipped without consuming the store.

**src/vibe**: `candidates.ts:7`: `QUIZ_THRESHOLD = 2`.

**src/buzz**: `limit-guard.ts:38`: the R14.5 reference collides with another task id; name the work instead. `harness-definition.ts:10`: `golem buzz install-harness` does not exist; only `golem buzz acp`.

**scripts**: `release.mjs:6-9,69-74` (CLI output): the Prepare-release and release workflows commit, tag and publish.

## ADR-0007 numbering note

`docs/decisions/ADR-0007-remote-conversation-and-hosted-sessions.md` numbers the base-URL rule 7
in its list (`:286`) but calls it "invariant 8" at `:167,:329`. The code copied the 8. Use the
list number (7) in code. Report the ADR inconsistency; do not edit the ADR in this task.

## Outcome

shipped (PRs 242-256); hard-rule branches independently reviewed, see the Phase 3 debrief
