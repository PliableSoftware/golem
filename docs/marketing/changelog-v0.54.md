# Changelog draft: the v0.54 line and the security work after it

**DRAFT. Not published. Not a source of truth.** See [`README.md`](README.md). Written 2026-10-08 on branch `dust5/changelog`. Facts come from [`CLAIMS.md`](CLAIMS.md) or from a named commit; each entry ends with an HTML comment naming its ledger id or sha. Nothing in this file is a release note, an advisory or an announcement. Whether to cut a release or publish an advisory is the user's decision (DUST5.8).

## Read this first: what the tags say

Run on 2026-10-08 in this worktree (`git tag --sort=-v:refname`, `git tag --contains <sha>`):

- Tags in the v0.54 line: `v0.54.0` (`b949fd3`, PR #182, 2026-09-07) and `v0.54.3` (`1719982`, PR #200, 2026-09-23). `v0.54.3` is the newest tag. There is no `v0.54.1` or `v0.54.2` tag.
- The release commits `54f089a` (`chore(release): v0.54.1`, 2026-09-16) and `43ac834` (`chore(release): v0.54.2`, 2026-09-20) exist and are both contained in `v0.54.3`.
- `npm view @pliable/golem versions`, read-only on 2026-10-08, returned exactly one version: `0.54.2`. This read does not show `0.54.3` on the registry, and it does not show what was installed from any other channel. Whether `v0.54.3` was ever published is not established by this draft.
- **`git tag --contains` returned no tag for any DUSTSEC fix commit** (every DUSTSEC fix commit cited in this file was checked, 30 shas including the three DUSTSEC.19 commits). Every fix is on `development` only.

So: **every tagged build, `v0.54.0` and `v0.54.3` alike, lacks all of the DUSTSEC fixes.** The `0.54.2` build on npm was not checked directly: its source commit is unknown but is `2fc7cd2` or later, and no tag contains any fix. Anyone running a build from this line should treat the weaknesses in the security section as present in it, with one caveat: for each item the section says which tagged builds were checked directly and which were not. No wording in this draft says that current releases are protected. <!-- B-29; git tag --contains over the fix shas; 1719982; b949fd3 -->

## Unreleased (on `development`, in no tag)

### Security fixes: DUSTSEC.1-9 and 11-19 merged (all unreleased), DUSTSEC.10 open

These came out of Dust Phase 1, a set of eleven read-only audits by project agents (the audit is `docs/plan/audit/dust-1/SUMMARY.md`; the choices are the USER decisions in `docs/plan/audit/dust-1/DECISIONS.md`). They were then reviewed twice by a separate reviewer agent in this project (the first review returned VERDICT: block, the second VERDICT: concerns with no High). That is not an outside audit, and it is not a certification. DUSTSEC.18 got no third review. <!-- B-27; B-28; debrief 2026-10-08-DUSTSEC-security-batch.md; merged PRs #213-#219, #221-#224, #227, #228 -->

Severity below is the label the Phase 1 audit gave. "Reach" says what an attacker or accident needed. No step-by-step reproduction is given on purpose.

**Why this is not "no known issues".** The bypass guard (DUSTSEC.3) is a guard on common spellings, not a sandbox. The reviews found follow-ups, which are DUSTSEC.17 and DUSTSEC.18. DUSTSEC.19 closed one gap and its review found others that are still open (below), and DUSTSEC.10 is not closed. <!-- C-07; B-28 -->

#### The HIGH items

**DUSTSEC.1: a pipeline error forwarded the unredacted request** (audit S3, HIGH).
- Was wrong: if any stage inside the pipeline threw, the proxy forwarded the original request body upstream instead of the redacted one. A test pinned that behaviour as intended. A failed write to the local compression store (for example a full disk or a permission error) was one reachable cause.
- Reach: no attacker needed. An ordinary local fault was enough.
- Fix: on a pipeline error the proxy now re-runs redaction alone on the original request and forwards that. If redaction itself throws, it answers 502 and forwards nothing.
- Status: fixed on `development` in `5261293`, PR #214 (merge `8c3885a`). In no tag.
- Affected released builds: present in `v0.54.3` and `v0.54.0` as far as the audit baseline goes; the throw sites were not traced tag by tag.
<!-- C-03; 5261293; 8c3885a -->

**DUSTSEC.2: an unauthenticated endpoint switched redaction off** (audit S2, HIGH).
- Was wrong: `POST /__golem/pipeline/false` on the local proxy turned off the whole pipeline, redaction included. It had no authentication, no origin check, was not persisted and showed up in no status output. A per-request header, `x-golem-bypass`, was a second way to skip redaction.
- Reach: any local process, an agent's Bash tool, and, by the audit's reasoning (not tested in a browser), a web page the user visited, because the request is a simple cross-origin POST to the loopback port. The audit did probe the endpoint directly: a request that carried a raw key reached the upstream unredacted.
- Fix: the endpoint is removed and the header is only stripped. Redaction can now be switched off in one way, the setting `proxy.bypass_all`, which defaults to off, takes effect when the proxy starts, and is set from the CLI. When it is on, status output carries a warning.
- Behaviour change: `golem on` and `golem off` now persist but need a proxy restart, because the live toggle was the removed endpoint.
- Status: fixed on `development` in `8fe5daa`, PR #214. In no tag.
- Affected released builds: the endpoint and the header were found by `git grep` in `src/proxy/server.ts` and `src/proxy/headers.ts` at `v0.53.0`, `v0.54.0` and `v0.54.3`. All three tags are affected.
<!-- C-04; C-05; 8fe5daa; 8c3885a -->

**DUSTSEC.4: the team-portal access token could be sent to a host a repository chose** (audit S4, HIGH).
- Was wrong: a repository could commit a team binding that named its own portal URL. The next time a member ran `golem init` (with a token present) or the team sync commands, the client sent the portal access token, as a bearer credential, to that URL. The token was looked up by issuer and was not matched to the host it was sent to. A refresh after a 401 re-sent a fresh token the same way, and neither URL had an https check.
- Reach: a repository author. A hostile or compromised repo that a member clones and works in.
- Fix, first pass: the token is bound to the API origin recorded at link time, https only (loopback http is exempt). It is never sent, or re-sent after refresh, to another origin. Note the deviation from the task brief: the brief asked for the issuer origin, but issuer and API are different origins in production, so the API origin is used. Tokens linked before this change need one `golem team link`.
- Follow-ups from the reviews: the refresh path also had to be bound (DUSTSEC.17, `cb313c7`, PR #221), and `golem team link` had to refuse a portal identity that a project settings file supplies (DUSTSEC.17, `078b77f`, PR #221); then a committed local settings file could still supply the portal URL because git tracks it even when ignored, and redirects had to be refused (DUSTSEC.18, `dcba38a`, `8e1d5be`, `2e737ea`, PR #227). `golem team link` now refuses portal identity that a project or local settings file supplies and takes explicit `--portal-url` and `--issuer` flags. The token POST and the discovery GET refuse redirects. A remote team layer cannot set the portal identity keys (`portal.url`, `portal.issuer`, `portal.client_id`).
- Status: fixed on `development` in `6e9ca6c` (PR #213, merge `508d078`), with follow-ups in PR #221 (merge `44876b4`) and PR #227 (merge `d74cc11`). In no tag.
- Affected released builds: present in `v0.54.3` per the audit baseline; earlier tags not traced.
<!-- C-06; 6e9ca6c; 508d078; cb313c7; 078b77f; 44876b4; dcba38a; 8e1d5be; 2e737ea; d74cc11 -->

**DUSTSEC.5: the autonomy classifier let a newline-chained command count as `read`** (audit S5, HIGH).
- Was wrong: the check for chained shell commands did not treat a newline or carriage return as a separator, so a command that started with a safe read-only word followed by a second command on the next line was classified as `read`. At an autonomy level above `manual` that was auto-allowed. The same classifier also over-approved three forms as `read`: `git branch -D`, linter autofix flags, and `git diff --output`. There was no test with a newline in it.
- Reach: a command proposed by a model or an agent, at a non-`manual` autonomy level. It does not matter at `manual`.
- Fix: newline- and carriage-return-chained commands are never `read`; the three over-approvals are gated. Follow-ups: quoted write flags, `npm test -u`, and branch-listing forms (DUSTSEC.17, `4716115`, PR #223), then judging git write flags on shell words so a quoted search term is data (DUSTSEC.18, `56983c4`, PR #228).
- Status: fixed on `development` in `7528c67` (PR #213), `4716115` (PR #223, merge `508d67b`) and `56983c4` (PR #228, merge `1d61de5`). In no tag.
- Affected released builds: present in `v0.54.3` per the audit baseline; earlier tags not traced.
<!-- 7528c67; 508d078; 4716115; 508d67b; 56983c4; 1d61de5 -->

**DUSTSEC.16: the npm package name changed without its consumers following** (audit S1, HIGH).
- Was wrong: `package.json` changed its `name` from `golem-run` to `@pliable/golem` in `2fc7cd2` (2026-09-23), inside a `fix:` commit about gateway model shapes. `golem update`, the installers, `ps` detection, the lockfile and the docs still named `golem-run`. By the audit's dated check on 2026-09-26, `golem-run` was not registered on npm (404). So `golem update` was checking a package that did not exist, and the unregistered name was open to anyone who registered it, which would have put their code in the path of the installers and of `golem update`. This draft has not re-checked the registry for `golem-run`, so it does not say whether anyone has registered it.
- Reach: a third party registering the old name. No access to the user's machine needed beyond the user running the installer or `golem update`.
- Fix: `golem update`, the installers, `ps` detection, the lockfile and the docs now use `@pliable/golem` (the canonical name, C-26). Claiming `golem-run` itself is an open task that belongs to the user.
- Status: fixed on `development` in `8b64e0b`, `a2cd6f0`, `0486815`, PR #219 (merge `c34fd52`). In no tag.
- Affected released builds: `v0.54.0` still names `golem-run` in `package.json`; the rename is first in `v0.54.3` (`2fc7cd2` is contained in `v0.54.3` only). So the mismatch is in `v0.54.3`. By the registry read above `@pliable/golem@0.54.2` is the one version on npm under the new name; its source commit is unknown but is `2fc7cd2` or later.
<!-- C-26; B-24; 8b64e0b; a2cd6f0; 0486815; c34fd52; 2fc7cd2; 1719982 -->

**DUSTSEC.6: the Buzz key parser could write the secret key as the public key** (audit S6, HIGH, rated "not currently reachable").
- Was wrong: a regular expression carried the global flag and was reused, so the labelled branch of the keygen-output parser never won and the positional fallback swapped the two keys. The value taken for the public key would then be committed to `.golem/buzz/agents.json`.
- Reach: the audit found no CLI that reached the provisioning code at the time, and said so. This draft did not re-test reachability. `v0.54.3` contains the identity code (`984e75b`) and the defective expression (`src/buzz/identity.ts:59` at that tag). It does not appear at `v0.54.0`.
- Fix: the parser can no longer take the secret as the public key. Follow-ups: no positional guessing (DUSTSEC.17, `c51ea0c`, PR #222), and anchoring labels to line start so a curve name is not mistaken for a label (DUSTSEC.18, `9065c85`, PR #228).
- Status: fixed on `development` in `5699cdf` (PR #213), `c51ea0c` (PR #222, merge `8c5d203`), `9065c85` (PR #228). In no tag.
<!-- 5699cdf; 508d078; c51ea0c; 8c5d203; 9065c85; 1d61de5; 984e75b -->

#### The other security-relevant items

**DUSTSEC.3: a guard against an agent turning redaction off.** A Claude Code PreToolUse hook denies the documented ways an agent's Bash or file edit would set `proxy.bypass_all`. It guards common spellings; it is not a sandbox. After review it also catches pipelines into a shell, `env -S`, a shell flag before `-c`, here-strings and edits that flip only the value, and treats heredoc bodies as data (the earlier version denied ordinary file writes). Not caught, among others: `cat file | sh`, process substitution, a shell invoked through a variable, a settings file written by other means (`echo >`, `jq`, `sed -i`, a script), base64, and a binary renamed away from `golem`. Reach: an agent with Bash. Status: `3551148`, PR #214; follow-ups `b81e0c5` (PR #223) and `6702e63` (PR #228). In no tag. <!-- C-07; 3551148; 8c3885a; b81e0c5; 508d67b; 6702e63; 1d61de5 -->

**DUSTSEC.7: the built-in redaction rule table was exported mutable.** Code that imported the table could change the rules. The exported rules are now a frozen copy with their own RegExp objects (freezing the array alone was not enough, because `re.compile()` still rewrites a frozen RegExp). Reach: in-process code, which includes any plugin; a plugin has process authority anyway, so this is not a claim that a plugin cannot weaken redaction. Status: `5e4407c`, PR #215 (merge `513a5e3`). In no tag. <!-- B-30; 5e4407c; 513a5e3 -->

**DUSTSEC.8: plugin redaction rules were missing on some paths.** Plugin rules reached the proxy and MCP paths but not the hook, vibe, join-queue, note and session-state paths, which run in other processes. They now apply on all of them. `golem acp` did not load them either (DUSTSEC.17, `357db99`, PR #222). Reach: secrets that a plugin rule was meant to catch, on those paths. Status: `69179f2`, PR #215; `357db99`, PR #222. In no tag. <!-- 69179f2; 513a5e3; 357db99; 8c5d203 -->

**DUSTSEC.9: vibe `sources.json` and `candidates.jsonl` were written unredacted.** `candidates.jsonl` holds free-text notes. Both are now redacted before write. Reach: secrets pasted into a note. Status: `9e562de`, PR #215. In no tag. <!-- 9e562de; 513a5e3 -->

**DUSTSEC.11: `owner: user` did not bind the worker lane.** A task marked `owner: user` could still be dispatched to a worker. It now refuses, including under an explicit `target` (DUSTSEC.17, `b897dd2`, PR #224). Reach: the model or the dispatching session. Status: `8b4e3a6`, PR #216 (merge `9105b66`); `b897dd2`, PR #224 (merge `4aa8d5a`). In no tag. <!-- 8b4e3a6; 9105b66; b897dd2; 4aa8d5a -->

**DUSTSEC.12: the shim ran compression.** The decision (D56(c)) is that the shim runs redaction only. It ran level-1 compression. Now fixed to redaction only. This is a conformance fix to a recorded decision, not a leak. Status: `21ea2e5`, PR #218 (merge `30aea0a`). In no tag. <!-- 21ea2e5; 30aea0a -->

**DUSTSEC.13: `inference.worker_targets` was listed as retired but is live.** The setting is off the retired list and documented. Not a vulnerability. Status: `13aaf24`, PR #217 (merge `27b0622`). In no tag. <!-- 13aaf24; 27b0622 -->

**DUSTSEC.14: an invalid team value stopped the proxy from starting.** It now warns and skips the whole team layer; the proxy starts. Reach: a bad value in a team row (an availability problem, not a leak). Status: `b30ca87`, PR #217. In no tag. <!-- C-21; b30ca87; 27b0622 -->

**DUSTSEC.15: an unknown `default_target` could fall through.** It now always fails closed, single-target setups included. Behaviour change: a config that named an unknown target and worked before now fails. A follow-up corrected a warning that said the shim refuses requests (DUSTSEC.17, `76c866f`, PR #224). Status: `fd5b1dd`, PR #218; `76c866f`, PR #224. In no tag. <!-- fd5b1dd; 30aea0a; 76c866f; 4aa8d5a -->

#### DUSTSEC.19: redaction covered only `POST /v1/messages`. Merged, unreleased.

- What was wrong: redaction ran on the JSON body of `POST /v1/messages` only. A request to another path, such as the token-count route or the batches route, was forwarded as it arrived. It was found while the claims ledger was being built, and it is a hard-rule gap because the proxy's promise is that secrets are redacted before they reach the upstream.
- Reach: a client sending such a request through the proxy.
- Affected released builds: all of them, by the evidence of the tags (no tag contains the fix). This draft did not trace it tag by tag.
- Status: fixed on `development` in PR #265 (code `109f32b`, task doc `d52dbf8`, test `96d9b81`). Every JSON object or array body on any route now gets the same redaction rules, in the same order, with plugin rules, and the fail-safe path covers the same routes. Level `off` still redacts; `bypass_all` is unchanged. No tag contains it.
- What it does NOT cover, found by a review of the change by a separate reviewer agent in this project (not an outside audit) and tracked as separate work: a JSON body sent with a content encoding such as gzip, or one that begins with a byte-order mark, fails to parse and is forwarded unredacted; a body that is not JSON (multipart uploads, plain text) is forwarded unchanged and a test now pins that; the redaction walk is synchronous with no size cap on the request body.
- A related defect that already existed on the main messages route, not introduced here: the redaction's long-token rule also rewrites some 33 and 34 character API ids (server tool and batch ids), which the API then rejects, and this change extends that behaviour to the token-count and batches routes. It is tracked as its own task.
<!-- C-01; 109f32b; d52dbf8; 96d9b81; 68580a4 -->

#### Open

**DUSTSEC.10: open, awaiting a USER decision.** The task stopped at its first verify step and is queued. Nothing is claimed here about what it will do. <!-- docs/plan/tasks/DUSTSEC.10.md; B-07; d0d973b -->

### Other security-relevant fixes found in Dust Phase 3 (on `development`, in no tag)

Phase 3 re-checked the Phase 1 findings against current code (52 did not reproduce) and fixed the remaining ones. These are the security-relevant ones, named in the Phase 3 debrief. Whether each was present in a tagged build was not traced; the debrief records the Gemini credential forward as pre-existing and several others as caught in review of the Phase 3 changes. Nothing is claimed here beyond the commit subjects.

- A plugin that changed a request in place skipped re-redaction (S8), and the `connection-password` rule re-matched its own placeholder so a second pass renumbered it (S10). Fixed in PR #245 (`7f0fd7d`, `84d6059`, `6b7af50`; merge `fb9673c`). <!-- 6b7af50; 84d6059; fb9673c -->
- The redaction-off warning was dropped when an update was available (S11), and `golem proxy status` did not say redaction was off under `bypass_all` (S12). Fixed in PR #249 (`0f5eb87`, `d41db02`; merge `5693427`). <!-- 0f5eb87; d41db02; 5693427 -->
- Gateway ids that map to the same credential variable (S16) are rejected, and the Gemini key is sent as a header rather than in the route path (S21). The review also found that with no Gemini key stored the client's Anthropic credential was forwarded to Google; the Gemini route now always strips it (`d03ec9b`). Fixed in PR #252 (merge `8a39976`). <!-- 860aaf8; fabe0db; d03ec9b; 8a39976 -->
- Wiki draft slugs and an explicit `rel_path` were stored without redaction in a committed tree, and `promote` applied only built-in rules (S13). Fixed in PR #255 (`6ecadc9`, `25864d4`; merge `aeec9a7`). <!-- 6ecadc9; 25864d4; aeec9a7 -->

### Other work on `development` (not security)

- Phase 2 rebaseline of the spec, wiki and ADRs against the shipped code, and the hard-rule wording change from the retired wording to "lossless and prefix-stable at level <= 1" (PR #225, `32f3b64`, merge `6a1f0d9`; Phase 2 is PRs #225 and #230-#240). Redaction and dedup rewrite the body, so the older wording was dropped. <!-- C-11; B-20; 32f3b64; 6a1f0d9 -->
- Phase 3 refactor: PRs #242-#256, 12 safe dead-code deletions and 63 confirmed bugs. Tests went from 4296 to 4464 per the Phase 3 debrief. 25 dead-code proposals were left for the user. <!-- 2026-10-08-DUST3-refactor.md; a857765; 9cf5432 -->
- Drafts under `docs/marketing/` are excluded from local answers (PR #259, `49bd546`, merge `51e6681`). <!-- C-15; 49bd546; 51e6681 -->
- The claims ledger (PR #262, merge `f866023`). <!-- f866023 -->

## v0.54.3 (tag `v0.54.3`, `1719982`, 2026-09-23)

Tag contains every item below; each item's own commit is named. The release commit is `1b08402`.

- Buzz: a persistent identity is minted per Buzz-addressable agent (R14.2, `984e75b`); the `golem acp` CLI, turn engine and harness definition (R14.3, `34575a5`, `bbfc7fe`, PR #202, merge `2536cca`). <!-- 984e75b; 34575a5; bbfc7fe; 2536cca -->
- The proxy retries 429/529 responses with backoff, generalised from Buzz (R14.5, `1e84c45`). <!-- 1e84c45 -->
- Fixes for gateway/target model-shape mismatches and a session-model dispatch regression (`2fc7cd2`). The same commit changed the package name; see DUSTSEC.16 above. <!-- 2fc7cd2 -->
- A time-of-check/time-of-use race in the telemetry full-reparse checkpoint was closed (`3165e21`). <!-- 3165e21 -->
- Also in the line: a `golem-adversarial-review` skill wired into default persona prompts (`7fa8cbb`); the coder persona routed to a free OpenRouter worker-lane target (`21960ef`). <!-- 7fa8cbb; 21960ef -->

## v0.54.2 (release commit `43ac834`, 2026-09-20; no tag)

`@pliable/golem@0.54.2` is on npm per the read above. Its source commit is unknown, but it is `2fc7cd2` or later, because the package was still named `golem-run` at the release commit `43ac834`. Release commit `43ac834` is contained in tag `v0.54.3`. Changes since 0.54.1 include personas auto-sync (`032d20f`, PR #201, merge `3805228`) and the Buzz design docs. <!-- 43ac834; 032d20f; 3805228 -->

## v0.54.1 (release commit `54f089a`, 2026-09-16; no tag)

Contained in tag `v0.54.3`. Includes the fix finishing the `inference.default_target` to `inference.model` rename, which had silently discarded a target (`5647ba6`), and the retirement of `worker_targets` in favour of the worker persona's model (`b2fae4b`; DUSTSEC.13 later reversed that). <!-- 54f089a; 5647ba6; b2fae4b; 13aaf24 -->

## v0.54.0 (tag `v0.54.0`, `b949fd3`, 2026-09-07)

PR #182. Everything after it up to `v0.54.3` is the list above plus these, all contained in `v0.54.3` and not in `v0.54.0`:

- A project can be bound to its team in committed config (PR #185, `6ffa72a`, merge `c0abe9a`); the proxy and `golem status` load through the team layer (PR #188, `80a665b`, merge `694f313`); `golem team skills` and `golem team sync` (`9e575d9`, `0e15996`); the team origin fetches per-org (`ee5846d`). The team layer's own ranking is in the ledger (C-21). Where team policy is enforced is an open question and is not claimed here (B-01). <!-- C-21; B-01; 6ffa72a; c0abe9a; 80a665b; 694f313; 9e575d9; ee5846d -->
- A personal style guide (`golem vibe`) (PR #195, `7f1e3a0`, merge `1f4b612`). <!-- 7f1e3a0; 1f4b612 -->

## Open points in this draft

- Whether `v0.54.3` was published to npm is not established (the registry read lists `0.54.2` only).
- Per-tag presence of defects was checked directly only for DUSTSEC.2 (endpoint and header at `v0.53.0`, `v0.54.0`, `v0.54.3`), DUSTSEC.16 (name at `v0.54.0` and `v0.54.3`) and DUSTSEC.6 (code at `v0.54.3`, absent at `v0.54.0`). For the rest, the audit baseline is the only evidence.
- DUSTSEC.19 is merged but unreleased, and its follow-up gaps are open. DUSTSEC.10 is open.
- This draft changes no source and edits no roadmap, shipped log or task state.
