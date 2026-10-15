# DUST1.10 — portal, team layer, Buzz, remote/hosted sessions: audit findings

Status: COMPLETE. Read-only audit, 2026-09-25, branch `dust/DUST1.10` off `development` @ `fd3aedc`.
Scope per `docs/plan/tasks/DUST1.10.md`. The portal repo (`D:/Personal/Projects/Golem`) was not read;
claims that need it are under **Unverifiable here**. A debrief or task doc was treated as a claim, never
as evidence. No tests were run; "test evidence" names the file that pins a behaviour, found by grep.

## Bucket counts

| class | rows |
|---|---|
| shipped-and-matches | 44 |
| shipped-but-drifted | 20 |
| partial | 7 |
| not-started | 9 |
| dead-or-superseded | 5 |
| **total** | **85** |

Severity-ranked defects found along the way are in **Defects** (after the table). The five most
serious: D1 (portal token sent to a repo-chosen host), D2 (Buzz keygen parser can commit the secret
key), D3 (`golem init` reports a 402 as "up to date"), D4 (team layer absent from ~45 config loads
and lost on proxy hot-reload), D5 (SSE drop frame makes a reconnecting client skip an event).

## Findings table

Paths are repo-relative. "Wiki" = `docs/wiki/concepts/`. Tasks: `none` means no task doc covers it.

### ADR-0006 / Decision 59 (remote steering)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 1 | Capability 1 observe: read-only surface on a separate server from the write surface | ADR-0006 §1; Wiki Device Authentication "What is NOT gated" | `src/security/write-server.ts:160-170` is its own `https.createServer`; dashboard untouched | `tests/integration/session-transport.test.ts:189` | shipped-and-matches | dashboard internals owned by another partition, not re-read | R12.5 (done) |
| 2 | Capability 2 class line enforced at `PermissionRequest` deny | ADR-0006 R12.11/R12.12 block | `src/hooks/permission-request.ts` exists (not owned; not re-read) | — | shipped-and-matches | live pre-emption of a channel relay still unobserved | R12.13 (queued, owner user) |
| 3 | 59(a) "destructive/outward never remotely approvable, no setting to change it" | Decision 59(a); ADR-0006 §2, §8, threat-model row | superseded on its "no setting" clause by Decision 61 | — | dead-or-superseded | ADR-0006 §2/§8/threat model still state it without an amendment pointer | none |
| 4 | Decision 61: gate-map item 3 as an off-by-default setting, fresh re-auth per answer, loud log, kill switch | Decision 61(a)-(c); ADR-0007 §3d row 3 | no such key in `security` section (`src/config/schema.ts:634-678`, defaults `:1152-1161`) | — | not-started | | R13.9 |
| 5 | mTLS device pairing: Golem-issued client certs, `requestCert`, no bearer token | ADR-0006 §3a; ADR-0007 §7a | `src/security/write-server.ts:165-168` sets `requestCert: true, rejectUnauthorized: false`, verifies per request | `tests/integration/session-transport.test.ts:189` | shipped-but-drifted | ADR-0006 §3a says `rejectUnauthorized: true`; code deliberately differs and documents why (`write-server.ts:16-26`). Code looks right; ADR text stale | none |
| 6 | Relay, account, 2FA, self-host tested path (59(c)-(e), ADR-0006 §3b/§3c) | Decision 59(c)-(e); ADR-0007 §7d | nothing in `src/` | — | not-started | explicitly phase 2 | R13.10 |
| 7 | Silence denies (59(f), ADR-0006 §5) | Decision 59(f); ADR-0007 inv 3 | hosted: `src/session/host-gate.ts:123-133`; joined: `src/session/joined-sessions.ts:152-163`, `src/session/join-queue.ts:150-153` | `tests/unit/session/host-gate.test.ts` | shipped-and-matches | | — |
| 8 | Decision binding `{session, tool, digest, nonce, deadline}` | ADR-0006 §4 | none | — | dead-or-superseded | belonged to R12.3, cancelled by 59(i); no ADR note says §4 is dead | none |
| 9 | Remote decisions logged to `autonomy-log.jsonl` with device fingerprint | ADR-0006 §7 | host path uses its own log instead (`src/session/host-log.ts:8-20`) | — | dead-or-superseded | replaced by ADR-0007 inv 4's host log; ADR-0006 §7 not amended | none |
| 10 | Capability 3 "does not exist" / DECLINED | Decision 59(g); ADR-0006 capability table | superseded by Decision 60 | — | dead-or-superseded | | — |
| 11 | `golem device revoke` works while the phone is off | ADR-0006 §6; Wiki Device Authentication "Revocation" | `src/cli/commands/device.ts` (command group at `:49`); catalog-per-request claim not re-read in `src/security/` | — | shipped-and-matches | security internals owned by another partition | R13.4 (done) |

### ADR-0007 / Decision 60 (hosted + joined sessions)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 12 | Hosted runner = one long-lived `claude -p --input-format stream-json` process through the proxy | ADR-0007 §3a; Wiki Hosted Session | `src/session/host.ts:40-53`, `:238-255` (`ANTHROPIC_BASE_URL` forced) | `tests/integration/hosted-session.test.ts` | shipped-but-drifted | ADR-0007 **Revision 2** says multi-turn stdin "could NOT be reproduced… do not attempt"; §3a and code say the opposite (code cites §147, client 2.1.246). See Contradictions C1 | none |
| 13 | Host decision enum separate from `GateEmission`; destructive/outward deny; derives from `decideGate` | Wiki Hosted Session "Two enums"; Decision 60(d) | `src/session/host-gate.ts:39`, `:67-86` | `tests/unit/session/host-gate.test.ts` | shipped-and-matches | destructive/outward are short-circuited before `decideGate` is called (`:68-82`), so "derives" holds only for the other classes | — |
| 14 | Unanswered `ask` is a refusal, not a wait | ADR-0007 inv 3; Wiki Hosted Session | `src/session/host-gate.ts:123-133`; `src/hooks/host-gate.ts:111` | `tests/unit/session/host-gate.test.ts` | shipped-and-matches | | — |
| 15 | Host injects its own `PreToolUse` gate via `--settings`, synchronous | Wiki Hosted Session "The gate is the host's own" | `src/session/host-settings.ts:67-92` | `tests/integration/hosted-session.test.ts` | shipped-and-matches | | — |
| 16 | Host gate fails closed (deny), guest gates fail silent | Wiki Hosted Session "Fail-closed" | `src/hooks/host-gate.ts:89-96`, `:138-141` | — | shipped-and-matches | | — |
| 17 | Attribution written and awaited BEFORE delivery | ADR-0007 inv 4; Wiki Hosted Session, Session Transport | `src/session/transport.ts:324-341`; `src/cli/commands/session-host.ts:170-177`, `:347-354` | `tests/integration/session-transport.test.ts` | shipped-and-matches | the per-decision line is best-effort (`src/hooks/host-gate.ts:123-126`); wiki says "every tool decision is written too" | — |
| 18 | Remote-authored turns "surfaced locally" to the developer | ADR-0007 inv 4 | pull-only: `golem session host log` (`session-host.ts:407-443`), `golem session pending` (`src/cli/commands/session.ts:76`) | — | partial | nothing pushes to the developer's terminal or status line | none |
| 19 | Host log bounded to 5,000 lines | `src/session/host-log.ts:22-31` (and Wiki Hosted Session implies an audit trail, not an archive) | `trimHostLog` (`host-log.ts:111`) has **no caller** in `src/` (grep) | — | shipped-but-drifted | the bound is never applied; the file grows without limit | none |
| 20 | Hosted session "parks at the usage limit like anything else" | ADR-0007 inv 7 | `session-host.ts:133-136`, `:266-268` map ANY `rate_limit_event` to a `parked` event; nothing parks | — | partial | ADR §3a itself says the park is reasoned-not-confirmed. The wire event `parked` means "the park fired" (Wiki Session Transport) but only means "a rate-limit event was seen" | none |
| 21 | Interrupt a running turn from the device | ADR-0007 §2 "Achievable, and required of R13" | `session host serve` passes no `interrupt` (`session-host.ts:295-307`) so `/interrupt` answers 501 (`transport.ts:469-480`) | — | partial | `HostedSession.kill` exists (`host.ts:317-319`) but is not wired to the route | none |
| 22 | Permission questions answered in place from the device | ADR-0007 §2; `src/session/chat-page.ts:9-10` | `resolveHostGate(decided)` always called with the default `NOBODY_ATTACHED` (`src/hooks/host-gate.ts:111`) | — | not-started | every `unknown` Bash in a hosted session is refused outright | R13.9 |
| 23 | SSE down / POST up, seq, 500-event ring, `gap: true`, 15 s heartbeat, drop a subscriber >200 behind | Wiki Session Transport; ADR-0007 §7c | `src/session/session-bus.ts:35-38`, `:91-140`; `transport.ts:50`, `:199-277` | `tests/unit/session/session-bus.test.ts:94`; `tests/integration/session-transport.test.ts` | shipped-but-drifted | on drop, `transport.ts:230-238` writes a synthetic `ended` frame with `id: cursor+1`. See D5 — "nothing was lost" (`session-bus.ts:111`) is false, and `ended` ("the session is over") is sent for a live session | none |
| 24 | Idempotent POST by `messageId` ("exactly once") | Wiki Session Transport; Wiki Joined Session | `transport.ts:311-387` (look up, await log, await deliver, then record) | — | shipped-but-drifted | check-then-act: two concurrent POSTs with one `messageId` both deliver. See D8 | none |
| 25 | ACK means delivered; refusal → 502 | Wiki Session Transport | `transport.ts:376-388`; serve's `deliver` resolves after `stdin.write` (`session-host.ts:303-305`) | `tests/integration/session-transport.test.ts` | shipped-and-matches | | — |
| 26 | 413 above 32,000 chars; 128 KiB body cap sits above it | Wiki Session Transport | `transport.ts:53`, `:300-309`; `src/security/write-server.ts:54` | — | shipped-and-matches | edge: 32,000 control chars JSON-escape to about 192 KB, so the outer cap can still speak first | — |
| 27 | Joined session: queued for the next request, fenced block, off by default, 12 h TTL, exclusive-create claim | Wiki Joined Session; ADR-0007 §3b | `src/session/join-queue.ts:66`, `:188-234`; `src/cli/proxy-runtime.ts:238-261`; `joined-sessions.ts:152-178` | `tests/unit/session/join-queue.test.ts`; `tests/integration/join-injection-proxy.test.ts`; `tests/unit/pipeline/join-injection-stage.test.ts` | shipped-and-matches | enqueue has the same check-then-act race as #24 (`join-queue.ts:147-179`), so "never twice" holds at claim time only | — |
| 28 | Ambiguous key refused; addressable again after 30 min idle; conversation id = hash of first message | Wiki Joined Session | `src/session/live-conversations.ts:46`, `:110-116`, `:206-223`; key matches `src/proxy/cache-prefix.ts:182-185` | `tests/unit/session/live-conversations.test.ts` | shipped-and-matches | snapshot throttle (`live-conversations.ts:259-262`) can leave the LAST request of a burst unsnapshotted until another request arrives | — |
| 29 | `GET /sessions` lists every addressable session, hosted AND joined | `transport.ts:39-40`, `:113-122` | `device serve` passes no `hosted` (`src/cli/commands/device.ts:237-251`); `session host serve` passes no `listSessions` (`session-host.ts:294-308`); both bind `security.write_port` (default 4655, `schema.ts:1152`) | — | partial | one process cannot show both, and both cannot run at once on the default port | R13.8 |
| 30 | Conversation store: redacted before write, `0o600`, 32 convs / 30 days, `forget` / `forget --all`, gitignored, shared id | Wiki Conversation Store; ADR-0007 §6 | `src/session/conversation-store.ts:90-116`, `:170-205`, `:243-304` | `tests/unit/session/conversation-store.test.ts`; `tests/unit/cli/session-forget.test.ts` | shipped-and-matches | | — |
| 31 | The store feeds scrollback and continuation; "consumers: session host (R13.3), transport (R13.5)" | Wiki Conversation Store "The frozen contract"; ADR-0007 §6 | the only production user is `session forget` (`src/cli/commands/session.ts:186`); `appendTurn` has **no production caller** (grep); `/history` is never wired for hosted or joined (`session-host.ts:295-307`, `joined-sessions.ts:140-188`) | — | partial | R13.3/R13.5 shipped without consuming it. The store is only ever written by tests | R13.8 |
| 32 | Store bounds "both configurable" | Wiki Conversation Store "How long it's kept" | constructor options only (`conversation-store.ts:118-141`); no config key; `forProjectDir(dir)` with no options (`session.ts:186`) | — | shipped-but-drifted | configurable in code, not by a user | none |
| 33 | Start a new conversation / continue one from the device | ADR-0007 §2, Decision 60(j) | no origination route | — | not-started | | R13.8 |
| 34 | Gate map items 1-9 as real controls | ADR-0007 §3d | none. Item 5 has plumbing (`src/security/write-guard.ts:100`) but `stepUpPaths` is never passed (`write-server.ts:157`, grep) | — | not-started | | R13.9 |
| 35 | Two factors (cert + passcode); windows 15 / 5 / 2 min; step-up measured from when the passcode was typed | Wiki Device Authentication | `schema.ts:650-659`, `:1155-1157`; `write-guard.ts:100` | — | shipped-but-drifted | step-up is never required on any route (#34), so "high-risk acts measure against when the passcode was typed" has no route to apply to | R13.8 |
| 36 | Chat surface names the session kind; no approve button for destructive/outward | ADR-0007 §2; `chat-page.ts` header | `src/session/chat-page.ts:30-40`; route `transport.ts:429-445` | `tests/integration/chat-surface.test.ts` | shipped-and-matches | header comment is stale; see Stale comments | — |
| 37 | `session-tree.ts` stores hashes only; the store is the one exception | ADR-0007 §6; Wiki Conversation Store | `src/session/session-tree.ts:1-11`; `live-conversations.ts:26-31` | `tests/unit/session-tree.test.ts` | shipped-and-matches | | — |
| 38 | Invariant 6: with injection off, no queue is handed to the pipeline | ADR-0007 inv 6; Wiki Joined Session | `proxy-runtime.ts:241-260` builds `joinQueue` only when `security.join_injection` | `tests/integration/join-injection-proxy.test.ts` | shipped-and-matches | | — |
| 39 | Hosted-session CLI: `start`, `list`, `log`, `explain`, `stop`, `serve` | Wiki Hosted Session; Wiki Session Transport | `src/cli/commands/session-host.ts:75-492` | `tests/integration/hosted-session.test.ts` | shipped-but-drifted | `start` says "relay one or more messages" (`:77`) but ends the runner after the first `result` (`:142`). `stop` kills the supervising CLI pid (`:459`); on Windows that does not take the `claude` child with it (suspected, D10) | none |
| 40 | Hosted session = "ADR-0007 invariant 8, no exemption" | Wiki Hosted Session; `host.ts:21-25` | — | — | shipped-but-drifted | the ADR numbers "not privileged" as invariant **7**; 8 is local-only enrolment. Doc and code comment agree with each other and not with the ADR | none |

### Decision 63 (per-org cache)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 41 | Cache at `~/.golem/teams/<org_id>.json` | Decision 63; Wiki Team Layer, Project Team Binding | `src/portal/binding.ts:137-158` | `tests/unit/portal/binding.test.ts` | shipped-and-matches | cache write is not atomic (`team-layer.ts:306-311`) | — |
| 42 | 63(c) `golem status` reports cache age per team | Decision 63(c) | `team-layer.ts:348-381`; `src/cli/status-collect.ts:298`, `:422` | `tests/unit/portal/team-layer.test.ts` | shipped-and-matches | | — |
| 43 | 63(d) `unlink` keeps the cache | Decision 63(d); Wiki Project Team Binding table | `binding.ts:314-338` names but does not delete | `tests/unit/portal/binding.test.ts` | shipped-and-matches | `unlink` removes `golem-team-*` dirs with `rm -rf`, no provenance check (`binding.ts:382-392`). See Contradictions C7 | — |
| 44 | 63(e) org id is not sanitised; an invalid shape is refused | Decision 63(e); Wiki Project Team Binding | `binding.ts:87-120`, `:151-157` | `tests/unit/portal/binding.test.ts` | shipped-and-matches | | — |
| 45 | 63(f) sync refreshes the current project's team; `--all` sweeps | Decision 63(f) | `src/cli/commands/team.ts:467-487` | `tests/unit/portal/team-layer.test.ts` | shipped-and-matches | | — |

### Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 46 | 64(b)/(c) unlinked project: zero portal I/O, no cache read, no token lookup, one mention | Decision 64(c); Wiki Free and Team Tiers | `binding.ts:99-101`; `team-layer.ts:546-548`; `init-team.ts:119-124`; `team.ts:680-688` | `tests/unit/cli/init-team.test.ts`; `tests/integration/cli-init-team.test.ts` | shipped-and-matches | | — |
| 47 | 64(c2) real CLI exit code on a default install | Decision 64(c2) | — | `tests/unit/cli/team-status-solo.test.ts` | shipped-and-matches | | — |
| 48 | 64(d)/(d2) a 402/403 stamps the cache; the read path refuses a stamped cache | Decision 64(d2); Wiki Team Layer, Free and Team Tiers | `team-layer.ts:248-267`, `:484-495`, `:662-685`, `:755-762` | `tests/unit/portal/team-layer.test.ts` | shipped-and-matches | | — |
| 49 | `api_error` → "team settings are NOT being applied" | `entitlement.ts:261-265`; Decision 64(d2) "api_error must not stamp" | sync returns `NO_TEAM_LAYER` (`team-layer.ts:755-768`) but stamps nothing, so the next `loadConfigWithTeamLayer` applies the old cache (`:457-498`) | — | shipped-but-drifted | the message is true for the sync call and false from the next config load on. See D6 | none |
| 50 | 64(e)/(e2) matrix: unreachable/5xx/401 → cache; 402/403 → no cache; unknown status → no cache; unknown throw → cache; 403 with unknown code denies | Decision 64(e2); Wiki Project Team Binding, Free and Team Tiers | `src/portal/entitlement.ts:87-143`, `:167-200` | `tests/unit/portal/entitlement.test.ts` | shipped-and-matches | a 4xx with a known code (e.g. `400 no_organization`, our own bug) is `not_entitled` and STAMPS (`:137-140`), contrary to "only a genuine verdict stamps" | — |
| 51 | "200 with a non-JSON body" classified one way | Decision 64(e2) "an unrecognised HTTP status refuses the cache" | team skills → `unreachable` (`src/portal/team-skills.ts:189-203`); team layer → `api_error` (`team-layer.ts:843-853`) | — | shipped-but-drifted | same input, opposite cache decision | none |
| 52 | 64(f) nothing entitlement-related fails `golem init`, and "degrade, but never silently" | Decision 64(f); Wiki Project Team Binding "Nothing may break" | `init-team.ts` has no failure path, but `syncTeamLayerForInit` returns `result.applied` only (`src/cli/init.ts:556-575`) and `syncTeamLayer` never throws | `tests/unit/cli/init-team.test.ts` (injected sync only) | shipped-but-drifted | on a 402/403/api_error init prints "signed in and up to date"; offline-with-cache prints "applied N" as if fresh. The `catch` in `init-team.ts:197-211` cannot fire in production. See D3 | none |
| 53 | 64(g) no local licence file / key check | Decision 64(g); Wiki Free and Team Tiers | none exists (grep) | — | shipped-and-matches | | — |
| 54 | The team origin is applied on every config load ("every config load reads that file") | Wiki Team Layer "The fetch"; `team-layer.ts:19-20` | `loadConfigWithTeamLayer` is called only at `src/cli/status-collect.ts:145` and `src/cli/commands/proxy.ts:191`; dial hot-reload uses plain `loadConfig` (`src/cli/proxy-runtime.ts:217`, `reloadDials: true` at `proxy.ts:314`) | — | shipped-but-drifted | hooks, MCP server, `golem acp`, session host and ~45 other `loadConfig` sites never see team policy; the proxy drops team-set `compression.*`/`brevity.*` after the first reload. See D4 | none |
| 55 | `enforced: true` → `"!important"` at the team origin | Wiki Team Layer; Decision 62(c) | `team-layer.ts:180-220` | `tests/unit/portal/team-layer.test.ts` | shipped-and-matches | docs say "a later row wins"; `enforced` is sticky: once a key is enforced, a later non-enforced row keeps it enforced (`:212`) | — |
| 56 | Floor: `REMOTE_DENIED_SETTINGS` compiled in; a denied key is DROPPED with a loud `REFUSED` | Wiki Team Layer "The floor"; Wiki Project Team Binding | `src/config/loader.ts:144-153`, `:663` | — (loader tests owned elsewhere) | shipped-and-matches | the list omits `security.*`; see C4 | — |
| 57 | Provenance names the team (`team org_… (cached copy, fetched …)`) | Wiki Team Layer | `team-layer.ts:397-401` | `tests/unit/portal/team-layer.test.ts` | shipped-and-matches | | — |
| 58 | Wire tolerates `null` where a field is optional (the §164 lesson) | `src/portal/client.ts:29-45`; `team-layer.ts:101-104` | `teamSettingRowSchema.enforced` is `.default(false)`, which rejects `null` (`team-layer.ts:100`); team skills uses `.optional()` for `content`, `updated_by`, `updated_at` and `.default([])` for `skills` (`team-skills.ts:83-98`) | — | shipped-but-drifted | one `null` rejects the whole payload → `api_error`. The manifest form omits `content`, so a portal that sends `content: null` breaks every skills sync | none |
| 59 | Committed `team.portal_url` is "the API base only"; credentials stay in the keychain and "do not follow it" | Wiki Project Team Binding "The key"; Wiki Team Layer "One team per project" | `binding.ts:131-135` → `team.ts:692`, `init.ts:563` → `client.ts:159-165` attaches `Bearer <access_token>` to `joinUrl(apiBaseUrl, …)`; token keyed by issuer, not API host (`tokens.ts:42`, `client.ts:118-126`) | — | shipped-but-drifted | the token follows `portal_url` to whatever host the repo names, with no https check. See D1 | none |
| 60 | One team per project, committed at project scope | Wiki Team Layer, Project Team Binding | `binding.ts:234-260` writes project scope | `tests/unit/portal/binding.test.ts` | shipped-and-matches | | project-team-binding (done) |
| 61 | Sign-in = auth code + PKCE S256 over a `127.0.0.1` loopback; timing-safe `state`; no device grant | Wiki Team Layer "An organization is never implied" | `src/portal/pkce.ts:47-63`; `src/portal/loopback.ts:30`, `:128-142`, `:171`; `src/portal/discovery.ts:155-161` | `tests/unit/portal/pkce.test.ts`, `loopback.test.ts`, `discovery.test.ts` | shipped-and-matches | discovery accepts a server that omits `code_challenge_methods_supported` (`discovery.ts:156`) | team-portal-auth (done) |
| 62 | Refresh once on 401, then one full re-link, then give up | `client.ts:1-21` | `client.ts:170-216` | `tests/unit/portal/client.test.ts` | shipped-but-drifted | `stats.refreshAttempts` is per client, not per request (`:187`), so after one refresh on a client no later request gets rung 1 | none |
| 63 | Tokens in the OS keychain | Wiki Team Layer; ADR-0003 | `src/portal/tokens.ts:161` (`"keychain"`) | `tests/unit/portal/tokens.test.ts` | shipped-and-matches | | — |
| 64 | Team skills: flat `golem-team-<name>/`, name validated, hash checked, 500 / 512 KiB caps, deletions propagate, edited file kept | Wiki Team Layer "Team skills" | `team-skills.ts:64-68`, `:79-81`, `:225-266`; `src/cli/team-skills.ts:404-514` | `tests/unit/portal/team-skills.test.ts`; `tests/unit/cli/team-skills.test.ts` | shipped-and-matches | a manifest row rejected by the 500 cap or a bad name falls out of `inManifest`, so its existing local copy is deleted as "removed by the team" (`cli/team-skills.ts:444-456`) | — |
| 65 | `golem init` syncs the team layer; skills sync is `golem team skills` | Wiki Team Layer "The fetch" | `init.ts:527-537`; no `syncTeamSkills` call in init (grep) | `tests/integration/cli-init-team.test.ts` | shipped-and-matches | | — |
| 66 | `link` exits 2 when sign-in succeeds but binding does not | Wiki Project Team Binding | `team.ts:311`, `:512` | — | shipped-and-matches | | — |

### Portal Install Contract

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 67 | Installers fetch `$base/bin/golem-${os}-${arch}` / `golem-windows-$arch.exe`; `GOLEM_INSTALL_BASE` defaults to `https://golem.run` | Wiki Portal Install Contract §3 | `install/install.sh:64-67`, `:111`; `install/install.ps1:53-56` | — | shipped-and-matches | the page cites `install.sh:66` / `install.ps1:55-56`; now one line off | — |
| 68 | Installer ladder is exactly two rungs, "do not reorder" | Wiki Portal Install Contract | third opt-in rung `GOLEM_INSTALL_NODE=1` bootstraps Node (`install.sh:132-133`; `install.ps1:7`, `:12`) | — | shipped-but-drifted | page omits the env var that is part of the contract | none |
| 69 | Release carries both scripts and asserts every required asset | Wiki Portal Install Contract "The prerequisite" | `.github/workflows/release.yml:221`, `:278-289` | — | shipped-and-matches | | release-portal-assets (done) |
| 70 | "no release has been cut since" | Wiki Portal Install Contract | `git log`: `1b08402 chore(release): v0.54.3` | — | shipped-but-drifted | stale prose | none |
| 71 | `config-schema.json` rendered from `schema.ts` and shipped | Wiki Team Layer "The schema stays here" | `release.yml:178-212` | — | shipped-and-matches | whether the portal validates against it is unverifiable here | — |

### Buzz Integration (R14.2-R14.5)

| # | feature | claim source | code evidence | test evidence | class | note | existing task |
|---|---|---|---|---|---|---|---|
| 72 | `golem acp`: ACP Agent over stdio, one persona per process, `--persona` required, stdout protocol-only | Wiki Buzz Integration "Architecture" | `src/cli/commands/buzz.ts:15-39`; `src/buzz/acp-agent.ts:53-142`, `:164-197` | `tests/unit/buzz/acp-protocol.test.ts` | shipped-and-matches | task R14.3 is still `queued` while this code is in `development` | R14.3 (queued) |
| 73 | The four required ACP methods | Wiki Buzz Integration | `acp-agent.ts:62-141` | `tests/unit/buzz/acp-protocol.test.ts` | shipped-and-matches | `initialize` echoes the client's `protocolVersion` back instead of negotiating (`:62-65`) | R14.3 |
| 74 | `session/cancel` → the in-flight turn resolves `cancelled`, nothing stale posted | `acp-agent.ts:66-76`; Wiki "A new @mention cancels the turn in flight" | `cancelled.add` whether or not a turn is in flight (`:75`); `wasCancelled` checks by session id (`:102`); cleared only in the next handler's `finally` (`:138-140`) | — | shipped-but-drifted | a cancel with no turn in flight silences and cancels the NEXT turn; under the default `steer` mode the re-prompt can inherit the flag. See D7 | R14.3 |
| 75 | Lane resolved once per turn; prompt from `resolvePersonaPrompt()` with the coder special-case | Wiki Buzz "Resolve the lane per turn" | `src/buzz/acp-turn.ts:104-119`, `:232-299` | `tests/unit/buzz/acp-protocol.test.ts` | shipped-and-matches | | R14.3 |
| 76 | "Two defects that block axis 2 today" (no `model` on `DispatchRequest`; no worker-lane `resolvePersonaPrompt`) | Wiki Buzz Integration | `acp-turn.ts:296-299` dispatches `model: lane.model`; `:118` calls `resolvePersonaPrompt` | — | dead-or-superseded | both fixed for the Buzz path; section reads as current | — |
| 77 | Rate limit: pre-flight park via `decideSnoozeNudge`, bounded in-turn retry with keepalive, defer, `end_turn`, `persistSnoozeNote` | Wiki Buzz "Rate limits and usage caps" | `src/buzz/limit-guard.ts:84-142`; `acp-turn.ts:172-205`, `:279-293`, `:301-86` | `tests/unit/buzz/limit-guard.test.ts` | shipped-and-matches | | R14.3 |
| 78 | Deferral "posts … with `buzz messages send`" | Wiki Buzz "Rate limits" | posts as the ACP reply via `input.emit` (`acp-turn.ts:186-190`); `postChannelMessage` is an unwired seam (`:73-78`) | — | shipped-but-drifted | the wiki's own premise is that `buzz-acp` swallows most of the reply path; whether a reply chunk reaches the channel is unverifiable here | R14.4 |
| 79 | Thread recorded as deferred; orchestrator state machine across turns | Wiki Buzz "The reverse direction" | `recordDeferred` seam unwired (`acp-turn.ts:79-80`, `:201-203`); no `thread-state.ts` | — | not-started | | R14.4 |
| 80 | One Nostr keypair per persona per project; secret in the credential store; pubkeys in a committed manifest; `buzz-admin add-member` printed, not run | Wiki Buzz "Identity and scoping" | `src/buzz/identity.ts:71-84`, `:254-275`; `src/buzz/provision.ts:130-272` | none for `identity.ts`/`provision.ts` (grep) | partial | no CLI reaches it: `golem buzz provision` does not exist (only `acp` is registered, `buzz.ts:16`), and nothing in persona-sync calls it. Defects D2, D9 | R14.2 (queued) |
| 81 | `BUZZ_ACP_RESPOND_TO=owner-only` default | Wiki Buzz "Mapping" | `provision.ts:45`, `:72-80` | — | shipped-and-matches | | R14.2 |
| 82 | Buzz Desktop BYOH `custom_harnesses/golem.json` makes `golem` selectable | Wiki Buzz "Two ways to select it" | `src/buzz/harness-definition.ts:30-42` emits `args: ["acp"]`; no installer (`golem buzz install-harness` absent) | `tests/unit/buzz/harness-definition.test.ts` | partial | as emitted it cannot start: `golem acp` without `--persona` exits 1 (`buzz.ts:31-35`), and the wiki says Desktop spawns `command`+`args`+`env` only. See D11 | R14.2 |
| 83 | `golem buzz status` reports the missing binaries and the optional tier-C add-on | Wiki Buzz "External prerequisites" | no `buzz` command group | — | not-started | detection code exists (`identity.ts:170-199`) with no caller | R14.2 / R14.5 |
| 84 | Tier C: nested `claude-agent-acp` | Wiki Buzz "Borrowing a loop" | none | — | not-started | | R14.5 |
| 85 | Orchestrator `@Golem` addressable in Buzz | Wiki Buzz "The reverse direction" | only the synthetic roster id `ORCHESTRATOR_ID` (`identity.ts:56`) | — | not-started | | R14.4 |

## Defects (severity-ranked; code as read, not intent)

- **D1 — HIGH — the portal access token goes to a repo-chosen host.** A cloned repo that commits
  `team.org_id` + `team.portal_url: "https://attacker"` receives `Authorization: Bearer <token>` the
  next time the member runs `golem init` (token present), `golem team sync`, or the team-skills sync.
  Path: `binding.ts:131-135` (committed `portal_url` wins) → `init.ts:563` / `team.ts:692` →
  `client.ts:159-165`. The token is read by issuer (`client.ts:118-126`), not matched to the API host,
  and on a 401 the client refreshes and re-sends a fresh token (`client.ts:187-193`). No `https:`
  check on either URL (`config.ts:46-70`). `REMOTE_DENIED_SETTINGS` does not help: the vector is the
  project file itself, not the team origin.
- **D2 — HIGH (conditional) — `parseGenerateKeyOutput` can put the secret in the committed manifest.**
  `HEX64_RE` has the `g` flag (`identity.ts:59`) and is reused with `.exec` (`:115-116`). After the
  first `exec`, `lastIndex` points past the pub hex, so the `exec` on the secret line returns null and
  the labelled branch NEVER wins. The positional fallback (`:121`) is used every time. Reproduced with
  node: for output `secret: <S>\npublic: <P>`, it returns `pubkeyHex = S`, `secretHex = P`. `S` then
  goes into `.golem/buzz/agents.json`, which is committed (`provision.ts:224-235`). Safe only if
  `buzz-admin` always prints pub before sec, and the module says that format is unknown (`:96-102`).
- **D3 — MEDIUM — `golem init` misreports the team outcome.** `syncTeamLayerForInit` returns
  `result.applied` and discards `disposition`/`notice` (`init.ts:556-575`). `syncTeamLayer` never
  throws. So a 402/403/api_error prints "signed in and up to date — the team layer set nothing new"
  (`init-team.ts:190-191`), and offline-with-cache prints "applied N team settings" as if fresh. This
  is the "believing they are under team policy when they are not" hazard the design names.
- **D4 — MEDIUM — the team origin exists on two load paths only.** See #54. Enforced team policy
  (e.g. `redaction.*`) is not applied in hooks, the MCP server, `golem acp`, the session host, or
  after the proxy's first dial reload.
- **D5 — MEDIUM — the slow-subscriber drop desynchronises the client's cursor.** `transport.ts:230-238`
  writes `id: <cursor+1>` for a frame that is not in the ring. `EventSource` stores it as
  `Last-Event-ID`; on reconnect, `subscribe(after = cursor+1)` filters `seq > cursor+1`
  (`session-bus.ts:129`), so the real event later published at `cursor+1` is never delivered. The
  frame's type is `ended`, which the contract says means the session is over.
- **D6 — MEDIUM — the `api_error` notice is contradicted by the next load.** See #49.
- **D7 — MEDIUM — Buzz cancel poisoning.** See #74. The draft recorded this first; confirmed.
- **D8 — LOW-MEDIUM — idempotency races.** `transport.ts:311-387` and `join-queue.ts:147-179`
  both check and then act across awaits. A retry sent while the first POST is still awaiting the log
  write or delivery is delivered twice (hosted), or enqueued twice under two filenames (joined, so
  both are later claimed).
- **D9 — LOW-MEDIUM — Buzz provisioning orphans its own identities.** `mintIdentity` stores the secret
  immediately (`identity.ts:271-274`). `provisionBuzz` writes the manifest only at the end
  (`provision.ts:253-257`) and throws first when any persona is blocked (`:238-245`), or when any
  later `generate()` throws. So every persona minted earlier in that run has a stored secret and no
  manifest pubkey, and the NEXT run reports them all orphaned. The recovery hint names
  `golem buzz provision --rotate`, which does not exist.
- **D10 — LOW (suspected, not reproduced) — `golem session host stop` on Windows.** `process.kill(pid)`
  targets the supervising CLI (`session-host.ts:459`, `pid: process.pid` at `:103`, `:315`). On
  Windows that is TerminateProcess: the SIGTERM handler that kills the runner (`:193-194`, `:374`)
  never runs, and the `claude` child is not in a job object. It likely keeps running an agent session.
- **D11 — LOW — the Buzz Desktop harness definition cannot start a persona.** See #82.
- **D12 — LOW — `session forget <id>` and `conversationStoreDir` do not validate the id.**
  `conversation-store.ts:151-153` joins a caller string into a path. Only a local CLI user can reach
  it today, but it is the same shape `join-queue.ts:36-38` and `binding.ts:77-86` refuse.

## Undocumented

Exported behaviour in owned src that no owned doc describes:

- `golem session host explain <tool> [input...]` is listed in Wiki Hosted Session; `golem session host
  forget <id>` (`session-host.ts:474-490`), which also deletes the transcript tee, is not.
- `hostSessionLogPath` (`host-registry.ts:32-35`): a per-session transcript tee path "so `attach` has
  scrollback". No `attach` command exists and nothing writes this path (grep); only `forget` removes it.
- `reapDeadSessions` / liveness checking by pid (`host-registry.ts:84-174`): the reaping behaviour is
  undocumented in the wiki.
- `GET /session/<id>/history`, `/interrupt`, `/queue`, `/chat` and `GET /sessions` (`transport.ts:26-40`):
  Wiki Session Transport documents only `/stream` and `/message`.
- The `MessageLedger` retry window is 256 ids per session per process (`session-bus.ts:163-186`); not stated.
- `MAX_PENDING_PER_CONVERSATION = 16` (gate-map item 6) and `DELIVERED_RETENTION_MS = 24 h`
  (`join-queue.ts:55`, `:69`): Wiki Joined Session states only the 12 h TTL. `prune()` (`:278`) has no
  production caller (grep), so delivered records are never pruned either.
- `src/cli/devices.ts` (`golem devices`, inference hardware tiers): no owned doc covers it. ADR-0006
  "Consequences" anticipated a name collision, which is now resolved only by singular (`device`) vs
  plural (`devices`).
- `teamSkillsSyncLayer` / `readLocalTeamSkills` exports (`cli/team-skills.ts:655-666`).
- `findGenerateKeyRunner`'s Docker fallback (`identity.ts:181-196`) is documented in the wiki as a
  shortcut; its PATH/PATHEXT probing is not.

## Dead candidates

No reachable production caller (grep over `src/`, excluding the defining module and `index.ts`):

- `trimHostLog` (`src/session/host-log.ts:111`)
- `FileJoinQueue.prune` (`src/session/join-queue.ts:278`)
- `LocalConversationStore.appendTurn` / `readConversation` / `listConversations`
  (`conversation-store.ts:187-240`): test-only until R13.8
- `hostSessionLogPath` as a write target (`host-registry.ts:33`): only removed, never written
- `provisionBuzz`, `mintIdentity`, `rotateIdentity`, `findGenerateKeyRunner`, `runGenerateKey`,
  `addMemberCommand` (`src/buzz/provision.ts`, `src/buzz/identity.ts`): no CLI yet (R14.2 queued)
- `golemHarnessDefinition`, `harnessDefinitionPath` (`src/buzz/harness-definition.ts`): no installer
- `RunAcpTurnDeps.postChannelMessage` / `recordDeferred` seams (`acp-turn.ts:73-80`): R14.4
- `WriteServerOptions.stepUpPaths` (`src/security/write-server.ts:82`): never passed. Not owned, but it
  carries Device Authentication's step-up claim
- `init-team.ts:197-211` catch branch: unreachable with the production `syncTeamLayerForInit` (D3)
- `HostAttachment.attached === true` path in `resolveHostGate` (`host-gate.ts:128`): no caller passes an attachment

## Stale comments (comment contradicts the code beside it)

- `src/cli/init-team.ts:80` "Filled in by `team-layer-fetch` / `team-skills-sync`; absent until then":
  both shipped, and init passes a real sync (`init.ts:537`). `:163-164` "the thing that consumes it has
  not shipped yet": same.
- `src/cli/init.ts:552` "is reported by `teamInitStep` from the disposition": the function returns no
  disposition (`:575`).
- `src/hooks/host-gate.ts:108-110` and `src/session/host-gate.ts:101-103`: "no device transport (R13.5)
  and no chat surface (R13.6) yet". Both are done.
- `src/session/chat-page.ts:22-25` "Gate-map item 3 is LOCKED (Decision 59(a))": Decision 61 made it a
  setting (not yet built). `:37-38` "R13.6 only ever renders `hosted`": R13.7 renders `joined`.
- `src/session/host.ts:21-25` and `src/cli/commands/session-host.ts:134` cite "invariant 8" for "no
  exemption"; the ADR numbers it 7.
- `src/session/host-log.ts:22-23` "bounded by line count so a long-lived session cannot fill a disk":
  the trim is never called.
- `src/session/session-bus.ts:111` "Reconnect with Last-Event-ID to resume — nothing was lost": false
  given `transport.ts:234` (D5).
- `src/buzz/acp-agent.ts:66-76` "a cancelled turn posts no stale reply": true, but it also silences
  the next turn (D7).
- `src/buzz/identity.ts:98-100` "labelled `pub`/`sec` lines win when present": they never win (D2).
- `src/buzz/limit-guard.ts:38` credits the retry-math move to "R14.5", and commit `1e84c45` says the
  same; the R14.5 task doc is Tier C. Task-id collision.
- `src/buzz/provision.ts:242` and `src/buzz/harness-definition.ts:10-11` name `golem buzz provision
  --rotate` and `golem buzz install-harness`. Neither exists (forward references to R14.2).
- `src/session/conversation-store.ts:8` "continuation (R13.8)" and Wiki Conversation Store's "Consumers
  queued: R13.3, R13.5": those two shipped without consuming the store.

## Contradictions for the human (not resolved here)

- **C1 — ADR-0007 disagrees with itself on the runner.** §3a (and Decision 60 via §142/§147) says
  multi-turn `stream-json` stdin is verified; Revision 2 (2026-08-23) says it "could NOT be reproduced…
  Do not attempt persistent daemon or multi-turn stdin" and to use `--resume` chaining. `host.ts` follows
  §3a. One of the two ADR passages has to go.
- **C2 — Invariant numbering.** Wiki Hosted Session and `host.ts` call "not privileged" invariant 8;
  ADR-0007 §5 has it as 7.
- **C3 — Does Decision 61 reach hosted sessions?** Decision 60(d) says a hosted session refuses
  destructive/outward outright, "No setting changes that". Decision 61 makes gate-map item 3 a setting
  without saying whether that covers the hosted path. The code always denies (`host-gate.ts:68-82`).
- **C4 — A team admin can switch on remote authorship on members' machines.** `security.*` (including
  `join_injection`, `write_lan`, `write_port`) is not in `REMOTE_DENIED_SETTINGS` (`loader.ts:144-153`),
  so an enforced team row can set them. ADR-0007 §10 says multi-user or team access "is a different
  ADR". Decide whether `security.*` belongs on the floor.
- **C5 — `team.portal_url` design vs D1.** The wiki argues the key is safe because "nothing secret"
  is committed. The code makes it the destination of the member's secret. Options include binding the
  token to an API origin, refusing a `portal_url` whose origin differs from the one the token was issued
  alongside, or dropping `team.portal_url`. That is a decision, not a fix.
- **C6 — Task state lags code.** R14.2 and R14.3 are `queued` while `src/buzz/` (identity, provision,
  ACP agent, limit guard) is in `development`.
- **C7 — Two policies for an edited team skill.** A portal verdict or removal keeps an edited skill as
  the user's own (`cli/team-skills.ts:587-589`); `golem team unlink` deletes the whole directory with
  no provenance check (`binding.ts:382-392`). Both are documented, but they disagree on who owns an
  edit.
- **C8 — ADR-0006 was not amended for what superseded it.** §2 and §8 ("There is no flag for this"),
  §3a (`rejectUnauthorized: true`), §4 (decision binding) and §7 (autonomy-log) all describe designs
  that Decision 61, R13.4's code, 59(i) or ADR-0007 inv 4 replaced. There are no pointers in place.

## Unverifiable here (needs the portal repo or a live system)

- Portal routes, User-Agent content negotiation (PowerShell before browser, Windows `curl` alias),
  307-not-308, and `/bin/<asset>` constrained to `golem-…` (Wiki Portal Install Contract). Live gate:
  `R7.6-infra`.
- The portal validates team settings against `config-schema.json`, "never down-converts", serves
  migrations (Wiki Team Layer "The schema stays here").
- `403 not_a_member` indistinguishable from a non-existent org; membership re-verified per request; no
  device grant on the server (Wiki Team Layer). Client side matches (#50, #61).
- The portal's docs still show the nested `golem-team/<name>/` path: known, `portal-team-skills-path-drift`
  (queued). Also known: `portal-success-body-replaced` (queued).
- Which wire fields the deployed portal sends as `null` (bears on #58).
- `buzz-acp` behaviour: whether an `agent_message_chunk` reply reaches the channel (#78), `steer`
  sequencing of cancel then prompt (#74), BYOH spawning `command`+`args` only (#82), and the
  `buzz-admin generate-key` output order (D2).
- Claude Code client behaviour behind §142/§147 (multi-turn stream-json, `--settings` wiring hooks,
  `PermissionRequest` not firing in headless default mode), and the R12.13 live channel pre-emption.
- WebAuthn RP-ID reasoning for the passcode choice (§146, MDN): measured elsewhere, not re-measured.
