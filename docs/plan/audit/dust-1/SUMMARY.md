# Dust Phase 1: summary of the eleven audit notes

DUST1.12 close-out, 2026-09-26, branch `dust/phase-1` (worktree `../golem-dust1-phase1`, cut
from `development` @ `fd3aedc`). This file merges the eleven findings notes in this directory into
one baseline for the Phase 2 rebaseline (wiki and spec) and the Phase 3 refactor and fix work. It
reclassifies nothing. Where two partitions disagree, both are listed under
[Contradictions for the human](#contradictions-for-the-human).

Class key: **M** shipped-and-matches · **D** shipped-but-drifted · **P** partial · **N**
not-started · **X** dead-or-superseded · **HR** means the item touches a CLAUDE.md hard rule
(redaction, proxy byte-faithfulness at compression ≤ 1, the `src/interfaces/` frozen contracts, or
the Headroom adapter). Phase 3 should handle HR items with extra care.

Row references (`1.4/r017`) are stable ids assigned in document order to every row of every
classification table in `DUST1.4.md`, and so on. Where a note numbers its own rows, that number
is shown too (`1.3/r042 (#42)`). The generator treated only tables with a `class` column as
classification tables, so tally tables and the symbol-only dead-candidate table in DUST1.9 are
excluded.

## Merge and gate check

**The merge was clean.** Each of `dust/DUST1.1` … `dust/DUST1.11` was merged with `--no-ff` into
`dust/phase-1`, in order, with no conflicts. `git diff --stat development..dust/phase-1` shows 11
files changed, 2724 insertions, all under `docs/plan/audit/dust-1/`, one note per branch. Every
source worktree (`../golem-dust1.1` … `../golem-dust1.11`) had a clean `git status --short`, so no
uncommitted audit work was left behind.

**Every note met its own gate.** Each classifies its owned claims with `path:line` evidence and
has Undocumented, Dead candidates, Stale comments, Contradictions and Unverifiable sections.
DUST1.11's unowned-code sweep matched every non-test `src/**/*.ts` against the paths named in
DUST1.1–1.10 and found only 28 unclaimed files, all in `src/cli/commands/`. It classified each
one, so coverage is complete. These are the gaps found by partition. They are reported here and
not filled in:

| partition | finding |
|---|---|
| DUST1.3 | The Tally says 37 M / 60 total. Its own table has **38** M / **61** classified (plus 2 rows it deliberately left unclassified). Off by one |
| DUST1.6 | The summary says 24 M · 15 D · 5 P · 4 N · 5 X = **53**. Its tables hold **63** classified rows: 38 M · 14 D · 4 P · 5 N · 2 X (plus H4, unverifiable). The summary appears to count dead-candidate bullets as X and not to count the G/C-row tables. This summary uses the table counts |
| DUST1.1 | One row (Decision 33's KB half) was deferred to DUST1.4, which classified it. Merged here as G17 |
| DUST1.5 | The CLAUDE.md tool-list mismatch is recorded only as a contradiction, not as a row. DUST1.11 row 75 classifies it (P) |
| DUST1.4 | Flags `src/cli/watch.ts` as mis-partitioned. DUST1.9 covered it |
| DUST1.2, 1.3, 1.4, 1.9, 1.10, 1.11 | Ran no tests, because their worktrees had no `node_modules`. The "test evidence" cells mean the test was read, not that it passed. DUST1.6 ran a targeted suite (22 files, 292 tests, exit 0). DUST1.1, 1.5, 1.7 and 1.8 probed specific behaviour with scratch scripts |
| DUST1.7, DUST1.8 | Both note that the main checkout (`D:\Personal\Repos\Golem`) holds **uncommitted** edits that flip `snooze.enforce` and `snooze.spawn_gate` to default `false` (`src/config/schema.ts`, `src/hooks/guidance.ts` and two regenerated rules). They were still uncommitted when this summary was written. DUST1.7 classified against both states, and DUST1.8 against the committed one |
| DUST1.10 | Did not read the portal repo. Portal-side claims are in its Unverifiable section |
| all but 1.6, 1.8 | **14 audit commits carry a literal `[REDACTED:email:N]` in their `Co-Authored-By` trailer.** The session's redaction replaced the attribution address before the agents saw it (DUST1.1 recorded this). By branch: 1.1 ×3, 1.2 ×2, 1.4 ×2, 1.5 ×2, and 1.3, 1.7, 1.9, 1.10, 1.11 ×1 each. Cosmetic, but it is in history once merged |

## Counts

Rows per class, per partition, as counted from the tables:

| partition | M | D | P | N | X | classified | unclassified |
|---|--:|--:|--:|--:|--:|--:|--:|
| DUST1.1 | 64 | 19 | 15 | 4 | 5 | 107 | 1 |
| DUST1.2 | 15 | 14 | 2 | 2 | 0 | 33 | 1 |
| DUST1.3 | 38 | 8 | 4 | 4 | 7 | 61 | 2 |
| DUST1.4 | 57 | 16 | 7 | 3 | 7 | 90 | 0 |
| DUST1.5 | 26 | 14 | 3 | 4 | 6 | 53 | 0 |
| DUST1.6 | 38 | 14 | 4 | 5 | 2 | 63 | 1 |
| DUST1.7 | 12 | 21 | 2 | 1 | 4 | 40 | 0 |
| DUST1.8 | 50 | 17 | 8 | 3 | 3 | 81 | 1 |
| DUST1.9 | 45 | 12 | 3 | 3 | 4 | 67 | 3 |
| DUST1.10 | 44 | 20 | 7 | 9 | 5 | 85 | 0 |
| DUST1.11 | 47 | 39 | 15 | 5 | 5 | 111 | 0 |
| **all rows** | **436** | **194** | **70** | **43** | **48** | **791** | **9** |
| **de-duplicated features** | **419** | **169** | **63** | **36** | **38** | **738** (incl. 13 with conflicting classes) | **8** |

The last row counts each duplicate group (the 38 below) once, under its class when every member
agrees. When members disagree, the group is counted in the "conflicting" figure and not in any
class. The 9 unclassified rows are unverifiable measurements or rows outside the owning scope, and
the notes did not bucket them.

**Overall: 800 rows, of which 791 are classified. By class: 436 M (55%) · 194 D (25%) · 70 P · 43 N
· 48 X.** De-duplicated: 38 cross-partition groups absorb 92 rows, which leaves **746 distinct
features**: 738 with a class and 8 unclassified. 13 of the 738 are groups whose members disagree.
Twelve of those are real conflicts (see X1–X12). The thirteenth, G17, is a row DUST1.1 deferred to
DUST1.4.

## Cross-cutting security findings

Ranked by severity. Each is a code defect confirmed by at least one partition. "Probed" means the
auditor ran the behaviour. The first five are the HIGH items for priority attention.

### HIGH, recommended out-of-band, before Phase 3 starts

These can leak secrets or install foreign code today, on a default install. None of them needs the
Phase 2 rebaseline to be fixed, and waiting for Phase 3 leaves them live for two gated phases.

1. **S1: the npm package was silently renamed, and the old name is unclaimed.** Found
   independently by three audits: DUST1.1 headline 8, DUST1.8 headline 1, and DUST1.11 rows
   14/74/80 and contradiction 1. `package.json` `name` went from `golem-run` to `@pliable/golem`
   inside `2fc7cd2` (2026-09-23), a `fix:` commit about gateway model shapes. `d315b23` then made
   npm publish unconditional via OIDC. **Checked live on 2026-09-26: `npm view golem-run` returns
   404, and `@pliable/golem@0.54.2` is published.** Every consumer still names `golem-run`:
   - `golem update` (`src/update/index.ts:22` `PACKAGE_NAME`, `status-update.ts:83`)
   - the installers' npm rung (`install/install.sh:53-56`, `install/install.ps1:39-43`)
   - `package-lock.json`, `ps` process detection (`src/cli/commands/ps.ts:388,:426`) and the VS
     Code extension id prefix (`init-vscode.ts:194`)
   - README, CLAUDE.md, spec D16/D19/D41 and §2.1/§6, the Release Pipeline page, and the R7.5 gate

   Updating is broken today: it checks a package that does not exist. Worse, the **unregistered
   name is a squatting target**. Anyone who publishes `golem-run` gets their code installed by
   `install.sh`/`install.ps1` and by `golem update` on every existing install. The fix needs a
   human decision (which name is canonical, and whether to claim `golem-run` defensively). That
   makes it `owner: user` for the outward-facing half, but it should not wait for Phase 3.
2. **S2: an unauthenticated admin endpoint turns redaction off** (DUST1.1 headline 2,
   probed). `POST /__golem/pipeline/false` (`src/proxy/server.ts:206-211`) flips
   `#pipelineEnabled`. The proxy then skips the whole pipeline, redaction included (`:350`). It
   has no auth, no Origin check and no persistence, and nothing reads `pipelineEnabled()`, so no
   status surface shows the change. A POST with `Origin: https://evil.example` got 200 and the next
   request forwarded a raw AWS key. A web page can send that same simple POST to `127.0.0.1:4653`
   (a no-cors drive-by, reasoned but not browser-tested), and so can any local process or an
   agent's Bash tool. This is exactly the invisible-off state R11.3 set out to remove. **HR.**
3. **S3: pipeline fail-open forwards the unredacted request** (DUST1.1 headline 1, probed). Any
   throw inside `process()` forwards the ORIGINAL body (`src/proxy/server.ts:346-356`), and a
   test pins that as intended (`tests/integration/pipeline-proxy.test.ts:191`). It is reachable
   in production: a failed CCR blob write (`src/compression/local-blob-store.ts:61-89`, for
   example a full disk or a permission error) makes `NativeLosslessCompression.compress` reject,
   so at compression ≥ 1 that request goes upstream raw. Throwing `compression.compress`,
   `policy()` and `onEvent` were each probed to put a raw key upstream. More unguarded throw
   sites: `substituteKnownContent`, `applyBrevity`, `buildContextLedger`, and
   `sessionRecorder.snapshot()`. **HR.** A fail-closed or redact-then-forward fallback satisfies
   both the test's intent and the hard rule. That choice is contradiction R1.
4. **S4: the portal access token is sent to a repo-chosen host** (DUST1.10 D1). A cloned repo
   that commits `team.org_id` plus `team.portal_url: "https://attacker"` receives
   `Authorization: Bearer <token>` the next time the member runs `golem init` (with a token
   present), `golem team sync`, or the team-skills sync. The path is `binding.ts:131-135` →
   `init.ts:563` / `team.ts:692` → `client.ts:159-165`. The token is looked up by issuer, not
   matched to the API host (`client.ts:118-126`). On a 401 the client refreshes and re-sends a
   fresh token (`:187-193`). Neither URL gets an https check (`config.ts:46-70`).
   `REMOTE_DENIED_SETTINGS` does not help, because the vector is the committed project file, not
   the team origin. The design question (bind the token to an origin, or drop
   `team.portal_url`) is contradiction P5.
5. **S5: the autonomy classifier lets newline-chained commands through as `read`** (DUST1.7
   row 19, probed at `classifyAction` + `decideGate`). `SHELL_COMPOSITION_RE`
   (`src/autonomy/classify.ts:107`) has no `\n` or `\r`, and `^ls(\s|$)` matches
   `ls\n<anything>`. So `"ls\nnode -e …rmSync…"` classifies as `read`, and at `assisted` it gets
   `allow`. That breaks ADR-0002's invariant that "unknown is never auto-allowed". It also
   over-approves `git branch -D main`, `npx biome check --write .` and `git diff --output=<path>`
   as `read`. It only matters at a non-`manual` autonomy level, but then it is an arbitrary-command
   bypass of the gate, and the classifier has zero newline test cases.

### HIGH, not currently reachable: fix before R14.2 ships

6. **S6: the Buzz keygen parser can commit the secret key** (DUST1.10 D2, reproduced with
   node). `HEX64_RE` carries the `g` flag and is reused with `.exec` (`src/buzz/identity.ts:59`,
   `:115-116`). The labelled branch therefore never wins, and the positional fallback
   (`:121`) swaps them: for `secret: <S>\npublic: <P>` it returns `pubkeyHex = S`. `S` is then
   written to the committed `.golem/buzz/agents.json` (`provision.ts:224-235`). No CLI reaches
   `provisionBuzz` yet (`golem buzz provision` does not exist, and R14.2 is queued), so nothing
   leaks today. **Make it a gate on R14.2.**

### MEDIUM, security-relevant, in Phase 3

| # | finding | partition | HR |
|---|---|---|---|
| S7 | `x-golem-bypass` is a second per-request redaction-off path (`server.ts:350`, `headers.ts:86-91`). ADR-0004 says `bypass_all` is the only one, and the `golem-bypass` skill presents the header as milder than `compression off` without saying it skips redaction | 1.1 h3 | HR |
| S8 | A plugin stage that mutates `body` in place skips the re-redaction (`pipeline.ts:587`, `:601`). Probed: a raw secret is forwarded when a later stage marks the request changed | 1.1 h4 | HR |
| S9 | Object keys are never redacted (`redaction.ts:287-290`). `ConversationStore` inherits the gap | 1.1 h5 | HR |
| S10 | `connection-password` re-matches its own placeholder, so redaction is not idempotent and a second pass renumbers (`redaction-rules.ts:195`). This breaks prefix stability | 1.1 h6 | HR |
| S11 | The redaction-off warning is dropped whenever an update is available (`status-collect.ts:429-436`). The panel flags bypass by colour alone, so with `NO_COLOR` nothing shows it | 1.9 D1 | HR |
| S12 | `golem proxy status` prints "Pipeline is active" without checking `proxy.bypass_all` (`commands/proxy.ts:495-497`) | 1.11 | HR |
| S13 | `wiki_upsert` writes page bodies verbatim, with no redaction, into a committed tree (`wiki-tools.ts:134-150`, `file-wiki-store.ts:125-173`) | 1.4 | HR |
| S14 | Plugin redaction rules are absent from hook, vibe and join-queue redaction, which run in other processes (`hooks/redact.ts:34`, `vibe/store.ts`, `join-queue.ts:170`) | 1.1 | HR |
| S15 | Vibe `sources.json` and `candidates.jsonl` (which holds free-text notes) are written unredacted | 1.8 | HR |
| S16 | Credential env-name collision: gateway ids `work-1`, `work.1` and `Work_1` all map to `GOLEM_UPSTREAM_API_KEY__WORK_1`, so the second gateway silently sends the first gateway's key to its own host (`providers/gateways.ts:76-78`, `credentials.ts:78-83`) | 1.2 r22 | |
| S17 | A team admin can switch on remote authorship (`security.join_injection`, `write_lan`) on members' machines, because `security.*` is not on `REMOTE_DENIED_SETTINGS` (`loader.ts:144-153`) | 1.10 C4 | |
| S18 | Enforced team policy is applied on only 2 of ~47 config loads (proxy start, `golem status`) and is lost on the proxy's first dial hot-reload. Team-enforced `redaction.*` or `compression.*` is not honoured in hooks, MCP, `acp` or the session host | 1.10 D4, 1.8 h3 | HR |
| S19 | `owner: user` personas are still dispatchable on the worker lane (`personas.ts:183-197`, `selectTarget`, `resolveCoderRoute`). The permission axis is ignored | 1.6 W8 | |
| S20 | A team row with an invalid value stops the proxy from starting (`loader.ts:625-631`), which breaks ADR-0008's "nothing about a team link may stop the proxy". Probed | 1.8 h2 | |
| S21 | The Gemini `?key=<secret>` rides on `ProxyRoute`, although the comment says no key is ever placed there (`route-resolver.ts:108-125`). No logging site was found | 1.2 r21 | |

LOW, noted: `/__golem/statusline` is unauthenticated (1.1 Undocumented), the passcode factor has no
attempt limiting (reach unverified, 1.1), and `session forget <id>` joins an unvalidated id into a
path (1.10 D12).

## Phase 2 inputs: wiki and spec rebaseline

### Gaps: every `partial` / `not-started` row

105 distinct gaps once duplicates are merged. **83 have no existing task doc**, and those are the
task docs Phase 2 must write, or the claims it must retire. The rest name the task that already
covers them.

| ref | feature | class | existing task | hard rule |
|---|---|---|---|---|
| 1.1/r011 | §49 path-like tokens | P | none | **HR** |
| 1.1/r028 | No remove/replace/reorder API; `REDACTION_RULES` never handed out | P | none | **HR** |
| 1.1/r035 | Redaction re-runs over stage output | P | none | **HR** |
| 1.1/r037 | Stage throw: skipped, pre-stage body kept | P | none |  |
| 1.1/r039 | Every problem surfaced by `golem plugin` and counted | P | none |  |
| 1.1/r042 | Regex-hang risk named by `golem plugin` | N | none |  |
| 1.1/r046 | Plugin rules protect an org's private format wherever Golem redacts | P | none | **HR** |
| 1.1/r048 | Prompt-cache stability: "Yes" | P | none |  |
| 1.1/r051 | Declarative pattern-only rules (successor) | N | none |  |
| 1.1/r052 | WASM-compiled rules (successor) | N | none |  |
| 1.1/r060, 1.11/r012 | **G05** SDK surface (thin wrapper over the Anthropic SDK) | N | none |  |
| 1.1/r070, 1.4/r009 | **G19** tree-sitter code parsing / chunking | P/M | none |  |
| 1.1/r092 | CLI-only: a tool call cannot set it | P | none | **HR** |
| 1.1/r093 | Surfaced loudly wherever active | P | none | **HR** |
| 1.1/r095 | "Unrepresentable" | P | none | **HR** |
| 1.1/r098 | Byte-faithful at compression ≤ 1, with recorded-shape tests | P | none | **HR** |
| 1.1/r106 | `ConversationStore` (redact before disk) | P | none | **HR** |
| 1.1/r107 | `JoinQueue` (redact on enqueue, atomic claim) | P | none | **HR** |
| 1.1/r108 | `SessionEvent*` (seq, idempotent) | P | none | **HR** |
| 1.2/r003 | Target-model-friendly prompt translation (20g generalised) | N | none |  |
| 1.2/r019 | Every *request* → (account, provider, reason) selection is appended to `.golem/state/` | P | none |  |
| 1.2/r022 | No silent cross-account fallback | P | none |  |
| 1.2/r033 | `claude-cli` provider retired by R13.12, no live path left | N | R13.14 |  |
| 1.3/r034 | Unified MCP surface re-exports Headroom retrieve/stats/memory | P | none |  |
| 1.3/r037 | `compression.level` gating maps to Headroom config per content type | P | none |  |
| 1.3/r041, 1.11/r009 | **G07** Exact response cache / P-cpu "exact caching" | N | none |  |
| 1.3/r042, 1.11/r025 | **G06** Semantic cache (`StageConfig.semanticCache` has no reader) | N | none |  |
| 1.3/r043 | Tool-result cache with mtime invalidation | P | none |  |
| 1.3/r045 | "Every lossy operation declares its gate", everything lossy is reversible | P | none |  |
| 1.3/r046 | Eval harness (replay per level, LLM judge, quality curves) | N | none (R2.6 is a live A/B on cost, not quality) |  |
| 1.3/r047 | Canary mode | N | none |  |
| 1.4/r002 | Qdrant **server** via config URL ("fully supported", Dec 17; Dec 12) | N | none |  |
| 1.4/r004 | Opt-in shared cross-project "knowledge" collection | N | none |  |
| 1.4/r008 | File-watcher daemons for chosen paths | P | none |  |
| 1.4/r018 | Graph-first lookup "title/**alias**/wikilink" | P | none |  |
| 1.4/r019 | Redaction before storage on every wiki write | P | none | **HR** |
| 1.4/r020 | Wiki pages reach the index through the watcher ("wiki write → watcher → vector index") | N | none |  |
| 1.4/r039 | `fetch` returns the full text of any hit (`getChunk`) | P | none |  |
| 1.4/r065 | Fresh within TTL **or** an explicit `max-age`/`Expires`; 304 → updateMeta; `no-store` or a changed 200 drops the entry | P | none |  |
| 1.4/r067 | Fetched pages are also ingested into the KB, "so a re-fetch of a known URL is free and offline" and `search` finds them | P | none |  |
| 1.4/r070 | Checkpoint every 20 files, deletions first; "a killed run keeps finished batches" | P | none |  |
| 1.5/r007 | R9.11 fixed the uninstrumented tools, so demotion is answerable "next time, on numbers" | P | none |  |
| 1.5/r009, 1.5/r012, 1.11/r021 | **G13** Media pre-processing (Whisper/OCR) and speculative prefetch | N | none |  |
| 1.5/r010, 1.11/r020 | **G14** Local test running → failure digest | P/N | none |  |
| 1.5/r011 | §3.5 git-aware context (diff summaries, commit-history summarisation) | N | none |  |
| 1.5/r014 | §3.5 session memory via local vector DB | P | none |  |
| 1.5/r015 | §3.5 Batch-API off-peak queueing | N | none |  |
| 1.6/r017 | A team-wide prompt comes through the `team` origin, merges per field, and the project layer outranks team | P | none |  |
| 1.6/r028, 1.11/r013 | **G22** LAN worker agent reporting GPU/VRAM/load | P | none |  |
| 1.6/r029 | The hub keeps a capability table and routes jobs by task → minimum tier (Tier 0–3 lists) | N | none |  |
| 1.6/r034, 1.11/r026 | **G21** mTLS / auth between hub and LAN workers | N/P | none |  |
| 1.6/r036 | Classifier/Router ("does this need Claude?" triage, intent tagging) | N | none |  |
| 1.6/r037 | Extractor (structured JSON from logs/HTML/PDF) | N | none |  |
| 1.6/r041 | Bundled llama.cpp as a v2 fallback; vLLM opt-in | N | none |  |
| 1.6/r044 | Models per tier (advisory): ~4B/8B/14B instruct, bge-m3-class embed, **bge-reranker-v2-class cross-encoder** | P | none |  |
| 1.6/r056 | Real spawn/download and multi-GB pull are manual-verification checklist items only | P | R1.6 |  |
| 1.7/r025 | Plan task frontmatter parse (all docs load) | P | none |  |
| 1.7/r027 | `golem task resume` for plan tasks | P | none |  |
| 1.7/r029 | Task `worktree` capture | N | none |  |
| 1.8/r004 | `default!` is the floor for future non-negotiables | N | none |  |
| 1.8/r010 | Pinned control renders locked with origin + recourse (`IMPORTANT_LOCKED`) | P | none |  |
| 1.8/r011 | `ApplyResult.overridden` reported for writes the cascade overrules | P | none |  |
| 1.6/r062, 1.8/r016 | **G08** `inference.worker_targets` retired-and-raises vs live leaf | D/P | none |  |
| 1.8/r046 | Measured by line counting; evidence on every rendered row | P | none |  |
| 1.8/r049 | Every byte written to the guide is redacted before write | P | none | **HR** |
| 1.8/r054 | Seed from `git log --author`; prompt text as voice source | N | `vibe-authored-history` (queued) |  |
| 1.8/r055 | Mark linter-enforced habits as enforced | N | `vibe-authored-history` |  |
| 1.8/r057 | `release.mjs` bumps both package.json + VERSION in lockstep, "all three move or none do" | P | none |  |
| 1.8/r066, 1.11/r005 | **G18** 3-OS CI matrix (macOS advisory) / `platformdirs` | P/D | none |  |
| 1.8/r072, 1.10/r069 | **G23** Release workflow asserts every required asset | P/M | release-portal-assets (done) |  |
| 1.9/r002 | Dashboard: tokens saved/spent | P | none |  |
| 1.9/r003 | Dashboard: cache hit rates | P | none |  |
| 1.9/r004 | Dashboard: cost estimate | P | none |  |
| 1.9/r006 | Dashboard: per-device utilization | N | none |  |
| 1.9/r007 | Dashboard: quality-delta from canary runs | N | none |  |
| 1.9/r012 | `golem replay-eval` | N | none |  |
| 1.10/r004 | Decision 61: gate-map item 3 as an off-by-default setting, fresh re-auth per answer, loud log, kill switch | N | R13.9 |  |
| 1.10/r006 | Relay, account, 2FA, self-host tested path (59(c)-(e), ADR-0006 §3b/§3c) | N | R13.10 |  |
| 1.10/r018 | Remote-authored turns "surfaced locally" to the developer | P | none |  |
| 1.10/r020 | Hosted session "parks at the usage limit like anything else" | P | none |  |
| 1.10/r021 | Interrupt a running turn from the device | P | none |  |
| 1.10/r022 | Permission questions answered in place from the device | N | R13.9 |  |
| 1.10/r029 | `GET /sessions` lists every addressable session, hosted AND joined | P | R13.8 |  |
| 1.10/r031 | The store feeds scrollback and continuation; "consumers: session host (R13.3), transport (R13.5)" | P | R13.8 |  |
| 1.10/r033 | Start a new conversation / continue one from the device | N | R13.8 |  |
| 1.10/r034 | Gate map items 1-9 as real controls | N | R13.9 |  |
| 1.10/r079 | Thread recorded as deferred; orchestrator state machine across turns | N | R14.4 |  |
| 1.10/r080 | One Nostr keypair per persona per project; secret in the credential store; pubkeys in a committed manifest; `buzz-admin add-member` printed, not run | P | R14.2 (queued) |  |
| 1.10/r082 | Buzz Desktop BYOH `custom_harnesses/golem.json` makes `golem` selectable | P | R14.2 |  |
| 1.10/r083 | `golem buzz status` reports the missing binaries and the optional tier-C add-on | N | R14.2 / R14.5 |  |
| 1.10/r084 | Tier C: nested `claude-agent-acp` | N | R14.5 |  |
| 1.10/r085 | Orchestrator `@Golem` addressable in Buzz | N | R14.4 |  |
| 1.11/r023 | P4: fleet (device registry, scheduler, LAN workers, canary evals) | P | none |  |
| 1.11/r036 | 20b task/question queue + concurrent-conversation multiplexing | P | none |  |
| 1.11/r037 | 20c self-hosted remote session access | P | R13.10, R13.8 |  |
| 1.11/r039 | 20e tiered user/workspace/org standards | P | none |  |
| 1.11/r040 | 20f note capture that shapes context (CLI + MCP tool + hook) | P | none |  |
| 1.11/r041 | 20g writing-style adaptation and prompt translation | P | R5.5-scoring |  |
| 1.11/r042 | 21a parallel conversations with model escalation | P | none |  |
| 1.11/r043 | 21b remote steering / permission-granting | P | R12.13, R12.14, R13.15 |  |
| 1.11/r046 | 21e multi-provider routing / quota arbitrage | P | none |  |
| 1.11/r055 | §5 PreToolUse stack = snooze, coder-first, autonomy | P | none |  |
| 1.11/r065 | `syntheses/r5-autonomy-orchestration-batch.md` | P | none |  |
| 1.11/r075 | CLAUDE.md MCP tool list `search`, `fetch`, `expand`, `stats`, `ingest`, `coder` | P | none |  |
| 1.11/r101 | ps.ts | P | none |  |

### Drift: every `shipped-but-drifted` row, grouped by the doc to update

All 194 drifted rows appear here, each under the page, spec section, Decision or ADR its claim
comes from. A row in a duplicate group appears under each member's doc, since each doc needs its
own edit. Most drift is one of four renames that were never carried back into prose:

- slider → two dials (ADR-0004)
- `account` → `gateway` (R9.23)
- the D27/D35 MCP tool names
- `golem-run` → `@pliable/golem`

Rebaselining those four terms across the spec, wiki and code comments clears a large share of the
list.

**ADRs are immutable except for their status.** Each drifted ADR row needs a superseding ADR or an
amendment note, not a rewrite. The ADRs affected are ADR-0001 (the polling watcher), ADR-0002 (ask
→ deny), ADR-0003 invariant 4, ADR-0004 (extra redaction-off paths), ADR-0006 (§2/§3a/§4/§7), and
ADR-0007 (Revision 2 vs §3a).

**ADR-0001**

- 1.4/r089 — Backend: `fs.watch` recursive on Windows and macOS, a per-directory watch on Linux, chokidar as fallback

**ADR-0002**

- 1.7/r017 — ADR-0002 destructive/outward → `ask` (human)
- 1.7/r019 — ADR-0002 "misclassification only escalates; unknown never auto-allowed"

**ADR-0003**

- 1.2/r020 — Invariant 4: no MCP/tool surface reads credentials or selects an account; `src/credentials/` is imported only by the CLI
- 1.2/r021 — Invariant 1: secrets never on a settings/log surface
- 1.2/r034 — Account switching writes a non-secret selector

**ADR-0004**

- 1.1/r094 — Only redaction-free path; every table row `redaction: true` **HR**

**ADR-0006**

- 1.10/r005 — mTLS device pairing: Golem-issued client certs, `requestCert`, no bearer token

**ADR-0007**

- 1.10/r012 — Hosted runner = one long-lived `claude -p --input-format stream-json` process through the proxy

**CLAUDE.md**

- 1.1/r096 — Redaction never weakened or reordered **HR**
- 1.1/r097 — `bypass_all` single exception, CLI-only, loud **HR**
- 1.11/r074 (G01) — CLAUDE.md "What this project is": npm **`golem-run`**
- 1.11/r077 — CLAUDE.md "Source of truth" (task docs → ROADMAP generated)

**README.md**

- 1.7/r032 — README frontmatter table vs parser
- 1.11/r079 — README "`/golem/*` skills", "one local process", "opt-in" local answer
- 1.11/r080 (G01) — README install / `npm i -g golem-run` / `golem update`

**code comments (inference)**

- 1.6/r062 (G08) — `inference.worker_targets` is "retired" in R14.3 and raises
- 1.6/r063 — `persona-lane.ts` is "the ONE implementation"; `coder-route.ts` "now delegates to it"
- 1.6/r064 — Dispatch route label

**code comments / tool descriptions (no owning doc)**

- 1.5/r029 — `coder` structured result matches its `outputSchema`
- 1.5/r050 — `wiki_upsert` description: "every write is committed to git"
- 1.5/r052 — `P1_TOOL_FALLBACK`: "capability has not shipped or is not enabled yet"
- 1.7/r030 — `spawnResume` failure detection
- 1.7/r033 — `golem task done` refuses on unreviewed delegations
- 1.11/r091 — gateway.ts
- 1.11/r099 — prompt-guidance.ts
- 1.11/r100 — proxy.ts **HR**
- 1.11/r102 — select-target.ts
- 1.11/r104 — session.ts
- 1.11/r106 — target.ts
- 1.11/r108 — team.ts

**honest-observability sweep (CLI/dashboard labels)**

- 1.9/r062 — H1 `golem stats` / dashboard / `watch` token figures
- 1.9/r063 — H2 `requests` count
- 1.9/r064 — H3 `golem bench cost` "Golem's measured contribution"
- 1.9/r065 — H4 `golem watch` when Golem net-adds tokens
- 1.9/r066 — H5 `/api/state` compression when state collection fails
- 1.9/r070 — H9 dashboard vs `golem stats` horizon

**spec (Decisions 20, 21, 32, 36 (and >64))**

- 1.11/r044 — 21c dashboard sidecar: statusline, watch, VS Code
- 1.11/r045 — 21d account switching
- 1.11/r049 — 36 roadmap refocus: R5/R6 ON HOLD; housekeeping

**spec Decision 18**

- 1.3/r052 — TS-native lossless P0 + optional Python sidecar; npm client becomes typed transport; fallback to Ollama with no Python

**spec Decision 19**

- 1.8/r064 (G01) — npm package `golem-run`, onboarding `npx golem-run init`

**spec Decision 22**

- 1.2/r002 — The Anthropic path stays byte-faithful; non-Anthropic adapters are a separate code path **HR**

**spec Decision 26**

- 1.6/r052 — `golem ollama setup` is the only call site that installs or pulls; `golem init` and proxy never import `ollama-bootstrap.ts`
- 1.6/r053 — "`drafter` is the only role any call site ever invokes", so one model covers all projects
- 1.6/r055 — Status "ACCEPTED, implementing now"

**spec Decision 27**

- 1.5/r017 — D27: "the 7 MCP tool registration names in `src/mcp/server.ts`"

**spec Decision 28**

- 1.4/r027 — WIKI.md zone 1 = `.golem/webcache`, `.golem/ccr`

**spec Decision 29**

- 1.4/r021 — `upsertPage` appends under a **dated** `---` separator, union-merges tags/sources, bumps `updated`

**spec Decision 33**

- 1.1/r080 — 2 s budget (R10.23)
- 1.4/r090 (G17) — Dec 33 KB half: extractive; `knowledge` scope only; prose-only (`isProseSource`: "wiki/spec/root docs, never code/tests/plan docs"); floor 0.6; label

**spec Decision 34**

- 1.5/r025 — D34: "`boostWikiHits` (`src/mcp/server.ts`)"
- 1.5/r026 — D34 status "PROPOSED, implementing now behind the opt-in flag"

**spec Decision 37**

- 1.7/r010 — DURABLE_TASKS guidance snippet

**spec Decision 38**

- 1.7/r005 — D38 limit-state file name
- 1.7/r006 — D38 park instruction

**spec Decision 39**

- 1.7/r011 — D39 coder-first key/rule name
- 1.7/r012 — D39 gate ordering

**spec Decision 40**

- 1.7/r014 — D40 "corrected the misleading init comment"

**spec Decision 41**

- 1.8/r058 (G01) — Tiered installer npm → Bun binary → bootstrap Node
- 1.8/r061 (G01) — `golem update` / `upgrade`, `--check [--json]`, cached 24 h, fail-soft, install-method aware

**spec Decision 42**

- 1.4/r068 — Dec 42 "15 s `AbortSignal.timeout`"

**spec Decision 43**

- 1.8/r033 — `.golem/settings.json` is a content-free `{}` marker; port + level in `settings.local.json`

**spec Decision 45**

- 1.7/r001 — `snooze.enforce` default
- 1.7/r003 — Park enforce/advisory wording in code

**spec Decision 46**

- 1.2/r013 — `gateway login`: masked prompt → probe → store only if accepted; a rejected key is never stored; inconclusive stores with a warning
- 1.2/r015 — `use` preflight fails closed on an unresolvable credential; `--yes` overrides
- 1.2/r016 — `list` shows key location and strength, never the value

**spec Decision 47**

- 1.2/r012 — "Exporting the var by hand configures nothing"; `credentialEnvForProxy` never reads an ambient var
- 1.2/r014 — Non-TTY `login` reads the key from stdin
- 1.2/r017 — `account remove` logs out first (`forget` before the registry edit); `--keep-credential`

**spec Decision 48**

- 1.2/r026 — `vendor/` prefix kept for multi-vendor gateways (`openrouter` only)
- 1.2/r028 — `--model` on a byte-faithful provider warns **HR**

**spec Decision 49**

- 1.2/r032 — `golem models` prints ids verbatim

**spec Decision 50**

- 1.9/r016 (G27) — Writes route through `setConfig/writeGuidanceRule/setSliderLevel/useAccount/startDetached`
- 1.9/r019 (G28) — Stable control ids `setting:/guidance:/runtime:`

**spec Decision 51**

- 1.9/r039 — Standing constraint: display never pays for write machinery
- 1.9/r047 — `ui`/`settings` recognised "for one release" (exit 2)

**spec Decision 53**

- 1.5/r030 — D53(a/b): tier-1 runtime deps "deliberately tiny — 5"
- 1.5/r031 — D53 / Managed Tools invariant 3: "Exact pins"
- 1.5/r034 — D53(g): the surface is `golem ext`, not `golem tools`; `src/tools/` is the bench harness

**spec Decision 55**

- 1.7/r026 — Quoted scalar values

**spec Decision 56**

- 1.1/r083 — `ProxyDesired` third state
- 1.1/r085 — Shim: no compression, no brevity, no local-answer

**spec Decision 64**

- 1.10/r049 — `api_error` → "team settings are NOT being applied"
- 1.10/r051 — "200 with a non-JSON body" classified one way
- 1.10/r052 — 64(f) nothing entitlement-related fails `golem init`, and "degrade, but never silently"
- 1.10/r058 — Wire tolerates `null` where a field is optional (the §164 lesson)
- 1.10/r062 — Refresh once on 401, then one full re-link, then give up

**spec §1**

- 1.3/r031 (G24) — Library mode: `redaction → headroom.compress() → forward` inside Golem's pipeline **HR**
- 1.3/r032 — `CompressionService` interface isolates Headroom: `compress / retrieve / stats`
- 1.3/r035 — Headroom pin (v0.28.0 codebase evidence)
- 1.6/r025 — Profile boundaries: P-min 8 GB (3060/4060), P-mid 12–16 GB, P-max 24 GB
- 1.11/r001 — Spec version/date line
- 1.11/r002 — Naming note
- 1.11/r003 — Identity: "agentic developer assistant layer for Claude"
- 1.11/r004 (G16) — Lossy/semantic compression "at `compression.level: 3`"
- 1.11/r005 (G18) — Cross-platform hard requirement, "3-OS CI matrix"
- 1.11/r006 (G10) — Slash commands `/golem/...`
- 1.11/r008 (G25) — `search_local` federates memory and knowledge
- 1.11/r010 — Non-goals (no cloud-hosted deployment, and so on)

**spec §2**

- 1.1/r053 (G03) — Single process, two doors, one shared engine
- 1.1/r054 (G01) — `npx golem-run init`
- 1.2/r005 — Spec §2/§2.1: the hub forwards to `api.anthropic.com`
- 1.6/r030 — Tier thresholds: Tier1 ≥6 GB, Tier2 ≥12 GB, Tier3 ≥24 GB
- 1.6/r031 — Fallback: drop **one** tier *with a quality note*, or Haiku via API if allowed, or skip the stage
- 1.11/r011 (G03) — "Single process, two doors"
- 1.11/r014 (G01) — `npx golem-run init`, later `brew install golem-run`

**spec §3**

- 1.3/r039 — Originals reversible via `headroom_retrieve` / `get_original(ref)`
- 1.4/r005 (G25) — `search_local` federates memory + knowledge "with a shared reranker" / "merged and reranked"
- 1.4/r006 — Text-model vs code-model embeddings ("Embed per kind", KB page mermaid)
- 1.4/r012 — MCP tools `index_path`, `search_local(query,k,filter)`, `get_chunk(id)`
- 1.6/r039 — Reranker: cross-encoder rerank of RAG hits

**spec §5**

- 1.7/r034 (G09) — §5.1 slash-command table
- 1.7/r035 (G10) — §5.1 mechanism path
- 1.7/r036 (G11) — §5.1 / D11 settings hierarchy
- 1.8/r013 (G11) — Hierarchy user → project → local → env → per-request headers
- 1.8/r039 (G09) — §5.1 command table (`/golem-index`, `/golem-search`, `/golem-devices`, `/golem-coder`, `/golem-note`)

**spec §6**

- 1.1/r064 (G01) — Distributed as `golem-run`
- 1.1/r065 (G16) — Native lossless stage + Headroom sidecar at `compression.level: 3`
- 1.1/r067 — Embeddings ONNX/transformers.js CPU fallback

**spec §7**

- 1.11/r018 (G10) — P0: `/golem/*` commands, 3-OS CI
- 1.11/r019 — P1: Qdrant indexing, MCP `index_path` / `search_local` / `get_chunk`, guidance "prefer search_local"

**spec §9**

- 1.5/r020 — Spec l.331 frozen-names list
- 1.11/r034 — Init refuses under `headroom wrap`

**src/interfaces/ contract doc comments**

- 1.1/r099 — `PipelinePolicy` / stage table **HR**

**wiki: Architecture**

- 1.11/r051 — §1 topology: one process; MCP "search · fetch · expand · coder · ingest · stats"
- 1.11/r052 — §2 lifecycle: local answer "opt-in" **HR**
- 1.11/r053 — §3 routing; "switch with `golem account use <id>`"
- 1.11/r057 — Dogfooding Golem (dev loop)

**wiki: Auto-Index Cost**

- 1.4/r073 — "see `planBuildEmbedder`'s notices in [[Knowledge Base]]"

**wiki: Buzz Integration**

- 1.10/r074 — `session/cancel` → the in-flight turn resolves `cancelled`, nothing stale posted
- 1.10/r078 — Deferral "posts … with `buzz messages send`"

**wiki: Cache Observability**

- 1.3/r027 — "level 0 is a full bypass" and so never observed

**wiki: Compression**

- 1.3/r002 — Lossless stage "is byte-faithful — the model sees the same content, just packed" **HR**
- 1.3/r003 — "cache-alignment" as a lossless stage

**wiki: Configuration Surfaces**

- 1.8/r021 (G26) — `ownedBy` omits a runtime-owned key; "nothing is editable from two rows at once"
- 1.8/r022 (G27) — `collectControlSurface` / `applyControl` route to existing writers
- 1.8/r024 — `applyControl` throws for a locked control
- 1.8/r028 (G34) — Bare `golem` is the panel; `--dir/--no-pet/--advanced`; unknown flags fall to commander; non-TTY bare prints help

**wiki: Context Ledger**

- 1.9/r059 — "One atomic ... write **per request**"
- 1.9/r061 — "Never written at level 0"

**wiki: Conversation Store**

- 1.10/r032 — Store bounds "both configurable"

**wiki: Device Authentication**

- 1.10/r035 — Two factors (cert + passcode); windows 15 / 5 / 2 min; step-up measured from when the passcode was typed

**wiki: Distillation Pipeline**

- 1.4/r051 — Drafts keyed by slug, so "distilling the same URL again overwrites its prior draft"
- 1.4/r058 — `golem wiki promote --list` / `<id> [--yes]`, "dated separator" append, draft removed, non-TTY refused

**wiki: Guidance Rules**

- 1.7/r023 — Guidance Rules wiki feature list + wiring location

**wiki: Hosted Session**

- 1.10/r019 — Host log bounded to 5,000 lines
- 1.10/r039 — Hosted-session CLI: `start`, `list`, `log`, `explain`, `stop`, `serve`
- 1.10/r040 — Hosted session = "ADR-0007 invariant 8, no exemption"

**wiki: Hosted-multi-turn-claude-CLI-spike**

- 1.6/r021 — `-p --input-format stream-json --output-format stream-json`, one `session_id` across turns

**wiki: Knowledge Base**

- 1.4/r035 — `assembleHits` "in `src/mcp/server.ts`"; `graphFirstWikiHits` "(`src/mcp/server.ts`)"

**wiki: LSP Bridge**

- 1.4/r088 — Page sources `src/ext/lsp/`, `src/ext/manifest.ts`

**wiki: Managed Tools**

- 1.5/r033 — Managed Tools: `/caveman-compress` and `caveman-shrink` "are tracked as follow-ups"
- 1.5/r035 — Managed Tools: "R10.1 renamed … to `golem pkg`, keeping `ext` as an alias"

**wiki: Persona Registry**

- 1.6/r008 — "A `user`-owned persona is a role only a human fills; **nothing may dispatch it**"
- 1.6/r013 — "This repo's own `.golem/settings.local.json` (personal, gitignored) staffs … `claude-opus-5` for `planner` and `reviewer`"
- 1.6/r019 — "What is not here yet": staffing lane — R14.2; agent definitions — R14.3; `discipline` on a task — R14.4

**wiki: Personal Vibe Guide**

- 1.8/r052 — `/vibe quiz` is the only surface that writes a stated preference

**wiki: Plan Tasks**

- 1.7/r028 — Escalate / local multiplex

**wiki: Plugin Seams**

- 1.1/r041 — "Same code path the proxy runs, so what you see here is what the proxy got"

**wiki: Portal Install Contract**

- 1.10/r068 — Installer ladder is exactly two rungs, "do not reorder"
- 1.10/r070 — "no release has been cut since"

**wiki: Project Team Binding**

- 1.10/r059 — Committed `team.portal_url` is "the API base only"; credentials stay in the keychain and "do not follow it"

**wiki: Redaction Path Placeholders**

- 1.1/r020 — `redactReversibleText` used for remote `coder` **HR**

**wiki: Redaction Stage**

- 1.1/r001 — One ordered rule table **HR**
- 1.1/r005 — Pure-hex and 2-of-3-class exclusions **HR**
- 1.1/r006 — Pure function: no clock, randomness or **config** **HR**
- 1.1/r007 — Idempotent: placeholder charset matched by no rule **HR**
- 1.1/r008 — Stage 1, never reordered; `bypass_all` the single exception **HR**

**wiki: Release Pipeline**

- 1.8/r067 — `ci.yml` trigger "PR to `main`; `workflow_call`"
- 1.8/r073 (G01) — `golem-run-<version>.tgz` asset
- 1.8/r078 — `gh api repos/cloudcatalyst/golem/...` clearing commands; repository-settings evidence
- 1.8/r079 — "`development` requires nothing, matching the decision that CI runs only at the release boundary"

**wiki: Session Transport**

- 1.10/r023 — SSE down / POST up, seq, 500-event ring, `gap: true`, 15 s heartbeat, drop a subscriber >200 behind
- 1.10/r024 — Idempotent POST by `messageId` ("exactly once")

**wiki: Settings Cascade**

- 1.8/r008 — "The team origin is a slot, not a feature … nothing fetches one yet"
- 1.8/r009 — Failure rule: nothing about a team link may stop the proxy starting

**wiki: Spawn Headroom Gate**

- 1.7/r002 — `snooze.spawn_gate` default
- 1.7/r008 — Spawn headroom gate logic

**wiki: Team Layer**

- 1.10/r054 — The team origin is applied on every config load ("every config load reads that file")

**wiki: Tool Search**

- 1.5/r045 — Tool Search: `golem bench tools` A/Bs against 27 labelled selection cases
- 1.5/r048 — Tool Search: "Golem's own 11 tools are ~902 description tokens and ~1,128 of input schemas"

**wiki: Web Cache**

- 1.4/r064 — A served page renders RED; the green alternative was "tested and **declined**"

**wiki: Wiki-First Knowledge**

- 1.4/r038 — "Matches score above any vector hit, so a query that names a page … always surfaces that page first"
- 1.4/r045 — `FederatedWikiReader`: `user:` prefix, and "a title collision favors the project page"

**wiki: syntheses/**

- 1.11/r060 — `syntheses/r1.1-net-of-cache-ab.md`
- 1.11/r063 — `syntheses/le2-grounded-refined-coder-quality.md` **HR**
- 1.11/r064 — `syntheses/r4-co-developer-core-batch.md`
- 1.11/r066 — `syntheses/r6-multi-provider-batch.md`
- 1.11/r067 — `syntheses/wiki-knowledge-loop-batch.md`
- 1.11/r070 — `sources/agentic-token-saving-techniques.md`
- 1.11/r071 — `sources/kimi-k3.md`
- 1.11/r072 — `sources/llm-wiki-second-brain-obsidian.md`

### Index, plan and doc hygiene

These are not table rows. DUST1.11 (and DUST1.4 and DUST1.7) reported them separately.

- **WIKI.md index.** Six pages are unlisted: `concepts/Context Ledger.md`,
  `concepts/Hosted-multi-turn-claude-CLI-spike.md`, `concepts/Plan Tasks.md`,
  `questions/wiki-write-autonomy.md`, `syntheses/le2-grounded-refined-coder-quality.md`, and one
  `syntheses/r6-multi-provider…` page. Ten descriptions are stale, including `:132`, which calls
  ADR-0003 PROPOSED and omits ADR-0004–0008. `golem wiki check` flags only unlisted debriefs, so
  none of this fails lint (DUST1.11).
- **Dangling `sources:`.** The Wiki-First page cites `docs/plan/proposals/wiki-knowledge-pivot.md`.
  Distillation cites `docs/plan/next_batch.md` and `docs/plan/R3_BATCH.md`, and ADR-0001 cites
  `docs/plan/next_batch.md`. None of these files exists (DUST1.4).
- **Task docs silently dropped from ROADMAP.** R8.23, R8.25, R8.26 and **R8.29 (queued, an open
  bug)** use `size: XS`, which `PLAN_TASK_SIZES` rejects, and `PlanTaskStore.list()` skips docs
  it cannot parse (DUST1.7 row 25, DUST1.11). 65 docs quote `title:`, so ROADMAP renders literal
  quotes (DUST1.7 row 26).
- **Done docs whose gate the code no longer meets** (DUST1.11): npm-token-set-but-broken, R8.33,
  R13.12, R9.4, R10.8, R13.11, portal-release-webhook, main-branch-enforcement,
  R11.4/docs-slider-drift-remainder, and skill-provenance-on-clone.
- **Queued docs already (partly) shipped** (DUST1.11): R6.3 (its close rule is met), R14.3 stage 1,
  R13.17 (all but `cli-status`), R14.2 (library without CLI), R13.8, R7.3 and R7.6-infra (partial).
  R7.5's gate names the 404 package. R13.14's "blocker cleared" claim cites §148, which is about
  something else. R12.13's blocker is resolved. `portal-success-body-replaced` can be answered now.
- **Task-ID collisions.** R14.2–R14.5 name shipped persona work in SHIPPED.md and code comments,
  and different, queued Buzz work in `docs/plan/tasks/`. R5.1 means two things in Decisions 20a
  and 32 (DUST1.6 C3, DUST1.10 C6, DUST1.11 C6).
- **ROADMAP.md prose.** The header says "137 done" (the docs hold 135 done plus 5 cancelled).
  "Where we are (validated 2026-07-30)" still reports the billing block, which cleared on
  2026-09-04, and describes verification-notes as §1–§100.
- **Spec header** is v1.17 / 2026-07-16 against a log that runs to v1.32 / Decision 64. The naming
  note on `:8` contradicts itself after the rename scrub (DUST1.11 rows 1–2).

## Phase 3 inputs: refactor and fix candidates

### Confirmed code bugs

These are behaviour defects, not doc drift. Items S1–S21 above are also Phase 3 inputs and are not
repeated here. Within each band the order is by partition. "Probed" or "reproduced" means the
auditor ran the behaviour. Every other bug was confirmed by reading the code.

**Functional, high impact**

- **DUST1.5 h1.** `coder` breaks its own `outputSchema` on the dispatched path and on every
  `refine: true` call. It adds `target`, `trust`, `route`, `redacted_count` and
  `refinement.status`/`critiqued_by` (`coder-tools.ts:509-529` vs `:237-274`). Reproduced: an SDK
  client that called `listTools()` rejects the result with -32602. Tests miss it because they
  never list first. Whether Claude Code enforces this is unverified; if it does, every routed
  `coder` call fails.
- **DUST1.4 D6.** Cross-process lost update on the vector store. Every process (the `mcp serve`
  daemon, the WebFetch hook, `golem index`, the proxy) loads its own copy of `chunks.jsonl` and
  rewrites the whole file on each write, with no lock and no reload (`file-driver.ts:152-153`,
  `:215-232`). Pages the hook ingests are erased by the daemon. Every Claude Code session runs
  this combination.
- **DUST1.11.** SessionStart's proxy auto-start calls `startDetached(…, {}, …)`, which always sets
  the credentials-injected marker (`proxy-daemon.ts:456`). The daemon then skips credential
  resolution (`proxy.ts:215`), so gateway keys never load. The same pattern is at
  `control-surface-runtime.ts:184`. Found by reading, not reproduced.
- **DUST1.11.** `golem team sync` calls `portalContext()` before the unlinked early return
  (`team.ts:492-497`), so solo users get exit 2. This is the regression `:405-411` records as
  fixed for `status`.
- **DUST1.10 D3.** `golem init` reports a 402/403/api_error as "signed in and up to date", and a
  stale cache as freshly applied (`init.ts:556-575`).
- **DUST1.6 D26e.** `golem ollama setup` pulls only the drafter, but `summarizer` (distill) and
  `judge` (rerank, `coder --refine`) are live roles. They fail with `CapabilityUnavailableError` on
  a machine that setup reported as ready.
- **DUST1.6 C-a, DUST1.8 h4.** The `inference.worker_targets` retirement never fires: the key is
  still a schema leaf, so `RETIRED_SETTINGS` is unreachable. It still outranks personas in every
  routing function. Probed: it loads silently.
- **DUST1.3 C3.** `knowledge.read_skeleton_enabled: false` has no effect on the default hook
  invocation. The fast path (`fast-path.ts:69-75,331-346`) never passes `skeletonEnabled`, and the
  guard test checks three fields only.

**Functional, medium**

- DUST1.1 h7: the bypass shim compresses (`SHIM_POLICY = policyFor(1)`), while D56(c), the stop
  banner and three comments say it does not. **HR** (byte-faithfulness).
- DUST1.1: any redaction or level-1 dedup re-serialises the whole body with `JSON.stringify`
  (`pipeline.ts:753`), which normalises bytes outside the changed span. **HR**. See contradiction
  C1.
- DUST1.1 h9: `isPathLikeToken` rejects chunks containing `=`/`+`, so `OUT_DIR=<path>` is still
  over-redacted. **HR**.
- DUST1.1: plugin `validate` problems accumulate in an unbounded in-memory array. Zero-length regex
  plugin rules (`/x*/g`) insert a placeholder at every position. On the local-answer path the
  held-request log omits the stage that held it (`pipeline.ts:548` vs `:563`).
- DUST1.2: `gateway use` on a keyless `ollama`/`llamacpp` gateway refuses without `--yes`, and
  `gateway list` shows `key MISSING` for it, although tests pin both (contradiction V1). `golem
  models` truncates ids over 33 characters without an ellipsis. `--store fiel` silently means
  keychain. `gateway add --login` fails on a non-TTY. `forget` swallows a keychain fault. Once
  more than one target exists, `bodyModelOf` does a full `JSON.parse` of every body. `model[262k]`
  goes on the wire as a model name.
- DUST1.3: `KNOWN_HEADROOM_CONFIG_FIELDS` lacks `router`, so a documented D57 key is reported
  unreachable. The CCR bridge pairs messages by index, so one dropped message misaligns every
  later pair. `ccrRefsStored` counts substitutions whether or not anything was stored.
- DUST1.4: D3 (a file that stops yielding chunks keeps its old vectors), D4 (`golem index <path>`
  and `--watch` wipe the manifest file map), D5 (a sub-path ingest duplicates files), D1 (the user
  wiki wins title collisions in graph-first search), D2 (`upsertPage` does not normalise `.md`),
  D10 (full rebuilds delete the index first and checkpoint only at the end), D7 (`getChunk` does
  not open the collection), D8 (web-cache freshness ignores `max-age` and `no-store`), D11 (distill
  drafts are keyed by the model's slug), D12 (frontmatter lists split on `,`), D13 (ingest watchers
  are never closed), D14 (a failed KB build disables graph-first search), D9 (rerank accepts
  invented ids).
- DUST1.5 h3: two `golem bench tools` cases target the retired `level` tool, which caps every
  accuracy figure at 25/27. The `code` tool has no case. h5: `snooze` and `wiki_upsert` are still
  uninstrumented.
- DUST1.6: W8 (see S19), C-b (`coder-route.ts` is a second, divergent resolution chain), and C-c
  (the route label names `inference.worker_targets` for a persona-sourced value).
- DUST1.7: row 28 (an escalated task is re-serviced locally and marked done), row 30
  (`spawnResume` can never report failure, because `'error'` fires asynchronously), row 26
  (quoted scalars are stored verbatim), row 8 (the spawn gate ignores `resetAtIso`, and the
  spawn-gate/delegation-ledger read-modify-write is racy), and row 27 (`golem task resume` cannot
  resume plan tasks).
- DUST1.8: h3 (team policy is invisible to `golem config`, the TUI, VS Code and `config schema`),
  h5 (duplicate control rows because `ownedBy` is never set, and its test passes vacuously),
  `package-lock.json` not bumped by `release.mjs`, non-atomic version writes, `vibe confirm`
  accepting a tombstoned key, `applyControl` accepting writes to important- or opaque-locked
  controls, and a false "overridden" report for `inference.personas`.
- DUST1.9: D2 (dashboard stats source frozen at startup), D3 (the rollup can splice two files
  across a rotation), D4 (a partial trailing line advances the watermark and the event is lost),
  D5 (`golem watch` ignores `NO_COLOR` and non-TTY), D6 (the watch footer misreports its cadence),
  D7 (the statusline runs `aggregate()` on every prompt for figures it never renders), D8 (literal
  NUL bytes in `jsonl-store.ts` and `cost-benchmark.ts` make git treat them as binary), D9 (watch
  frames overlap), D10 (storage sizing reads the wrong CCR directory in a linked worktree), and D11.
- DUST1.10: D5 (the SSE slow-subscriber drop frame desynchronises `Last-Event-ID`, so an event is
  skipped), D6 (the `api_error` notice is contradicted by the next load), D7 (Buzz cancel with no
  turn in flight silences the next turn), D8 (idempotency check-then-act races in `transport.ts`
  and `join-queue.ts`), D9 (Buzz provisioning orphans identities), D10 (`session host stop` on
  Windows likely leaves the `claude` child running; suspected), D11 (the Buzz Desktop harness
  definition cannot start), plus `trimHostLog` never being called (the host log is unbounded),
  `/interrupt` answering 501, and a 4xx with a known code stamping the entitlement cache.
- DUST1.11: `select-target.ts` duplicates the port resolver and skips the port-free check and
  `writeProxyDesired`. `ps` never collects the `dashboard` kind it advertises. `task review
  --waive` with no id waives everything. `target.ts` user-facing strings name `account login` and
  `proxy.accounts`.

### `dead-or-superseded` rows

40 distinct rows once duplicates are merged. Most are superseded doc claims that Phase 2 retires.
Where code still carries them, they are also Phase 3 deletions (see the dead-candidate list after
this table).

| ref | feature | section | hard rule |
|---|---|---|---|
| 1.1/r012 | "Open, not yet fixed" credit-card item | Wiki — `concepts/Redaction Stage.md` | **HR** |
| 1.1/r058, 1.1/r059, 1.5/r002, 1.5/r003, 1.11/r015 | **G02** Spec §2.1 MCP tool names (`search_local`, `get_original` …) superseded by D27/D35 | Spec §2.1 Integration surfaces (proxy half) |  |
| 1.1/r066, 1.4/r001 | **G15** Vector DB Qdrant / LanceDB (spec §3.1, §6, Dec 3/17) | Spec §6 Tech Stack |  |
| 1.1/r069 | SQLite cache/metadata store | Spec §6 Tech Stack |  |
| 1.3/r030 | Golem depends on `headroom-ai` as its compression stage | Spec §1.1 / §1.2 |  |
| 1.3/r033 | Level 3 may route text compression to Golem's local LLM | Spec §1.1 / §1.2 |  |
| 1.3/r038 | Semantic compression at `compression.level: 3` via Golem's tiered local LLM | Spec §3.2 / §3.4 |  |
| 1.3/r049 | Build on headroom-ai, library mode behind `CompressionService` | Decisions |  |
| 1.3/r050 | MCP exposes the slider (`eol_set_slider`) | Decisions |  |
| 1.3/r051 | Headroom pin `headroom-ai[code]==0.28.0` | Decisions |  |
| 1.3/r054 | Four-level slider + level-0 full bypass | Decisions |  |
| 1.4/r013 | Dec 2: memory on Headroom's Qdrant; evaluate `--code-graph` | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) |  |
| 1.4/r015 | Dec 17: LanceDB as the embedded engine (sqlite-vec fallback) | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) |  |
| 1.4/r016 | Dec 24: proxy-side KB substitution, "design memo only; not built" | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) |  |
| 1.4/r023 | Plan-gated agent writes, "propose, get approval, then `wiki_upsert`" | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) |  |
| 1.4/r043 | Promote is human-gated and only calls `wiki_upsert` on approval (Dec 29) | Knowledge Base page and Wiki-First page: search path |  |
| 1.4/r057 | Stage 3 "plan-gated, unchanged" | Distillation Pipeline page |  |
| 1.5/r018 | D27: `golem_set_slider` → `level` | Classification table |  |
| 1.5/r019 | D27: `golem_devices` "keeps its current name" | Classification table |  |
| 1.5/r028 | D35: "No behavior change: same `inference.chat("drafter", …)` call" (local model) | Classification table |  |
| 1.5/r051, 1.7/r039 | **G12** `slider` / `bypass` / `stats` MCP prompts drive the retired `level` tool | Classification table |  |
| 1.6/r045, 1.11/r022 | **G38** Level-5 per-project local-only answers (D7 / P3 roadmap) | Decisions |  |
| 1.6/r048 | Mode A draft / Mode B local_first proxy intercept, `ProxyRequest.localResponse`, live slider reload | Decisions |  |
| 1.7/r018 | ADR-0002 read MCP set incl. `level` | Findings table |  |
| 1.7/r037 | D11 `.claude/commands/` files | Findings table |  |
| 1.7/r035, 1.8/r038, 1.7/r038, 1.11/r006, 1.11/r018 | **G10** Skills layout `/golem/<cmd>` nested vs flat `/golem-<cmd>` | Findings table |  |
| 1.8/r040 | `golem init` appends guidance to project CLAUDE.md | Init (D43, D58, §5.1 commands/mechanism) |  |
| 1.8/r065 | Python/uvx implementation | Distribution, versioning, update (D41, D16, D19, D4, D9) |  |
| 1.8/r021, 1.9/r015 | **G26** `SettingMeta.ownedBy` hides runtime-owned keys (CS §1 / D50(a)) | Decision 50 |  |
| 1.9/r021 | `golem ui` / alias `golem settings` | Decision 50 |  |
| 1.9/r024 | ink + React accepted | Decision 50 |  |
| 1.9/r037 | `cli/slider-read.ts` is the read-only half | Decision 51 |  |
| 1.10/r003 | 59(a) "destructive/outward never remotely approvable, no setting to change it" | ADR-0006 / Decision 59 (remote steering) |  |
| 1.10/r008 | Decision binding `{session, tool, digest, nonce, deadline}` | ADR-0006 / Decision 59 (remote steering) |  |
| 1.10/r009 | Remote decisions logged to `autonomy-log.jsonl` with device fingerprint | ADR-0006 / Decision 59 (remote steering) |  |
| 1.10/r010 | Capability 3 "does not exist" / DECLINED | ADR-0006 / Decision 59 (remote steering) |  |
| 1.10/r076 | "Two defects that block axis 2 today" (no `model` on `DispatchRequest`; no worker-lane `resolvePersonaPrompt`) | Buzz Integration (R14.2-R14.5) |  |
| 1.11/r024 | Decision 21 phase placement note | §7 Phased Roadmap |  |
| 1.11/r030 | Resumed durable task double-applies a side effect (idempotency keys) | §8 Risks & Mitigations |  |
| 1.11/r061 | `syntheses/r2.1-avoidedupstream-spike.md` | Wiki: `syntheses/`, `questions/`, `sources/` |  |

### Dead candidates in code

These are symbols and branches that each partition found with no reachable production caller. They were auto-extracted from every note's Dead candidates section and are not re-verified here. **HR** marks a hard-rule area. Several of them are contract-mandated or staged for a queued task, and the source note says which. Read the note before deleting anything.

**DUST1.1** (3)

- `src/proxy/context-guard.ts` (321 lines) and `src/proxy/context-monitor.ts` (254): re-exported at `src/proxy/index.ts:1-2`, `:79-80`, with no importer anywhere (repo-wide grep, tests included). `context-guard.ts:13` imports `../providers/gateways.ts` with a `.ts` extension.
- **HR** `StageConfig.semanticCache` and its `SemanticCache` values: written in `policy.ts:135-173`, read nowhere.
- `BuildProxyOptions` has an orphaned doc comment for a deleted slider-store field (`src/cli/proxy-runtime.ts:93-97`).

**DUST1.2** (3)

- `resolveModel` (`src/providers/targets.ts:195-202`). Re-exported from `src/proxy/index.ts:48`, but a grep of `src/`, `tests/` and `vscode-extension/src` finds no caller. Its only other mention is the stale doc comment at `targets.ts:300-305`.
- `ResolvedTarget.contextSize` (`targets.ts:108-109`). Never assigned: `toResolved` (`:208-225`) does not set it, and `entry.model?.name` (`:284`) drops the descriptor's `contextSize`. The context monitor/guard read the descriptor from elsewhere.
- `DEFAULT_KEY_ENV` / `envVarForGateway` remain, correctly, as the internal handoff (D47). Not dead.

**DUST1.3** (7)

- **HR** `SemanticCompression = "low_relevance"` (`policy.ts:117`) and its worker preset `headroom-worker.py:244`: no `LEVEL_TABLE` row produces it (`policy.ts:138-174` uses only `off`/`stale_turns`/`aggressive`), and no caller passes it.
- **HR** `StageConfig.semanticCache` and `SemanticCache` values `strict`/`normal`/`loose` (`policy.ts:120,135`): written, never read (row 42). `normal` is not even used by the table.
- **HR** `StageConfig.toolResultCache` on the proxy path: only `src/mcp/in-memory-compression.ts` reads it (row 43).
- `HEADROOM_CLIENT_NPM_PIN` (`pins.ts:32`): its own doc says "Golem does NOT use it". Grep shows consumers only in the barrel re-export and tests.
- **HR** `HeadroomSidecar.health()` (`headroom-adapter.ts:723-728`): no `src/` caller found by grep of `.health(` on a `HeadroomSidecar`. The static list is used instead (`status-collect.ts:18`). Verify before removing, since it may be test-only by design.
- `LocalDirBlobStore.stream()` / `.delete()` (`local-blob-store.ts:115-136`): required by the frozen `BlobStore` contract, but no CCR caller. Contract-mandated, so keep. Listed for completeness.
- Duplicated chars/4 estimators: `src/prompt/compact.ts:70-72` and `brevity.ts:153-155` reimplement `compression/tokens.ts:17-22` (minus the `max(1)`). Not dead, but redundant.

**DUST1.4** (7)

- `GolemKnowledgeBase.closeWatchers` (`knowledge-base.ts:226`): 0 callers (see D13).
- `asFederatedSearch` (`knowledge-base.ts:337`): 0 callers outside `knowledge/index.ts:86`.
- `resolvePersistedEmbedMode` (`auto-index.ts:136`): 0 callers. Only a comment mentions it (`src/cli/proxy-runtime.ts:107`).
- `isPdfExtractionAvailable` (`extractors.ts:52`): 0 callers. Its comment says the `golem ext` registry uses it, but the registry uses its own module detect (`src/pkg/manifest.ts:253`).
- `knowledge.vector_db_url` (`schema.ts:476`) and the Qdrant branch in `selectDriver` (`knowledge/index.ts:177-182`): no reader passes the key, so the branch is unreachable in production.
- `InMemoryVectorDriver` (`driver.ts:139`): 0 production callers, test-only. The comment says so, but other comments still call it "the P0 default" (see Stale comments).
- `ZONE_FOR_TYPE.adr = "decisions"` (`promote.ts:42`): unreachable by design, and documented as such.

**DUST1.5** (4)

- `slider` prompt (`prompts.ts:13-39`): its only action targets a tool that does not exist.
- `bypass` prompt's persistent-change branch (`prompts.ts:96-101`): `level` tool, `golem slider 0`.
- Bench cases `level-1`, `level-2` (`cases.ts:83-85`), `arg-level-1` (`cases.ts:192-195`).
- `P1_TOOL_FALLBACK` "not shipped" branch (`prompts.ts:9-10`).

**DUST1.6** (6)

- **`HaikuFallbackRequired` / `FallbackPolicy.allowHaiku`** (`service.ts:37-59,141-143`): `grep new OllamaInferenceService(` shows every construction site passes no `fallback` (`cli/build-knowledge.ts:99,121`, `cli/commands/tasks.ts:65`, `cli/commands/mcp-serve.ts:198`, …), so `allowHaiku` is always false. `grep HaikuFallbackRequired` finds no catch site outside `service.ts` and `index.ts:74`. This implements spec §2.2:153 "Claude Haiku via API if the user allows", with no config key and no caller. **X** (X1)
- **`selectTarget`'s `persona_worker` branch** (`target-dispatcher.ts:731-736`): unreachable. `workerTarget()` (`workers.ts:84-97`) already returns `workerTargetFromPersona(...)` whenever the persona is known. When `personas` is defined and the worker is undeclared, both return undefined; when `personas` is undefined, `workerTargetFromPersona({}, …)` is undefined. So `route:"persona_worker"` can never come out of `selectTarget`. The `describeRoute` `"persona_worker"` case (`:231`) is reachable only by construction. **X**
- **`coderRouteConflict` second branch** (`coder-route.ts:171-180`): its only caller (`mcp-serve.ts:214-219`) sets `defaultCoder = personaModel(personas,"coder")`, which is the same string `workerTargetFromPersona(personas,"coder")` returns, or undefined. `fromPersonaWorker !== configured` therefore never holds while both are defined. The message also compares a key against itself ("`personas.coder.model` … and `personas.coder.model`"). **X**
- **`RETIRED_SETTINGS` entry for `inference.worker_targets`** (`migrations.ts:98-103`): unreachable while the leaf exists (C-a). **X**
- **`DesiredAgent.discipline`**: set in `persona-sync.ts:111`, read only by `persona-preference-rule.ts:57`. `personaAgentDefinition` (`agents.ts:49-60`) ignores it. It is used, so not dead; listed for completeness only
- `unknownWorkerWarnings` (`workers.ts:108-125`), called at `status-collect.ts:440`: live, but it only ever sees `worker_targets` keys. Live while C-a stands

**DUST1.7** (4)

- `spawnResume` failure branch (`src/cli/task.ts:215-222`) — unreachable (`'error'` is async).
- Task `worktree` capture fields (`src/tasks/types.ts:94-100,121`) — no writer.
- `/mcp__golem__slider` prompt (`src/mcp/prompts.ts:13-40`) — targets a retired tool (not owned).
- **HR** `identityRedact` (`src/hooks/redact.ts`) — test-injection only per its own doc; confirm no prod caller in DUST1.3.

**DUST1.8** (5)

- `coerceLevel` — `src/config/control-surface-types.ts:205-213`. Only its definition references it (grep over `src tests vscode-extension scripts`: 1 hit). Error text also wrong ("expected 0–3" while accepting 0–5, key `slider.level` retired).
- `SettingMeta.ownedBy` — declared `ui-model.ts:149`, filter `control-surface-settings.ts:50`, never populated (`grep ownedBy src` finds no value). Test `config-ui-model.test.ts:44` is vacuous.
- `ApplyControlOptions.initProbe` — `control-surface-types.ts:183-197`; nothing reads it (`grep initProbe src` outside `cli/init*`: only the declaration). `applyRuntime` comment (`control-surface-runtime.ts:139-143`) says the probe is no longer needed.
- `RETIRED_SETTINGS` entry for `inference.worker_targets` — `migrations.ts:98-103`; unreachable because the leaf exists (`schema.ts:303`).
- Migration-table skip branch — `tests/unit/config-migrations.test.ts:55-57` skips `worker_targets → personas`, but no such entry exists in `SETTING_MIGRATIONS` (`migrations.ts:41-61`).

**DUST1.9** (10)

- `_levelFallbackName` — `src/cli/session-report.ts:234`, no references (grep `src` `tests`); Also names "passthrough", which is retired
- enum branch of `needsConfirm` (`=== "0"`) — `src/tui/state.ts:366`. Every `danger` in `ui-model.ts` (`:168,547,556,595`) is on a boolean leaf. `runtime:compression` copies `compression.level`'s meta, which has none (`control-surface-runtime.ts:51`); Slider level 0 no longer exists
- `SettingMeta.ownedBy` — declared `ui-model.ts:149`, read `control-surface-settings.ts:50`, never set; See D50(a) row
- `aggregateUsageByLevel`, `usageReportRows` — no `src` caller outside `src/telemetry/` (grep); tests only; Leftover from the slider A/B
- `aggregateUsageBySemanticForced`, `semanticForcedReportRows` — only comment references in `config/schema.ts:416`, `pipeline.ts:238`; Staged for **R2.6** (queued), not dead
- `aggregateAvoidedUpstream` — no `src` caller outside telemetry (grep). `cost-benchmark` folds events itself; —
- `windowedStats` (no-fallback variant) — re-exported by `telemetry/index.ts:75`, with no caller or test; —
- `DIM` in `src/tui/ansi.ts` — defined once, never referenced in `src`; —
- `GolemState.tokensBefore/After` — populated `statusline.ts:914`, never rendered; See D7
- `liveStatsSource` in steady state — reachable only when telemetry has 0 requests (`mcp-compression.ts:24-33`); Keep, but see D2

**DUST1.10** (10)

- `trimHostLog` (`src/session/host-log.ts:111`)
- **HR** `FileJoinQueue.prune` (`src/session/join-queue.ts:278`)
- **HR** `LocalConversationStore.appendTurn` / `readConversation` / `listConversations` (`conversation-store.ts:187-240`): test-only until R13.8
- `hostSessionLogPath` as a write target (`host-registry.ts:33`): only removed, never written
- `provisionBuzz`, `mintIdentity`, `rotateIdentity`, `findGenerateKeyRunner`, `runGenerateKey`, `addMemberCommand` (`src/buzz/provision.ts`, `src/buzz/identity.ts`): no CLI yet (R14.2 queued)
- `golemHarnessDefinition`, `harnessDefinitionPath` (`src/buzz/harness-definition.ts`): no installer
- `RunAcpTurnDeps.postChannelMessage` / `recordDeferred` seams (`acp-turn.ts:73-80`): R14.4
- `WriteServerOptions.stepUpPaths` (`src/security/write-server.ts:82`): never passed. Not owned, but it carries Device Authentication's step-up claim
- `init-team.ts:197-211` catch branch: unreachable with the production `syncTeamLayerForInit` (D3)
- `HostAttachment.attached === true` path in `resolveHostGate` (`host-gate.ts:128`): no caller passes an attachment

### Stale comments

These are code comments, tool descriptions and user-facing strings that contradict the code beside them. They were auto-extracted from every note's Stale comments section. DUST1.4's list ends with three doc-side `sources:` entries, which belong to Phase 2.

**DUST1.1** (9)

- `pipeline.ts:14` "secret-free level-0 requests"; `:20` "slider ≥2"; `:162-163` "persisted slider level"; `:209` "(slider ≥3)"; `:287` "`slider.level`"; `:720` "off at slider 0".
- **HR** `proxy-runtime.ts:139-143`: calls `x-golem-bypass` "the single sanctioned redaction-off path" (ADR-0004 moved that to `bypass_all`). `:201-202` says "redaction and nothing else" while `SHIM_POLICY` compresses.
- `sidecars.ts:37-38`: "≥2" and "first ≥3" in one comment. `:44`: "shim runs no compression at all". `:65`: "OFF by default".
- **HR** `redaction-rules.ts:318`, `:387` cite §137; should be §140.
- **HR** `redaction.ts:308-310` "Runs over the ENTIRE JSON" (keys excluded). `:18-20` and `redaction-rules.ts:15-16` claim idempotency (false for `connection-password`).
- `server.ts:11-13` "at A1 the pipeline is the identity". `:235-239` says every terminal path reports, but `:536-537` and `:586-587` return without `report()`.
- `cli/plugin.ts:33-34` "what you see here is what the proxy got".
- **HR** `policy.ts:19` "1 — … Byte-faithful" while level 1 rewrites via dedup/compaction.
- `commands/proxy.ts:560` (user-facing): "compression … off" on the shim.

**DUST1.2** (15)

- `src/cli/gateways.ts:66`: "(`golem gateway login <id>` or exporting the env var)". Env was removed by D47, and the thrown message (`:134-136`) rightly omits it.
- `src/cli/gateways.ts:168,181,196,265,291`, `gateways/registry.ts` throughout: "`account login`", "`account use`", "`account add`", "`account remove`". Those commands are `gateway …`.
- `src/cli/gateways/credentials.ts:220-226`: calls the helper `perGatewayEnvVar`, but the code uses `envVarForGateway` (which delegates to it).
- `src/credentials/index.ts:12-13`, `store.ts:32-33`: "no MCP/tool surface imports any of this". False (row 20).
- `src/credentials/backends.ts:9-10`: "Windows DPAPI via `powershell.exe`". The code prefers `pwsh.exe` (`:383`).
- `src/cli/route-resolver.ts:23-25`: "no key is ever … placed on a `ProxyRoute`". False for Gemini (row 21).
- `src/cli/commands/mcp-serve.ts:62-64`: says `credentialEnvForProxy` "encodes which store id backs the active account". When `inference.model` is a target id, it looks up the *target* id as a store id (`gateways/credentials.ts:246`), which never exists. This is harmless only because `accountsReferencedByTargets` also injects the backing gateway. Compare `useGateway` (`gateways.ts:116-118`), which does map target → gateway.
- `src/providers/index.ts:1-16`: the module header says "Anthropic-native providers … Nothing here translates bodies". The module is the barrel for every translator and all case-(b) predicates.
- `src/providers/gateways.ts:41-42`: `"model[262k]"` as a supported suffix. The schema parser only accepts digits (`src/config/schema.ts:197`, `/\[(\d+)\]/`), so `model[262k]` becomes a model *name* and goes on the wire as-is. (The parser is outside this partition.)
- `src/providers/targets.ts:8-13,22-25`: a `proxy.accounts` table and "This module is inert in R9.1". It is `proxy.gateways` and has been routed since R9.2.
- `src/providers/targets.ts:300-305`: "may also be a bare model name … resolved via `resolveModel`". Code never does this.
- `src/cli/targets.ts:19-20`: "In R9.1 the registry is inert". `:252`: compound id `<gateway>/<model>`, but the separator is `:`. `:375`: "(stored now, enforced in R9.3)".
- `src/cli/gateways/registry.ts:188-193`: "`active` stays a GATEWAY id", but for a target with `accountId: null` it falls through to `selectedTarget.id`.
- `src/providers/openai-translate.ts:427`, `gemini-translate.ts:212`: remediation "set proxy.upstream_model" is wrong for gateway targets (`models[]` / `golem target add --model`).
- `src/cli/commands/gateway.ts:229`: stray apostrophe in the user-facing text, "KEPT'—". Not owned; noted for Phase 3.

**DUST1.3** (11)

- **HR** `src/compression/native-lossless.ts:378`: "Level 0 — byte-faithful passthrough". The branch now serves `compression.level: off`, which is redaction-only, not level 0.
- `src/compression/semantic.ts:2,12,19`: "slider ≥3" / "(level ≥3)". Semantic runs at level ≥2 (`pipeline.ts:648`), and the slider is retired. `:10` "CompressionService (… levels ≤2)" is likewise wrong: lossless runs at every level ≥1.
- `src/compression/index.ts:41`: "semantic-compression seam (slider ≥3)".
- **HR** `src/compression/headroom-adapter.ts:8`: "slider ≥3 semantic compression". `:31`: "The exact PyPI pin lives in ./index.ts", but it lives in `pins.ts` (index only re-exports). `:582`: "the slider's behaviour".
- `src/compression/headroom-ccr-bridge.ts:5`: "slider ≥2". Level is right, name retired.
- **HR** `src/compression/headroom-worker.py:24,236`: "the Golem slider". `:245`: `"stale_turns" (level 3)`, but `stale_turns` is level **2** (`policy.ts:162`).
- `src/compression/context-substitution.ts:28-29`: "See pipeline.ts's `isCachingUpstream`". It moved to `effective-level.ts:45`.
- `src/prompt/compact.ts:22`: "Tier 2 depends on `golem ext install` (R8.14), which is not built". Decision 53(i) records R8.14 shipping as `golem pkg install`.
- `src/cli/fast-path.ts:332-336` (not owned, but it is the CCR-swap entry point): "program.ts passes no PostToolUseOptions field … into buildHookCommand". False: `src/cli/commands/prompt-guidance.ts:326-332` passes `skeletonEnabled`. See Contradictions §3.
- `src/pipeline/pipeline.ts:720` (DUST1.1's file): "'off' at slider 0".
- `src/mcp/prompts.ts:95` (not owned): prompt text still says "persistent slider".

**DUST1.4** (16)

- `src/knowledge/driver.ts:4-13,134-138`: names LanceDB as the embedded engine and InMemory as "the P0 non-durable default until the embedded native driver lands". The FileVectorDriver is the default.
- `src/knowledge/index.ts:1-10,142,158-159`: "in-memory at C1 until the native engine", and "When set, uses the server driver" for `vectorDbUrl`. It throws instead.
- `src/hooks/web-fetch.ts`: `:4-13` (module header): PreToolUse "Else allow the fetch" and PostToolUse "capture the fetched content". Both are pre-Decision-42. `:133`: `buildKnowledge` is marked "Post hook only", but the pre hook ingests too (`:290`). `:153-158`: says `fetchRaw` means "the PostToolUse hook caches/ingests the raw page". The pre hook does.
- `src/knowledge/raw-fetch.ts:11-15`: validators "only populate after a separate conditional GET", and the fetch is called "only from the store-only PostToolUse hook". Both are wrong: the pre hook calls it and seeds the validators (`web-fetch.ts:267`).
- `src/config/schema.ts`: `:477`: `watch_paths` "auto-ingested and watched for changes". Never watched. `:619-624`: `webcache_fetch_raw` says "fetch the RAW page ourselves in the PostToolUse hook". It is the PreToolUse hook.
- `src/cli/wiki.ts:463-464`: "the wiki is plan-gated; a human or an approved agent write fixes what's found". Dec 44 removed that gate.
- `src/cli/promote.ts:8-13`: "dated separator" and "The human approving IS the plan-gate (Decision 28)".
- `src/cli/notes.ts:12-13`: "plan-gated like every other wiki write".
- `src/wiki/federated-wiki-reader.ts:6-7,11,44-45`: points at `src/mcp/server.ts` for the graph-first machinery, which is now `search.ts`. `:48-49` "The project wins on a title collision" is true only for `readPage`.
- `src/knowledge/rerank.ts:9-12`: "invented … chunkIds falls back". Invented ids are dropped silently when every original id is present.
- `src/knowledge/extractors.ts:48-51`: "Used by the `golem ext` registry". It is not.
- `src/pkg/lsp/index.ts:2`, `bridge.ts:97`, `servers.ts:5`: `src/ext/…` paths. The directory is `src/pkg/`.
- `src/mcp/wiki-tools.ts:104-106` (tool description, which the model reads): "appended under a dated separator". It is undated.
- Wiki-First `sources:` and l.27 cite `docs/plan/proposals/wiki-knowledge-pivot.md`, which no longer exists (Dec 28 says it was retired).
- Distillation `sources:` cites `docs/plan/next_batch.md` and `docs/plan/R3_BATCH.md`. Neither exists.
- ADR-0001 `sources:` cites `docs/plan/next_batch.md`, which does not exist.

**DUST1.5** (8)

- `src/mcp/server.ts:79-80` — "`expand`/`stats`/`level` (and `devices`/`snooze`)" were uninstrumented. `level` no longer exists, and `snooze` is *still* uninstrumented. The comment reads as though both were fixed.
- `src/mcp/server.ts:65` and `prompts.ts:2` — "all 8 frozen prompts". The set includes a retired one.
- `src/tools/ext-shrink.ts:14` — "the same tier-2 shape as `golem ext`". The command is `golem pkg`.
- `src/tools/cases.ts:83` — "// level — set the slider".
- `src/tools/catalog.ts:6-7` — cites `level`'s description size. Historical, but reads as current.
- `tests/unit/tools/catalog.test.ts:10` — "The 7 Decision 27/35 tools plus devices + snooze …". The list holds 6 of those 7 (`level` gone).
- `tests/unit/tools/catalog.test.ts:40-41` — "§88 measured ~902 … and this reproduces it". It measures 1116 now.
- `tests/integration/mcp-server.test.ts:366` — test title "points at the level tool" asserts retired behaviour as correct.

**DUST1.6** (12)

- `src/inference/persona-lane.ts:37-39`: "`coder-route.ts` now delegates to it rather than keeping a second copy". It does not (C-b)
- `src/inference/workers.ts:22-28`: "The `inference.worker_targets` map is retired". It is live and outranks personas (C-a). `:76` then says "The deprecated `workerTargets` map is checked first for backward compat", which contradicts the header in the same file
- `src/config/migrations.ts:156-159`: "kept as a deprecated leaf with a warning". No warning is emitted (P3)
- `src/inference/ollama-bootstrap.ts:4-5,11-12`: "`golem init` … never import this file" (it does, via the barrel) and "`drafter` is the only role any call site … ever invokes" (false; D26d/e)
- `src/cli/local-model.ts:4-5`: "level 3 auto-drafts / can answer locally". Auto-drafting was removed by Decision 31, and local answers are now Decision 33's extractive KB path, not level 3
- `src/inference/capability.ts:10-15`: tier comment ("P_MID ~8–16 GB") disagrees with spec §1/§2.2 (H2/R3). It is consistent with the code
- `src/inference/coder-route.ts:1-14,40-48,63`: framed around `inference.default_coder`, which was retired in R14.1. `CoderRouteError` messages already say `personas.coder.model`
- `src/cli/agents.ts:1-6`: "what the generated `golem-coder` subagent definition SAYS … Split from `init-agents.ts`". `init-agents.ts` no longer exists, and the module now renders every persona
- `src/cli/init-personas.ts:24-26`: "`.claude/agents/golem-scribe.md` was hand-authored … with no managed record" as a live fixture. It now **has** a ledger record (`managed-files.json:5`) and is generated (P1 `skip`), so the fixture no longer exists
- `src/inference/target-dispatcher.ts:22-27`: the four-step chain lists step 2 as `worker_targets[worker]` only. `personas[worker].model` also feeds step 2 now
- `src/inference/personas.ts:17-23`: "Which lane … is R14.2 … Guessing the lane before the resolution chain exists …". The chain exists (`persona-lane.ts`)
- `src/mcp/coder-tools.ts:156,173,492` (not owned, context): tool description still tells the model routing goes through `inference.worker_targets.coder`

**DUST1.7** (6)

- `src/cli/init-hooks.ts:227-228` — "autonomy gate (inert at the default `manual` level)"; false since D40/ADR-0002 note (outward/destructive gated at every level, and now denied at PermissionRequest).
- `src/hooks/pre-tool-use.ts:65-66` — "default true" (stale once the [main-wt] flip lands).
- `src/mcp/snooze-note.ts:5` — "Decision 45 made snooze enforcement the default" (same).
- `tests/unit/hooks/pre-tool-use.test.ts:103-104` — "Real default is now enforce=true (Decision 45)" (same).
- `src/hooks/guidance.ts:165` — DURABLE_TASKS "can auto-resume" vs D37.
- `src/tasks/plan-task.ts:25` — claims plan tasks are resumable; `task resume` does not read them.

**DUST1.8** (18)

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

**DUST1.9** (9)

- `src/cli/stats.ts:1-14` and `LIVE_STATS_NOTE` `:36-38` say durable history "starts when telemetry (task A4) lands". It has landed, since `collectWindowedStats` (`:134`) and `telemetryStatsSource` exist. The note text reaches users via D2.
- `src/cli/statusline.ts:6-7` says it shows "slider, upstream, cumulative savings". The slider is retired and savings are not rendered (`:499-501` says so itself).
- `src/cli/statusline.ts:236` says "Human-facing name for a slider level".
- `src/cli/session-report.ts:16` cites `getSliderInfo`, which no longer exists.
- `src/tui/state.ts:363-364` says "Slider level 0 is the passthrough bypass (Decision 30)". `:403` says "write `user` to the slider".
- `src/cli/context.ts:168` prints "Level 0 is a full bypass" to users.
- `src/config/control-surface.ts:20`, `src/config/control-surface-runtime.ts:4` name `setSliderLevel` (not owned src, cited for D50).
- `src/tui/header.ts:44-46` says bypass is "flagged in the header ... so it cannot be running unnoticed", but it is flagged only by colour (see D1).
- `src/telemetry/jsonl-store.ts:24-31,558` claim "never a wrong number", which is contradicted by D3/D4.

**DUST1.10** (12)

- `src/cli/init-team.ts:80` "Filled in by `team-layer-fetch` / `team-skills-sync`; absent until then": both shipped, and init passes a real sync (`init.ts:537`). `:163-164` "the thing that consumes it has not shipped yet": same.
- `src/cli/init.ts:552` "is reported by `teamInitStep` from the disposition": the function returns no disposition (`:575`).
- `src/hooks/host-gate.ts:108-110` and `src/session/host-gate.ts:101-103`: "no device transport (R13.5) and no chat surface (R13.6) yet". Both are done.
- `src/session/chat-page.ts:22-25` "Gate-map item 3 is LOCKED (Decision 59(a))": Decision 61 made it a setting (not yet built). `:37-38` "R13.6 only ever renders `hosted`": R13.7 renders `joined`.
- `src/session/host.ts:21-25` and `src/cli/commands/session-host.ts:134` cite "invariant 8" for "no exemption"; the ADR numbers it 7.
- `src/session/host-log.ts:22-23` "bounded by line count so a long-lived session cannot fill a disk": the trim is never called.
- `src/session/session-bus.ts:111` "Reconnect with Last-Event-ID to resume — nothing was lost": false given `transport.ts:234` (D5).
- `src/buzz/acp-agent.ts:66-76` "a cancelled turn posts no stale reply": true, but it also silences the next turn (D7).
- `src/buzz/identity.ts:98-100` "labelled `pub`/`sec` lines win when present": they never win (D2).
- `src/buzz/limit-guard.ts:38` credits the retry-math move to "R14.5", and commit `1e84c45` says the same; the R14.5 task doc is Tier C. Task-id collision.
- `src/buzz/provision.ts:242` and `src/buzz/harness-definition.ts:10-11` name `golem buzz provision --rotate` and `golem buzz install-harness`. Neither exists (forward references to R14.2).
- `src/session/conversation-store.ts:8` "continuation (R13.8)" and Wiki Conversation Store's "Consumers queued: R13.3, R13.5": those two shipped without consuming the store.

**DUST1.11** (17)

- `src/cli/commands/proxy.ts:4-6` says "all other proxy subcommands are removed"; six are registered (:451-651).
- `proxy.ts:118-121`: SessionStart uses its own copy (`prompt-guidance.ts:355-383`), not `ensureProxyRunning`.
- `proxy.ts:214`: "`golem proxy run`" does not exist.
- `prompt-guidance.ts:355-356` ("restart it") is superseded by :368-376 (no restart when `stopped`).
- `init-uninit.ts:80-85` says the restart "is not optional"; the printed notice (:96-99) says it "takes effect right away".
- `target.ts:154` says "nothing routes on it yet"; routing has landed (`mcp-serve.ts:108-137`).
- `select-target.ts:23-26` claims one port resolver; `proxy.ts:72` has another.
- `ps.ts:5` cites a test that does not exist. `ps.ts:17` "never infer death from age" vs age-based pruning at :714-717. `ps.ts:334-343` calls a scan dead that `collectProxies` still uses (:290-304).
- `team.ts:4-7` "three subcommands and no more": there are six, and the file does binding and layer fetch. `team.ts:75-82`: the `BindOutcome` doc comment sits on `LinkOptions`. `team.ts:447` hardcodes "(OS keychain)" despite the file fallback.
- `pkg-models.ts:6` calls `golem plugin` "future" (it shipped, R8.11).
- `session.ts:1-7` describes only tree and forget.
- `gateway.ts:229` typo `KEPT'—`.
- **For DUST1.1** (pipeline/proxy): `src/pipeline/pipeline.ts:20` says "slider ≥2" and `:209` says "slider ≥3" for the same stage (code: ≥2); `:287` says `slider.level`. `src/cli/proxy-daemon.ts:456` is the injection-marker half of the SessionStart credential bug.
- **HR** **For DUST1.3** (compression): `src/compression/headroom-adapter.ts:8` "slider ≥3". `src/knowledge/driver.ts:137` "swap for LanceDB" contradicts `file-driver.ts:4-15`, which made the JSONL driver the default (also DUST1.4). `semanticCache` has no consumer (row 25).
- **For DUST1.8** (config): `src/config/control-surface-types.ts:205-210` dead `coerceLevel`. `src/config/schema.ts:930` nested `golem-team/` path. `src/config/control-surface-runtime.ts:184` has the same `startDetached(…{}…)` pattern. `docs/wiki/concepts/Configuration Surfaces.md:52` says `proxy.active_account`. `src/update/index.ts:22` / `install/*` use `golem-run`.
- **For DUST1.9** (status/UI): `src/cli/statusline.ts:7,236` "slider". `vscode-extension/package.json:50` `golem.setAccount`. `docs/golem-spec.md:244` `golem replay-eval`.
- **For DUST1.10** (Buzz): `Buzz Integration.md:284,380,470` name `golem buzz …` commands that do not exist.

## Contradictions for the human

Collected from all eleven notes, de-duplicated and **not resolved**. The sources are in brackets,
as partition plus item number in that note's own Contradictions section.

### Redaction, security and permissions

- **R1. Fail-open vs the redaction hard rule.** The code and a test treat forwarding the original
  body on a pipeline error as correct, while CLAUDE.md says redaction is never weakened. [1.1 #1]
- **R2. Does `x-golem-bypass` survive ADR-0004?** It is a per-request, unpersisted, unsurfaced
  redaction-off header, and the skill presents it as the mildest option. [1.1 #2]
- **R3. The `/__golem/pipeline/false` admin endpoint** has no auth, no Origin check and no
  persistence, and no status surface can see it. Should it exist? [1.1 #3]
- **R4. What "CLI-only" means for `bypass_all`.** No MCP tool can set it, but an agent's Bash tool
  can run `golem off` or `curl` the endpoint, while the skill tells the model that "no tool call
  can turn redaction off". [1.1 #4]
- **R5. ADR-0005 "Yes, structurally"** (a plugin cannot weaken the built-ins) against an exported,
  mutable `REDACTION_RULES` and the ADR's own admission of full process authority. [1.1 #8]
- **R6. Plugin rules are absent from hook, vibe and join-queue redaction.** Intended? ADR-0005
  names only the proxy and the MCP server. [1.1 #9]
- **R7. Vibe redaction scope.** The guide says every byte is redacted, but `sources.json` and
  `candidates.jsonl` are not. Widen the redaction or narrow the claim. [1.8 #7]
- **R8. ADR-0002 "ask → human" vs the R12.12 hard deny.** Default init denies every
  outward/destructive call at `PermissionRequest`, so the human is never offered the dialog. Should
  the deny be conditional on a connected relay channel? [1.7 #2]
- **R9. Does `owner: user` bind the worker lane?** The wiki and `persona-lane` say nothing may
  dispatch it, while `workerTargetFromPersona` deliberately ignores the permission axis. [1.6 C2]
- **R10. ADR-0003 invariant 4 vs R9.3/R10.8.** The MCP server resolves every stored key, `coder`
  lets the model pick a target, and `buzz/` and `portal/` import credentials. Amend the ADR, or
  narrow the code. [1.2 C2]
- **R11. D47 "exporting configures nothing" vs D47 "`??=` so the parent's value wins".** Both
  cannot hold in a foreground `golem proxy run`. [1.2 C3]
- **R12. "No tool call can change pipeline depth".** Does a control-surface or remote panel write
  of `compression.level` count? [1.3 #5]

### Compression and byte-faithfulness

- **C1. Is level 1 "byte-faithful"?** Compression.md, Compression Levels, spec §4, `dials.ts`,
  `policy.ts:19` and CLAUDE.md say yes. Level-1 dedup replaces spans with markers, compaction
  strips whitespace, and any rewrite re-serialises the whole body. The code guarantees
  reversibility and prefix stability. Either the docs mean "lossless/prefix-stable", or
  dedup/compaction belong above level 1. [1.1 #6, 1.3 #1]
- **C2. The shim: D56(c) "no compression" vs `SHIM_POLICY = policyFor(1)`.** The banner and three
  comments side with D56. [1.1 #5]
- **C3. The CCR swap ignores `compression.level`**, firing even at `off`. Dial-independent by
  design, or should `off` stop it? [1.3 #2]
- **C4. Semantic-stage reversibility.** "Everything lossy is reversible" vs Headroom stale-turn
  drops, which leave no marker. [1.3 #6]
- **C5. The level-2 note omits the sidecar requirement** that the level-3 note states, although
  both degrade identically. [1.3 #7]
- **C6. The static Headroom-config check vs the D57 `router` namespace.** Flagged by 1.3 as a
  defect in the "warned wrongly" direction. [1.3 #4]

### Architecture, spec and positioning

- **A1. The npm package name**: `@pliable/golem` in `package.json` vs `golem-run` everywhere else,
  with publish now unconditional. See S1. [1.1 #7, 1.8 #1, 1.11 #1]
- **A2. "Single process, two doors"** vs two processes in the code (daemon + `mcp serve`). Is "one
  engine" meant logically or literally? [1.1 #10, 1.11 #4; DUST1.5 classifies the same claim M,
  see X1]
- **A3. Spec §1 identity** ("agentic developer assistant layer for Claude") vs Decision 32's
  universal pre-LLM processor. [1.11 #3]
- **A4. The non-goal "cloud-hosted deployment" vs the paid hosted team tier (Decision 64).**
  [1.11 #5]
- **A5. Decision 36's R5/R6 hold vs R6 shipping** a week later with no recorded lift. [1.11 #2]
- **A6. Spec §5 dashboard scope.** Cache hit rate and cost live on `stats --cache` and `bench
  cost`. Per-device utilization, canary quality-delta and `replay-eval` have no code and no task.
  Rewrite §5, or file tasks? [1.9 #4]
- **A7. Decisions 50(a)/(b)/(c) and 51(d)** still describe the retired slider surfaces, and only
  D50(d) is marked superseded. [1.9 #5]
- **A8. The D51(f) "one release" window** for `golem ui`/`golem settings` has run four minor
  versions. Drop it, or amend D51. [1.9 #3]
- **A9. Hardware tier thresholds.** Spec §1 (8 / 12–16 / 24 GB), spec §2.2 (6 / 12 / 24 GB) and
  code (`<8 / 8–16 / >16` GiB) all differ. [1.6 C5]
- **A10. `golem ollama setup` readiness.** Pull every live role, or narrow the "single live model"
  promise? [1.6 C6]
- **A11. The local-answer default.** Code and the distributed rule say ON. Architecture and README
  say opt-in. Decision 7's "never a global default" property was lost in its successor. [1.11 #7,
  1.6 C4]
- **A12. D33 "wiki/spec/root docs" vs `isProseSource`,** which accepts any markdown outside
  `docs/plan/`. [1.4 #6]

### Config, team layer and control surface

- **G1. `inference.worker_targets`: live, deprecated, or retired?** The schema and the readers say
  live, `RETIRED_SETTINGS` says it raises, a test comment says it warns, and routing gives it the
  highest precedence. [1.6 C1, 1.8 #4]
- **G2. The team failure rule vs loader strictness.** ADR-0008 promises a team link never stops the
  proxy, but an invalid team value does. [1.8 #2]
- **G3. The team origin on the control surface and in every load.** `status` loads it, while
  `config`, the TUI, VS Code, hooks, MCP and the hot-reload do not. Decide where team policy must
  apply. [1.8 #3, 1.10 D4]
- **G4. One row per key, or both?** The CS `ownedBy` invariant vs the shipped duplicate
  runtime/setting rows. [1.8 #5; also X9]
- **G5. The panel's default write scope** is `project`, while D58(f) makes the CLI default
  `local`. [1.8 #6]

### Providers and gateways

- **V1. Keyless gateways on the `gateway` surface.** R10.8/R13.13 say no credential is correct for
  `ollama`/`llamacpp`, but `gateway use` refuses them and `list` shows `key MISSING`, and tests pin
  both. [1.2 C1]
- **V2. "Fail closed" on an unknown default target** holds only with more than one target. With a
  single target the config falls back with a warning. [1.2 C4]
- **V3. Model-name gateway selection** is promised by the `resolveDefaultTargetId` doc and not
  implemented. Implement it (and revive `resolveModel`), or drop the claim. [1.2 C5]

### MCP surface

- **M1. The `coder` schema vs its result.** Widen `outputSchema` (the code's intent) or drop the
  keys. [1.5 #1]
- **M2. The frozen prompt set vs the retired slider.** Keep the `slider` prompt as a contract and
  rewrite it, or remove it? [1.5 #2]
- **M3. The `wiki_upsert` description says "committed to git",** but the store only writes files.
  [1.5 #3]
- **M4. Decision 34's status** is PROPOSED in the log while the feature ships, default-off.
  [1.5 #4]
- **M5. Tool Search figures:** ~902 description tokens on the page, 1116 live, and A/B tables
  measured on a different tool set. Re-measure, or date-stamp? [1.5 #5]
- **M6. The CLAUDE.md MCP tool list** reads as exhaustive but covers 6 of the 11 tools. [1.5 #6]
- **M7. Managed Tools says "5 runtime deps" and "exact pins",** but `package.json` has 6 deps and
  `web-tree-sitter` is a caret range. [1.5 #7]

### Knowledge base and wiki

- **K1. ADR-0001 (accepted, `fs.watch`) vs the polling watcher.** This needs a superseding ADR.
  [1.4 #1]
- **K2. The federated title collision.** The docs say the project page wins, while graph-first
  search lets the user page win. [1.4 #2]
- **K3. The Decision 29 "dated separator"** vs a bare `---`, across four surfaces. [1.4 #3]
- **K4. Decision 17 says Qdrant server is "fully supported via config URL",** but no code reads
  the key. [1.4 #4]
- **K5. The Web Cache page says the green path was "declined",** but it shipped in R9.12/R9.19.
  [1.4 #5]
- **K6. The Wiki-First and Distillation pages teach the plan-gate** that Decisions 44 and 54
  removed. Should promote's TTY consent go too? [1.4 #7]
- **K7. Web Cache freshness.** The page says `max-age`/`Expires` makes an entry fresh, but the
  code ignores both unless revalidation is on. [1.4 #8]
- **K8. Spec §3.1 is still the Qdrant, chunks-primary design** that Decision 28 inverted. [1.4 #9]

### Hooks, snooze and plan tasks

- **H1. The snooze defaults flip is half-landed.** The USER decision of 2026-09-25 exists only as
  uncommitted edits in the main checkout. Spec D45, two wiki pages and
  `tests/integration/cli-status.test.ts:711-723` still say default **true**, and that test will
  fail once the flip is committed. D45 needs a superseding note. [1.7 #1, 1.8 Unverifiable]
- **H2. Is `blocked` a state or metadata?** `TASK_STATES` and the README say state. D55(d) and the
  wiki say metadata. [1.7 #3]
- **H3. `size: XS` in 4 task docs.** Fix the docs, or widen the enum? [1.7 #4]
- **H4. Task-ID reuse.** R14.2–R14.5 and R5.1 each mean two different pieces of work, and the task
  states of R14.2/R14.3 lag the code in `development`. [1.6 C3, 1.10 C6, 1.11 #6]

### Portal, team and sessions

- **P1. ADR-0007 contradicts itself on the runner.** §3a says multi-turn stream-json is verified.
  Revision 2 says "do not attempt". `host.ts` follows §3a. [1.10 C1]
- **P2. Invariant numbering.** The wiki and `host.ts` say 8, the ADR says 7. [1.10 C2]
- **P3. Does Decision 61 reach hosted sessions?** Decision 60(d) says no setting changes that.
  [1.10 C3]
- **P4. Does `security.*` belong on `REMOTE_DENIED_SETTINGS`?** See S17. [1.10 C4]
- **P5. The `team.portal_url` design vs the token exfiltration.** Bind the token to an origin,
  refuse a mismatched origin, or drop the key. See S4. [1.10 C5]
- **P6. Two policies for an edited team skill.** Portal removal keeps it, while `unlink` runs
  `rm -rf`. [1.10 C7]
- **P7. ADR-0006 was never amended** for what superseded §2, §3a, §4, §7 and §8. [1.10 C8]

### Telemetry and observability

- **T1. What does `requests` count?** Only rewritten requests, while every label reads as all
  proxied traffic. [1.9 #1]
- **T2. Should the savings figures say "estimated"?** They are chars/4 estimates, presented as
  measured. [1.9 #2]

### Conflicting classifications across partitions

When two partitions classified the same claim differently, both classes stand, as the brief
requires:

| id | group | classes | what differs |
|---|---|---|---|
| X1 | G03 "single process, two doors" | 1.1 D, 1.11 D, **1.5 M** | 1.5 judged the transport claim. 1.1 and 1.11 judged "one process" |
| X2 | G08 `worker_targets` retirement | 1.6 D, 1.8 P | the same defect, framed as drift (1.6) vs a partial retirement mechanism (1.8) |
| X3 | G10 skills layout | 1.7 D ×1 / X ×1, 1.8 X, 1.11 D ×2 | whether the spec's nested-layout claim is stale or superseded |
| X4 | G14 test-run failure digest | 1.5 P, 1.11 N | 1.5 counts the PostToolUse head/tail swap as partial coverage |
| X5 | G18 3-OS CI | 1.8 P, 1.11 D | macOS advisory, read as incomplete vs drifted |
| X6 | G19 tree-sitter | 1.1 P, 1.4 M | optional add-on vs "(opt)" in the KB page |
| X7 | G21 hub↔worker mTLS | 1.6 N, 1.11 P | 1.11 credits the device-surface mTLS |
| X8 | G23 release asserts every asset | 1.8 P, 1.10 M | 1.8 found `SHA256SUMS` and `.tgz` missing from the asserted list |
| X9 | G26 `ownedBy` | 1.8 D, 1.9 X | a live-but-unused mechanism vs dead |
| X10 | G28 stable control ids | 1.8 M, 1.9 D | 1.9 counts `runtime:slider` → `runtime:compression` as contract drift |
| X11 | G34 bare `golem` panel | 1.8 D, 1.9 M | 1.8 flags the wiki's file locations (`parsePanelArgs` in `panel-args.ts`) |
| X12 | G24 Headroom as a library | 1.3 D, 1.11 M | library mode (1.3) vs adapter-plus-pin (1.11) |

(G17 is not a conflict: DUST1.1 deferred its row to DUST1.4, which classified it D.)

## Appendix: merged classification table

Every row of every note appears here exactly once. It is listed under its own partition, except that a duplicate group (`G01`–`G38`) is rendered once, at its first member, with all member refs in the ref cell. A conflicting group shows each member's class. The full evidence, test and note columns are in the source notes, which you can find by ref and partition.

#### DUST1.1

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.1/r001 | Wiki — `concepts/Redaction Stage.md` | One ordered rule table | D | none | |
| 1.1/r002 | Wiki — `concepts/Redaction Stage.md` | PEM blocks first | M | — | |
| 1.1/r003 | Wiki — `concepts/Redaction Stage.md` | `sk-ant-` before `sk-` | M | — | |
| 1.1/r004 | Wiki — `concepts/Redaction Stage.md` | Entropy backstop 32-128 chars, 4.2 bits | M | — | |
| 1.1/r005 | Wiki — `concepts/Redaction Stage.md` | Pure-hex and 2-of-3-class exclusions | D | none | |
| 1.1/r006 | Wiki — `concepts/Redaction Stage.md` | Pure function: no clock, randomness or **config** | D | none | |
| 1.1/r007 | Wiki — `concepts/Redaction Stage.md` | Idempotent: placeholder charset matched by no rule | D | none | |
| 1.1/r008 | Wiki — `concepts/Redaction Stage.md` | Stage 1, never reordered; `bypass_all` the single exception | D | none | |
| 1.1/r009 | Wiki — `concepts/Redaction Stage.md` | §31 integrity-hash exclusion | M | — | |
| 1.1/r010 | Wiki — `concepts/Redaction Stage.md` | §37 128-char ceiling | M | — | |
| 1.1/r011 | Wiki — `concepts/Redaction Stage.md` | §49 path-like tokens | P | none | |
| 1.1/r012 | Wiki — `concepts/Redaction Stage.md` | "Open, not yet fixed" credit-card item | X | none | |
| 1.1/r013 | Wiki — `concepts/Redaction Stage.md` | §50/§55 separator/grouping guard | M | — | |
| 1.1/r014 | Wiki — `concepts/Redaction Stage.md` | §24/§56 four provider rules | M | — | |
| 1.1/r015 | Wiki — `concepts/Redaction Stage.md` | §140 hex chunks, 3-chunk floor | M | — | |
| 1.1/r016 | Wiki — `concepts/Redaction Stage.md` | Negative cases paired with positives | M | — | |
| 1.1/r017 | Wiki — `concepts/Redaction Path Placeholders.md` | Candidate charset / POSIX path is one token | M | — | |
| 1.1/r018 | Wiki — `concepts/Redaction Path Placeholders.md` | `\` breaks runs, so both spellings agree | M | — | |
| 1.1/r019 | Wiki — `concepts/Redaction Path Placeholders.md` | `redactStandaloneText` is one-way | M | — | |
| 1.1/r020 | Wiki — `concepts/Redaction Path Placeholders.md` | `redactReversibleText` used for remote `coder` | D | none | |
| 1.1/r021 | Wiki — `concepts/Redaction Path Placeholders.md` | Restoration map in memory only | M | — | |
| 1.1/r022 | Wiki — `concepts/Redaction Path Placeholders.md` | Placeholders look identical either way | M | — | |
| 1.1/r023 | Wiki — `concepts/Redaction Path Placeholders.md` | Write path byte-faithful; only the view corrupts | M | — | |
| 1.1/r024 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | No discovery; `load` default `[]` | M | — | |
| 1.1/r025 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | `plugins.enabled` kill switch, default true | M | — | |
| 1.1/r026 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Bare specifier resolved from project; no download | M | — | |
| 1.1/r027 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Built-ins first, plugin suffix, entropy last | M | — | |
| 1.1/r028 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | No remove/replace/reorder API; `REDACTION_RULES` never handed out | P | none | |
| 1.1/r029 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Namespaced kinds `<plugin>/<rule>`, charset-validated | M | — | |
| 1.1/r030 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Plugin rule sees placeholders, cannot un-redact | M | — | |
| 1.1/r031 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Register once; second refused | M | — | |
| 1.1/r032 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Plugin `validate` throw = not a secret | M | — | |
| 1.1/r033 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | `g` flag required | M | none | |
| 1.1/r034 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Stage runs after redaction and local-answer, before compression | M | — | |
| 1.1/r035 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Redaction re-runs over stage output | P | none | |
| 1.1/r036 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | `redaction-after-plugins` attributed separately | M | — | |
| 1.1/r037 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Stage throw: skipped, pre-stage body kept | P | none | |
| 1.1/r038 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | `setup()` throw discards all registrations | M | — | |
| 1.1/r039 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Every problem surfaced by `golem plugin` and counted | P | none | |
| 1.1/r040 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | `golem plugin`: read-only, no install verb, resolved path, no-sandbox notice | M | — | |
| 1.1/r041 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | "Same code path the proxy runs, so what you see here is what the proxy got" | D | none | |
| 1.1/r042 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Regex-hang risk named by `golem plugin` | N | none | |
| 1.1/r043 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Settings help states no sandbox | M | — | |
| 1.1/r044 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | MCP tool colliding with a built-in is rejected | M | — | |
| 1.1/r045 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Shim gets rules, not stages | M | — | |
| 1.1/r046 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Plugin rules protect an org's private format wherever Golem redacts | P | none | |
| 1.1/r047 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | No-plugin install is byte-identical | M | — | |
| 1.1/r048 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Prompt-cache stability: "Yes" | P | none | |
| 1.1/r049 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | R9.3 map is a closure local | M | — | |
| 1.1/r050 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Contract in non-frozen `src/plugins/types.ts` | M | — | |
| 1.1/r051 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | Declarative pattern-only rules (successor) | N | none | |
| 1.1/r052 | Wiki — `concepts/Plugin Seams.md` and ADR-0005 | WASM-compiled rules (successor) | N | none | |
| 1.1/r053<br>1.11/r011 (#11)<br>1.5/r001 | (merged) | **G03** Spec §2.1 "single process, two doors" | conflict: 1.1=D, 1.11=D, 1.5=M | none | G03 |
| 1.1/r054<br>1.1/r064<br>1.8/r064<br>1.11/r014 (#14)<br>1.11/r074 (#74)<br>1.11/r080 (#80)<br>1.8/r061<br>1.8/r058<br>1.8/r073 | (merged) | **G01** npm package is `golem-run` (actually `@pliable/golem` since 2fc7cd2) | D | R7.5, R7.5 (first publish) | G01 |
| 1.1/r055 | Spec §2.1 Integration surfaces (proxy half) | Init sets `ANTHROPIC_BASE_URL` | M | — | |
| 1.1/r056 | Spec §2.1 Integration surfaces (proxy half) | Proxy forwards to `api.anthropic.com` | M | — | |
| 1.1/r057 | Spec §2.1 Integration surfaces (proxy half) | Responses piped as raw bytes | M | — | |
| 1.1/r058<br>1.1/r059<br>1.5/r002<br>1.5/r003<br>1.11/r015 (#15) | (merged) | **G02** Spec §2.1 MCP tool names (`search_local`, `get_original` …) superseded by D27/D35 | X | none | G02 |
| 1.1/r060<br>1.11/r012 (#12) | (merged) | **G05** SDK surface (thin wrapper over the Anthropic SDK) | N | none | G05 |
| 1.1/r061<br>1.5/r004<br>1.11/r017 (#17) | (merged) | **G20** Skills orchestrate / tools execute layering contract | M | none | G20 |
| 1.1/r062 | Spec §6 Tech Stack | TypeScript, Node ≥ 22, ESM | M | — | |
| 1.1/r063 | Spec §6 Tech Stack | Fastify or equivalent HTTP layer | M | — | |
| 1.1/r065<br>1.11/r004 (#4) | (merged) | **G16** Semantic compression "at level 3" (code: ≥2) | D | none | G16 |
| 1.1/r066<br>1.4/r001 | (merged) | **G15** Vector DB Qdrant / LanceDB (spec §3.1, §6, Dec 3/17) | X | none | G15 |
| 1.1/r067 | Spec §6 Tech Stack | Embeddings ONNX/transformers.js CPU fallback | D | none | |
| 1.1/r068<br>1.11/r016 (#16) | (merged) | **G04** MCP over stdio + streamable HTTP | M | none | G04 |
| 1.1/r069 | Spec §6 Tech Stack | SQLite cache/metadata store | X | none | |
| 1.1/r070<br>1.4/r009 | (merged) | **G19** tree-sitter code parsing / chunking | conflict: 1.1=P, 1.4=M | none | G19 |
| 1.1/r071 | Decision 33 (local-answer, pipeline side) | Own settings leaves, not the slider | M | — | |
| 1.1/r072 | Decision 33 (local-answer, pipeline side) | Single-turn, role user, plain text | M | — | |
| 1.1/r073 | Decision 33 (local-answer, pipeline side) | Confidence floor 0.6 | M | — | |
| 1.1/r074 | Decision 33 (local-answer, pipeline side) | Visible "verify independently" label | M | — | |
| 1.1/r075 | Decision 33 (local-answer, pipeline side) | `respondDirectly` seam skips upstream | M | — | |
| 1.1/r076 | Decision 33 (local-answer, pipeline side) | Feature off → upstream called, bytes unchanged | M | — | |
| 1.1/r077 | Decision 33 (local-answer, pipeline side) | `avoidedUpstreamOutputTokens` telemetry | M | — | |
| 1.1/r078 | Decision 33 (local-answer, pipeline side) | Default ON | M | — | |
| 1.1/r079 | Decision 33 (local-answer, pipeline side) | Runs on the redacted body | M | — | |
| 1.1/r080 | Decision 33 (local-answer, pipeline side) | 2 s budget (R10.23) | D | none | |
| 1.1/r081<br>1.4/r090 | (merged) | **G17** Decision 33 KB half (`composeFromHits` / `isProseSource`) | conflict: 1.1=U, 1.4=D | none | G17 |
| 1.1/r082 | Decision 56 (stop = pipeline off) | `stop` keeps the port served by a shim | M | — | |
| 1.1/r083 | Decision 56 (stop = pipeline off) | `ProxyDesired` third state | D | none | |
| 1.1/r084 | Decision 56 (stop = pipeline off) | Shim redacts | M | — | |
| 1.1/r085 | Decision 56 (stop = pipeline off) | Shim: no compression, no brevity, no local-answer | D | none | |
| 1.1/r086 | Decision 56 (stop = pipeline off) | `wire` / `unwire` | M | — | |
| 1.1/r087 | Decision 56 (stop = pipeline off) | Ownership guard reused | M | — | |
| 1.1/r088 | Decision 56 (stop = pipeline off) | Shim never honours `bypass_all` | M | — | |
| 1.1/r089 | Decision 56 (stop = pipeline off) | Daemon log `.golem/proxy.log`, 1 MB (D57(e) spill-over) | M | — | |
| 1.1/r090 | ADR-0004 — the `proxy.bypass_all` claim | Persisted setting, default false | M | — | |
| 1.1/r091 | ADR-0004 — the `proxy.bypass_all` claim | `golem on`/`off` writes it (the toggle no longer forgets) | M | — | |
| 1.1/r092 | ADR-0004 — the `proxy.bypass_all` claim | CLI-only: a tool call cannot set it | P | none | |
| 1.1/r093 | ADR-0004 — the `proxy.bypass_all` claim | Surfaced loudly wherever active | P | none | |
| 1.1/r094 | ADR-0004 — the `proxy.bypass_all` claim | Only redaction-free path; every table row `redaction: true` | D | none | |
| 1.1/r095 | ADR-0004 — the `proxy.bypass_all` claim | "Unrepresentable" | P | none | |
| 1.1/r096 | CLAUDE.md hard rules (owned subset) | Redaction never weakened or reordered | D | none | |
| 1.1/r097 | CLAUDE.md hard rules (owned subset) | `bypass_all` single exception, CLI-only, loud | D | none | |
| 1.1/r098 | CLAUDE.md hard rules (owned subset) | Byte-faithful at compression ≤ 1, with recorded-shape tests | P | none | |
| 1.1/r099 | `src/interfaces/` conformance | `PipelinePolicy` / stage table | D | none | |
| 1.1/r100 | `src/interfaces/` conformance | `CompressionService` | M | — | |
| 1.1/r101 | `src/interfaces/` conformance | `BlobStore` | M | — | |
| 1.1/r102 | `src/interfaces/` conformance | `InferenceService` | M | — | |
| 1.1/r103 | `src/interfaces/` conformance | `KnowledgeBase` | M | — | |
| 1.1/r104 | `src/interfaces/` conformance | `LocalAnswerService` | M | — | |
| 1.1/r105 | `src/interfaces/` conformance | `WikiStore` / `WikiReader` | M | — | |
| 1.1/r106 | `src/interfaces/` conformance | `ConversationStore` (redact before disk) | P | none | |
| 1.1/r107 | `src/interfaces/` conformance | `JoinQueue` (redact on enqueue, atomic claim) | P | none | |
| 1.1/r108 | `src/interfaces/` conformance | `SessionEvent*` (seq, idempotent) | P | none | |

#### DUST1.2

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.2/r001 (#1) | Findings table | Golem fronts non-Anthropic gateways through per-provider adapters | M | — | |
| 1.2/r002 (#2) | Findings table | The Anthropic path stays byte-faithful; non-Anthropic adapters are a separate code path | D | none | |
| 1.2/r003 (#3) | Findings table | Target-model-friendly prompt translation (20g generalised) | N | none | |
| 1.2/r004 (#4) | Findings table | Cache alignment is per-provider | M | — | |
| 1.2/r005 (#5) | Findings table | Spec §2/§2.1: the hub forwards to `api.anthropic.com` | D | none | |
| 1.2/r006 (#6)<br>1.11/r027 (#27) | (merged) | **G37** Credentials in the OS keychain (D46 / §8) | M | none | G37 |
| 1.2/r007 (#7) | Findings table | `file` backend is never auto-selected for writes | M | none | |
| 1.2/r008 (#8) | Findings table | No native dependency: macOS `security`, Linux `secret-tool`, Windows DPAPI via a detected PowerShell host (`pwsh` first) with a real self-test | M | — | |
| 1.2/r009 (#9) | Findings table | Honest labels: DPAPI is never called "Credential Manager", a file is never called "encrypted" | M | — | |
| 1.2/r010 (#10) | Findings table | Secrets never go through argv | M | — | |
| 1.2/r011 (#11) | Findings table | CLI owns credentials; the detached daemon gets a minimal allowlist env (`buildSpawnEnv`) | M | — | |
| 1.2/r012 (#12) | Findings table | "Exporting the var by hand configures nothing"; `credentialEnvForProxy` never reads an ambient var | D | none | |
| 1.2/r013 (#13) | Findings table | `gateway login`: masked prompt → probe → store only if accepted; a rejected key is never stored; inconclusive stores with a warning | D | none | |
| 1.2/r014 (#14) | Findings table | Non-TTY `login` reads the key from stdin | D | none | |
| 1.2/r015 (#15) | Findings table | `use` preflight fails closed on an unresolvable credential; `--yes` overrides | D | none | |
| 1.2/r016 (#16) | Findings table | `list` shows key location and strength, never the value | D | none | |
| 1.2/r017 (#17) | Findings table | `account remove` logs out first (`forget` before the registry edit); `--keep-credential` | D | none | |
| 1.2/r018 (#18) | Findings table | Login/logout/switch/add/remove are audit-logged to `.golem/state/` | M | — | |
| 1.2/r019 (#19) | Findings table | Every *request* → (account, provider, reason) selection is appended to `.golem/state/` | P | none | |
| 1.2/r020 (#20) | Findings table | Invariant 4: no MCP/tool surface reads credentials or selects an account; `src/credentials/` is imported only by the CLI | D | none | |
| 1.2/r021 (#21) | Findings table | Invariant 1: secrets never on a settings/log surface | D | none | |
| 1.2/r022 (#22) | Findings table | No silent cross-account fallback | P | none | |
| 1.2/r023 (#23) | Findings table | No automated route-on-exhaustion / quota rotation | M | — | |
| 1.2/r024 (#24) | Findings table | Routing never silently swaps the model; the response reports the real serving model | M | — | |
| 1.2/r025 (#25) | Findings table | OpenRouter is translating (case b) | M | — | |
| 1.2/r026 (#26) | Findings table | `vendor/` prefix kept for multi-vendor gateways (`openrouter` only) | D | none | |
| 1.2/r027 (#27) | Findings table | Base-URL/route composition checked at config time (`upstreamRequestUrl`, `doubledVersionSegment`, `add` warns; chat-completions path tolerates a full endpoint URL) | M | — | |
| 1.2/r028 (#28) | Findings table | `--model` on a byte-faithful provider warns | D | none | |
| 1.2/r029 (#29) | Findings table | Probe reports the route it does not test (`requestUrl`, `configWarning` even on `accepted`); `login` prints "requests will go to" | M | — | |
| 1.2/r030 (#30) | Findings table | Proxy banner reports the resolved upstream | — (unverifiable here) | — | |
| 1.2/r031 (#31) | Findings table | Model ids displayed verbatim; `friendlyModelLabel`/`friendlyModelVersionLabel`/`localModelVersionLabel` deleted | M | — | |
| 1.2/r032 (#32) | Findings table | `golem models` prints ids verbatim | D | none | |
| 1.2/r033 (#33) | Findings table | `claude-cli` provider retired by R13.12, no live path left | N | R13.14 | |
| 1.2/r034 (#34) | Findings table | Account switching writes a non-secret selector | D | none | |

#### DUST1.3

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.3/r001 (#1) | Wiki — `concepts/Compression.md` | Lossless stage runs from level 1 | M | — | |
| 1.3/r002 (#2) | Wiki — `concepts/Compression.md` | Lossless stage "is byte-faithful — the model sees the same content, just packed" | D | none | |
| 1.3/r003 (#3) | Wiki — `concepts/Compression.md` | "cache-alignment" as a lossless stage | D | none | |
| 1.3/r004 (#4) | Wiki — `concepts/Compression.md` | Lossy semantic added at levels 2–3 | M | — | |
| 1.3/r005 (#5) | Wiki — `concepts/Compression.md` | Lossy stage net-negative on Anthropic, measured (§103 numbers) | M | — | |
| 1.3/r006 (#6) | Wiki — `concepts/Compression.md` | "The stages that pay are gated to engage only on non-caching upstreams" | M | — | |
| 1.3/r007 (#7) | Wiki — `concepts/Compression.md` | Implementation files: `native-lossless.ts` always-on, `headroom-adapter.ts` semantic | M | — | |
| 1.3/r008 (#8) | Wiki — `concepts/Compression.md` | CCR: oversized tool output stored under `.golem/ccr`, replaced by a digest with `hash=<id>`, expanded by the `expand` tool | M | none | |
| 1.3/r009 (#9) | Wiki — `concepts/Compression.md` | `.golem/ccr` rooted per project, a worktree resolves to the main checkout | M | — | |
| 1.3/r010 (#10) | Wiki — `concepts/Compression Levels.md` | Two dials only: `compression.level` off/1/2/3, `brevity.level` off/lite/full/ultra | M | — | |
| 1.3/r011 (#11) | Wiki — `concepts/Compression Levels.md` | CLI `golem compression 1` / `golem brevity full` | M | none | |
| 1.3/r012 (#12) | Wiki — `concepts/Compression Levels.md` | Dials take effect live, no restart | M | — | |
| 1.3/r013 (#13) | Wiki — `concepts/Compression Levels.md` | Level table (off = redaction only · 1 lossless · 2 stale-turn drop · 3 max) | M | — | |
| 1.3/r014 (#14) | Wiki — `concepts/Compression Levels.md` | Every level redacts; no row has `redaction: false` | M | — | |
| 1.3/r015 (#15) | Wiki — `concepts/Compression Levels.md` | Brevity appends a marker-fenced directive to `system` | M | — | |
| 1.3/r016 (#16) | Wiki — `concepts/Compression Levels.md` | Brevity profile descriptions (lite/full/ultra) | M | — | |
| 1.3/r017 (#17) | Wiki — `concepts/Compression Levels.md` | One shared safety tail: verbatim payloads, prose-only, progress-line carve-out | M | — | |
| 1.3/r018 (#18) | Wiki — `concepts/Compression Levels.md` | Directive-text change needs a rebuild and invalidates the cached prefix once | M | — | |
| 1.3/r019 (#19) | Wiki — `concepts/Compression Levels.md` | Set vs ran: a caching upstream degrades 2/3 to 1, and the surfaces say so | M | — | |
| 1.3/r020 (#20) | Wiki — `concepts/Compression Levels.md` | Retired: `level` MCP tool, `golem slider`, `auto` state | M | — | |
| 1.3/r021 (#21) | Wiki — `concepts/Compression Levels.md` | Slider-drift remainder: `src/dashboard/server.ts` still has `slider-level`/`slider-name` DOM ids | — (—) | R12.6 per page | |
| 1.3/r022 (#22) | Wiki — `concepts/CCR Ref Scope.md` | Hook write and `expand` read share one root via `resolveWorktreeRoot` | M | — | |
| 1.3/r023 (#23) | Wiki — `concepts/CCR Ref Scope.md` | `UnknownRefError` carries `location` + `reason: not-found \\| corrupt` | M | — | |
| 1.3/r024 (#24) | Wiki — `concepts/CCR Ref Scope.md` | No eviction/TTL anywhere in `CcrStore`/`LocalDirBlobStore` | M | none (page calls it "unopened") | |
| 1.3/r025 (#25) | Wiki — `concepts/CCR Ref Scope.md` | Marker format `hash=<64-hex>` unchanged | M | — | |
| 1.3/r026 (#26) | Wiki — `concepts/Cache Observability.md` | Observation happens after every compression stage, on the bytes forwarded | M | — | |
| 1.3/r027 (#27) | Wiki — `concepts/Cache Observability.md` | "level 0 is a full bypass" and so never observed | D | none | |
| 1.3/r028 (#28) | Wiki — `concepts/Cache Observability.md` | "compression 3" as this repo's setup for the 98.4% figure | — (—) | — | |
| 1.3/r029 (#29) | Wiki — `concepts/Cache Observability.md` | Related-link blurb: "Compression — why input-side compression pays ~0% on cached traffic" | M | — | |
| 1.3/r030 (#30) | Spec §1.1 / §1.2 | Golem depends on `headroom-ai` as its compression stage | X | none | |
| 1.3/r031 (#31)<br>1.11/r007 (#7) | (merged) | **G24** Spec §1.2 Headroom as a library behind an adapter | conflict: 1.3=D, 1.11=M | none | G24 |
| 1.3/r032 (#32) | Spec §1.1 / §1.2 | `CompressionService` interface isolates Headroom: `compress / retrieve / stats` | D | none | |
| 1.3/r033 (#33) | Spec §1.1 / §1.2 | Level 3 may route text compression to Golem's local LLM | X | — | |
| 1.3/r034 (#34) | Spec §1.1 / §1.2 | Unified MCP surface re-exports Headroom retrieve/stats/memory | P | none | |
| 1.3/r035 (#35) | Spec §1.1 / §1.2 | Headroom pin (v0.28.0 codebase evidence) | D | none | |
| 1.3/r036 (#36) | Spec §3.2 / §3.4 | Redaction pre-stage before compression | M | — | |
| 1.3/r037 (#37) | Spec §3.2 / §3.4 | `compression.level` gating maps to Headroom config per content type | P | none | |
| 1.3/r038 (#38) | Spec §3.2 / §3.4 | Semantic compression at `compression.level: 3` via Golem's tiered local LLM | X | — | |
| 1.3/r039 (#39) | Spec §3.2 / §3.4 | Originals reversible via `headroom_retrieve` / `get_original(ref)` | D | none | |
| 1.3/r040 (#40) | Spec §3.2 / §3.4 | Savings telemetry per stage | M | none | |
| 1.3/r041 (#41)<br>1.11/r009 (#9) | (merged) | **G07** Exact response cache / P-cpu "exact caching" | N | none | G07 |
| 1.3/r042 (#42)<br>1.11/r025 (#25) | (merged) | **G06** Semantic cache (`StageConfig.semanticCache` has no reader) | N | none | G06 |
| 1.3/r043 (#43) | Spec §3.2 / §3.4 | Tool-result cache with mtime invalidation | P | none | |
| 1.3/r044 (#44) | Spec §4 (incl. Quality guardrails) | Level table + "no level disables redaction" + bypass is `proxy.bypass_all` | M | — | |
| 1.3/r045 (#45) | Spec §4 (incl. Quality guardrails) | "Every lossy operation declares its gate", everything lossy is reversible | P | none | |
| 1.3/r046 (#46) | Spec §4 (incl. Quality guardrails) | Eval harness (replay per level, LLM judge, quality curves) | N | none (R2.6 is a live A/B on cost, not quality) | |
| 1.3/r047 (#47) | Spec §4 (incl. Quality guardrails) | Canary mode | N | none | |
| 1.3/r048 (#48) | Spec §4 (incl. Quality guardrails) | Per-request escape hatch `x-golem-bypass: true` | M | — | |
| 1.3/r049 (#D1) | Decisions | Build on headroom-ai, library mode behind `CompressionService` | X | — | |
| 1.3/r050 (#D8) | Decisions | MCP exposes the slider (`eol_set_slider`) | X | — | |
| 1.3/r051 (#D15) | Decisions | Headroom pin `headroom-ai[code]==0.28.0` | X | — | |
| 1.3/r052 (#D18) | Decisions | TS-native lossless P0 + optional Python sidecar; npm client becomes typed transport; fallback to Ollama with no Python | D | none | |
| 1.3/r053 (#D23) | Decisions | Compression is situational. Lossless stays, CCR stays, lossy gated | M | — | |
| 1.3/r054 (#D30) | Decisions | Four-level slider + level-0 full bypass | X | — | |
| 1.3/r055 (#D31) | Decisions | Pure compression dial; semantic gated off caching upstreams; `isCachingUpstream` | M | R2.6 (adjacent) | |
| 1.3/r056 (#D52) | Decisions | Brevity dial: system-only, marker-fenced, appended into last text block, stands down on Caveman, defaults `off`, `UsageByBrevity` rollup | M | — | |
| 1.3/r057 (#D57) | Decisions | Marker-free router default wherever semantic runs; router namespace; `lossless_only` alias → `lossless`; router restored each request; `/health.supported_router_config` | M | none | |
| 1.3/r058 (#A1) | ADR-0004 (excluding the `proxy.bypass_all` claim) | `slider.level` deleted; two dials, no `auto` | M | — | |
| 1.3/r059 (#A2) | ADR-0004 (excluding the `proxy.bypass_all` claim) | `compression.level: off` = redaction only | M | — | |
| 1.3/r060 (#A3) | ADR-0004 (excluding the `proxy.bypass_all` claim) | No dial value can disable redaction; `MIN_ACTIVE_COMPRESSION_LEVEL` clamp removed | M | — | |
| 1.3/r061 (#A4) | ADR-0004 (excluding the `proxy.bypass_all` claim) | Surfaces lost `golem slider`, `level` MCP tool, `level` in telemetry | M | — | |
| 1.3/r062 (#A5) | ADR-0004 (excluding the `proxy.bypass_all` claim) | "Set vs ran" survives via `resolveEffectiveCompression` | M | — | |
| 1.3/r063 (#A6) | ADR-0004 (excluding the `proxy.bypass_all` claim) | Verify: no tool call can change pipeline depth | M | — | |

#### DUST1.4

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.4/r002 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Qdrant **server** via config URL ("fully supported", Dec 17; Dec 12) | N | none | |
| 1.4/r003 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | One collection per project | M | none | |
| 1.4/r004 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Opt-in shared cross-project "knowledge" collection | N | none | |
| 1.4/r005<br>1.11/r008 (#8) | (merged) | **G25** `search_local` federates memory + knowledge (§1.2 / §3.1) | D | none | G25 |
| 1.4/r006 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Text-model vs code-model embeddings ("Embed per kind", KB page mermaid) | D | none | |
| 1.4/r007 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Lexical fallback when no semantic embedder ("degrade rather than crash") | M | none | |
| 1.4/r008 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | File-watcher daemons for chosen paths | P | none | |
| 1.4/r010 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Heading-aware doc chunking | M | none | |
| 1.4/r011 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | pdf/html extraction on ingest | M | none | |
| 1.4/r012 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | MCP tools `index_path`, `search_local(query,k,filter)`, `get_chunk(id)` | D | none | |
| 1.4/r013 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Dec 2: memory on Headroom's Qdrant; evaluate `--code-graph` | X | none | |
| 1.4/r014 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Dec 13: Headroom memory on its own backend, federated as a second store | M | none | |
| 1.4/r015 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Dec 17: LanceDB as the embedded engine (sqlite-vec fallback) | X | none | |
| 1.4/r016 | Spec §3.1 and the store Decisions (2, 3, 13, 17, 24) | Dec 24: proxy-side KB substitution, "design memo only; not built" | X | none | |
| 1.4/r017 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | `wiki_dir` setting, default `docs/wiki`, env `GOLEM_KNOWLEDGE_WIKI_DIR`, user wiki `~/.golem/wiki` | M | none | |
| 1.4/r018 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Graph-first lookup "title/**alias**/wikilink" | P | none | |
| 1.4/r019 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Redaction before storage on every wiki write | P | none | |
| 1.4/r020 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Wiki pages reach the index through the watcher ("wiki write → watcher → vector index") | N | none | |
| 1.4/r021 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | `upsertPage` appends under a **dated** `---` separator, union-merges tags/sources, bumps `updated` | D | none | |
| 1.4/r022 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Two tools, `wiki_read` / `wiki_upsert` | M | none | |
| 1.4/r023 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Plan-gated agent writes, "propose, get approval, then `wiki_upsert`" | X | none | |
| 1.4/r024 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Lazy webcache backfill: the pointer to an existing draft is added to the served content | M | none | |
| 1.4/r025 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Dec 44: de-gated authorship; ADRs live outside the wiki; `promote` refuses `adr`; scaffold has no `decisions/` | M | none | |
| 1.4/r026 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Dec 54: init writes only the allow rule and removes the legacy `wiki_upsert` ask rule | M | none | |
| 1.4/r027 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | WIKI.md zone 1 = `.golem/webcache`, `.golem/ccr` | D | none | |
| 1.4/r028 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | WIKI.md zone-2 directories | M | none | |
| 1.4/r029 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | "Author freely" (zone 2) | M | none | |
| 1.4/r030 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | ADRs outside the wiki at `docs/decisions/` | M | none | |
| 1.4/r031 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Required frontmatter and the page-type list | M | none | |
| 1.4/r032 | Wiki-first store and authoring (Decisions 28, 29, 44, 54; WIKI.md zones) | Every page carries at least one wikilink | M | none | |
| 1.4/r033 | Knowledge Base page and Wiki-First page: search path | FileVectorDriver default behind the `VectorDriver` seam | M | none | |
| 1.4/r034 | Knowledge Base page and Wiki-First page: search path | `canonicalProjectId`: Windows spelling fold and worktree → main checkout | M | none | |
| 1.4/r035 | Knowledge Base page and Wiki-First page: search path | `assembleHits` "in `src/mcp/server.ts`"; `graphFirstWikiHits` "(`src/mcp/server.ts`)" | D | none | |
| 1.4/r036 | Knowledge Base page and Wiki-First page: search path | Graph-first with no embedding call, vector search always runs, de-dupe by sourcePath, wiki boost, optional chat-judge rerank | M | none | |
| 1.4/r037 | Knowledge Base page and Wiki-First page: search path | Hits from every scope are merged, sorted by score, truncated to k | M | none | |
| 1.4/r038 | Knowledge Base page and Wiki-First page: search path | "Matches score above any vector hit, so a query that names a page … always surfaces that page first" | D | none | |
| 1.4/r039 | Knowledge Base page and Wiki-First page: search path | `fetch` returns the full text of any hit (`getChunk`) | P | none | |
| 1.4/r040 | Knowledge Base page and Wiki-First page: search path | `fetch` resolves `wiki:<relPath>` ids from the WikiStore | M | none | |
| 1.4/r041 | Knowledge Base page and Wiki-First page: search path | Falls back to vector-only when there is no WikiStore or `wikiDir` | M | none | |
| 1.4/r042 | Knowledge Base page and Wiki-First page: search path | Zone 1 → 2 capture: `golem note` and WebFetch redact, then store | M | none | |
| 1.4/r043 | Knowledge Base page and Wiki-First page: search path | Promote is human-gated and only calls `wiki_upsert` on approval (Dec 29) | X | none | |
| 1.4/r044 | Knowledge Base page and Wiki-First page: search path | User-scope wiki at `~/.golem/wiki`, `golem wiki init --user` | M | none | |
| 1.4/r045 | Knowledge Base page and Wiki-First page: search path | `FederatedWikiReader`: `user:` prefix, and "a title collision favors the project page" | D | none | |
| 1.4/r046 | Knowledge Base page and Wiki-First page: search path | `backlinks` computed over the merged set | M | none | |
| 1.4/r047 | Knowledge Base page and Wiki-First page: search path | Writes are never federated; `wikiSearch` defaults to the project wiki | M | none | |
| 1.4/r048 | Knowledge Base page and Wiki-First page: search path | `knowledge.user_wiki_enabled` defaults to true | M | none | |
| 1.4/r049 | Distillation Pipeline page | `golem note`: pipelineRedact + stripKnownSecrets, `notes.jsonl`, `list` newest first | M | none | |
| 1.4/r050 | Distillation Pipeline page | `distillPage`: summarizer role, strict JSON, wikilinks canonicalised to real titles, `DistillParseError` | M | none | |
| 1.4/r051 | Distillation Pipeline page | Drafts keyed by slug, so "distilling the same URL again overwrites its prior draft" | D | none | |
| 1.4/r052 | Distillation Pipeline page | `golem wiki distill <url>`: prefers an existing draft unless `--force`; clear errors; `--pending` | M | none | |
| 1.4/r053 | Distillation Pipeline page | The lazy pointer runs in its own try/catch | M | none | |
| 1.4/r054 | Distillation Pipeline page | `/golem-wiki-ingest` runs `golem wiki distill` first | M | none | |
| 1.4/r055 | Distillation Pipeline page | `distillNote`: question/artifact, `note:<ts>` source, `findDraftByNoteTs`, `golem note distill [ts]` | M | none | |
| 1.4/r056 | Distillation Pipeline page | `synthesizeWeekly`: debriefs + notes, `--days` default 7, clear error when empty | M | none | |
| 1.4/r057 | Distillation Pipeline page | Stage 3 "plan-gated, unchanged" | X | none | |
| 1.4/r058 | Distillation Pipeline page | `golem wiki promote --list` / `<id> [--yes]`, "dated separator" append, draft removed, non-TTY refused | D | none | |
| 1.4/r059 | Web Cache page and Decision 42 | Content-addressed store under `.golem/webcache`, keyed by sha256(url) | M | none | |
| 1.4/r060 | Web Cache page and Decision 42 | PreToolUse fetch-cache-serve; redact before store; fail-open | M | none | |
| 1.4/r061 | Web Cache page and Decision 42 | Default TTL 168h; raw mode on by default | M | none | |
| 1.4/r062 | Web Cache page and Decision 42 | Pages over ~8k are truncated inline and given a CCR `hash=` ref | M | none | |
| 1.4/r063 | Web Cache page and Decision 42 | PostToolUse caches nothing in raw mode and captures the answer in legacy mode | M | none | |
| 1.4/r064 | Web Cache page and Decision 42 | A served page renders RED; the green alternative was "tested and **declined**" | D | none | |
| 1.4/r065 | Web Cache page and Decision 42 | Fresh within TTL **or** an explicit `max-age`/`Expires`; 304 → updateMeta; `no-store` or a changed 200 drops the entry | P | none | |
| 1.4/r066 | Web Cache page and Decision 42 | Conditional revalidation is opt-in | M | none | |
| 1.4/r067 | Web Cache page and Decision 42 | Fetched pages are also ingested into the KB, "so a re-fetch of a known URL is free and offline" and `search` finds them | P | none | |
| 1.4/r068 | Web Cache page and Decision 42 | Dec 42 "15 s `AbortSignal.timeout`" | D | none | |
| 1.4/r069 | Auto-Index Cost page | `mcp serve` calls `ensureProjectIndexed` fire-and-forget; `golem index` makes the same call | M | none | |
| 1.4/r070 | Auto-Index Cost page | Checkpoint every 20 files, deletions first; "a killed run keeps finished batches" | P | none | |
| 1.4/r071 | Auto-Index Cost page | `auto_index_max_files` default 50, `0` uncapped, passed only by `mcp serve`, not applied to the first build | M | none | |
| 1.4/r072 | Auto-Index Cost page | Collection dir is sha256(canonical)[0..16]; separators folded only for Windows paths | M | none | |
| 1.4/r073 | Auto-Index Cost page | "see `planBuildEmbedder`'s notices in [[Knowledge Base]]" | D | none | |
| 1.4/r074 | Repo Map page | `extractFileFacts` in `tree-sitter-chunker.ts` is the only `web-tree-sitter` toucher | M | none | |
| 1.4/r075 | Repo Map page | Import edges `./x.js` → `x.ts`; reference edges weighted `sqrt`; only exported non-member definitions | M | none | |
| 1.4/r076 | Repo Map page | Personalised PageRank; lower damping when steered; word-part affinity weighted by rarity | M | none | |
| 1.4/r077 | Repo Map page | Budget, per-file cap, drops stated in a footer | M | none | |
| 1.4/r078 | Repo Map page | Byte-stable: no clock, no randomness | M | none | |
| 1.4/r079 | Repo Map page | `code` is one tool with a `mode`; `repo_map_enabled` gates registration; `read_skeleton_enabled` | M | none | |
| 1.4/r080 | Repo Map page | Degrades to "no repo map available" when tree-sitter is absent | M | none | |
| 1.4/r081 | Repo Map page | `golem bench map [--score]` over 22 hand-labelled cases | M | none | |
| 1.4/r082 | LSP Bridge page | Four modes on `code`, added to the schema only when the bridge is injected | M | none | |
| 1.4/r083 | LSP Bridge page | 1-based line/character in and out | M | none | |
| 1.4/r084 | LSP Bridge page | `PATH`/`PATHEXT` resolution, argument arrays, never a shell; failure → `available:false` | M | none | |
| 1.4/r085 | LSP Bridge page | Lazy spawn, pooled per server, idle eviction, bounded waits, synchronous kill on exit | M | none | |
| 1.4/r086 | LSP Bridge page | `lsp_enabled` needs `repo_map_enabled`; `lsp_timeout_ms` 15,000; `lsp_servers` rows | M | none | |
| 1.4/r087 | LSP Bridge page | Only the TypeScript row is built in | M | none | |
| 1.4/r088 | LSP Bridge page | Page sources `src/ext/lsp/`, `src/ext/manifest.ts` | D | none | |
| 1.4/r089 | ADR-0001 and Decision 33 (KB half) | Backend: `fs.watch` recursive on Windows and macOS, a per-directory watch on Linux, chokidar as fallback | D | none | |

#### DUST1.5

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.5/r005 | Classification table | Hook enforcement keys on tool names (`PARK_EXEMPT_TOOLS`) | M | — | |
| 1.5/r006 | Classification table | `wiki_upsert` as a tool carries its own allow/deny | M | — | |
| 1.5/r007 | Classification table | R9.11 fixed the uninstrumented tools, so demotion is answerable "next time, on numbers" | P | none | |
| 1.5/r008 | Classification table | `/golem-research` climbs `wiki_read` → `search` → `fetch` | M | — | |
| 1.5/r009<br>1.5/r012<br>1.11/r021 (#21) | (merged) | **G13** Media pre-processing (Whisper/OCR) and speculative prefetch | N | none | G13 |
| 1.5/r010<br>1.11/r020 (#20) | (merged) | **G14** Local test running → failure digest | conflict: 1.5=P, 1.11=N | none | G14 |
| 1.5/r011 | Classification table | §3.5 git-aware context (diff summaries, commit-history summarisation) | N | none | |
| 1.5/r013 | Classification table | §3.5 artifact/output storage by reference | M | — | |
| 1.5/r014 | Classification table | §3.5 session memory via local vector DB | P | none | |
| 1.5/r015 | Classification table | §3.5 Batch-API off-peak queueing | N | none | |
| 1.5/r016 | Classification table | D27: `golem_` prefix dropped, names shortened to bare verbs | M | — | |
| 1.5/r017 | Classification table | D27: "the 7 MCP tool registration names in `src/mcp/server.ts`" | D | none | |
| 1.5/r018 | Classification table | D27: `golem_set_slider` → `level` | X | none | |
| 1.5/r019 | Classification table | D27: `golem_devices` "keeps its current name" | X | none | |
| 1.5/r020 | Classification table | Spec l.331 frozen-names list | D | none | |
| 1.5/r021 | Classification table | D34: chat-judge rerank over frozen `InferenceService.chat`, `rerankHits(inference, query, hits)` | M | — | |
| 1.5/r022 | Classification table | D34: `knowledge.rerank_enabled`, default `false` | M | — | |
| 1.5/r023 | Classification table | D34: additive `GolemMcpServerDeps.rerank?` | M | — | |
| 1.5/r024 | Classification table | D34: rerank failure falls back to pre-rerank order | M | — | |
| 1.5/r025 | Classification table | D34: "`boostWikiHits` (`src/mcp/server.ts`)" | D | none | |
| 1.5/r026 | Classification table | D34 status "PROPOSED, implementing now behind the opt-in flag" | D | none | |
| 1.5/r027 | Classification table | D35: `delegate` → `coder` rename | M | — | |
| 1.5/r028 | Classification table | D35: "No behavior change: same `inference.chat("drafter", …)` call" (local model) | X | none | |
| 1.5/r029 | Classification table | `coder` structured result matches its `outputSchema` | D | none | |
| 1.5/r030 | Classification table | D53(a/b): tier-1 runtime deps "deliberately tiny — 5" | D | none | |
| 1.5/r031 | Classification table | D53 / Managed Tools invariant 3: "Exact pins" | D | none | |
| 1.5/r032 | Classification table | D53(d): `caveman-shrink` follow-up = point `golem bench tools` at their implementation | M | — | |
| 1.5/r033 | Classification table | Managed Tools: `/caveman-compress` and `caveman-shrink` "are tracked as follow-ups" | D | none | |
| 1.5/r034 | Classification table | D53(g): the surface is `golem ext`, not `golem tools`; `src/tools/` is the bench harness | D | none | |
| 1.5/r035 | Classification table | Managed Tools: "R10.1 renamed … to `golem pkg`, keeping `ext` as an alias" | D | none | |
| 1.5/r036 | Classification table | D53(j): `BUILTIN_MCP_TOOL_NAMES` with two-way drift test | M | — | |
| 1.5/r037 | Classification table | Managed Tools: spawn-free, `PATHEXT`-aware detection | M | — | |
| 1.5/r038 | Classification table | Managed Tools: rows carry a `gate` note instead of "running" | M | — | |
| 1.5/r039 | Classification table | Managed Tools: `planPkgAction` pure; recipes only for `caveman` and `typescript-language-server` | M | — | |
| 1.5/r040 | Classification table | Managed Tools: `upgrade: "reinstall"` / `playbook` rows refuse upgrade | M | — | |
| 1.5/r041 | Classification table | Managed Tools: `installed_plugins.json` is the authority | M | — | |
| 1.5/r042 | Classification table | Managed Tools: non-TTY install without `--yes` exits 3 | M | — | |
| 1.5/r043 | Classification table | Managed Tools: headroom `config_ignored` / `supported_config` passthrough | M | — | |
| 1.5/r044 | Classification table | Tool Search: `golem init` writes `ENABLE_TOOL_SEARCH=true` | M | — | |
| 1.5/r045 | Classification table | Tool Search: `golem bench tools` A/Bs against 27 labelled selection cases | D | none | |
| 1.5/r046 | Classification table | Tool Search: transforms `whitespace`, `first-sentence`, `schema-meta`/`-validation`/`-descriptions` (cumulative) | M | — | |
| 1.5/r047 | Classification table | Tool Search: argument gate grades against the **original** schemas | M | — | |
| 1.5/r048 | Classification table | Tool Search: "Golem's own 11 tools are ~902 description tokens and ~1,128 of input schemas" | D | none | |
| 1.5/r049 | Classification table | `code` tool (repo map + LSP modes, ~1.4k default budget) | M | — | |
| 1.5/r050 | Classification table | `wiki_upsert` description: "every write is committed to git" | D | none | |
| 1.5/r051<br>1.7/r039 (#39) | (merged) | **G12** `slider` / `bypass` / `stats` MCP prompts drive the retired `level` tool | X | none | G12 |
| 1.5/r052 | Classification table | `P1_TOOL_FALLBACK`: "capability has not shipped or is not enabled yet" | D | none | |
| 1.5/r053 | Classification table | `stats` tool reports compression level, not slider | M | — | |

#### DUST1.6

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.6/r001 (#W1) | Wiki — `concepts/Persona Registry.md` | Personas are a record leaf `inference.personas`. A persona holds no credential or `base_url` | M | — | |
| 1.6/r002 (#W2) | Wiki — `concepts/Persona Registry.md` | Leaf under `inference`, not a top-level section | M | — | |
| 1.6/r003 (#W3) | Wiki — `concepts/Persona Registry.md` | Merges per id, then per field. Only this leaf merges that way | M | — | |
| 1.6/r004 (#W4) | Wiki — `concepts/Persona Registry.md` | `tools` replaces rather than merges | M | — | |
| 1.6/r005 (#W5) | Wiki — `concepts/Persona Registry.md` | Provenance is recorded per `inference.personas.<id>.<field>` and shown by `golem personas` | M | — | |
| 1.6/r006 (#W6) | Wiki — `concepts/Persona Registry.md` | No per-layer defaults. Defaults are applied on read (`owner` → agent) | M | — | |
| 1.6/r007 (#W7) | Wiki — `concepts/Persona Registry.md` | staffed / dispatchable semantics. `personaModel` returns undefined for undeclared, unstaffed or owner:user | M | — | |
| 1.6/r008 (#W8) | Wiki — `concepts/Persona Registry.md` | "A `user`-owned persona is a role only a human fills; **nothing may dispatch it**" | D | none | |
| 1.6/r009 (#W9) | Wiki — `concepts/Persona Registry.md` | Persona id is path-safe (`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`) | M | — | |
| 1.6/r010 (#W10) | Wiki — `concepts/Persona Registry.md` | Each layer is `.strict()` | M | — | |
| 1.6/r011 (#W11) | Wiki — `concepts/Persona Registry.md` | Starter bench: 4 personas, all unstaffed by default | M | — | |
| 1.6/r012 (#W12) | Wiki — `concepts/Persona Registry.md` | No `manager` persona | M | — | |
| 1.6/r013 (#W13) | Wiki — `concepts/Persona Registry.md` | "This repo's own `.golem/settings.local.json` (personal, gitignored) staffs … `claude-opus-5` for `planner` and `reviewer`" | D | none | |
| 1.6/r014 (#W14) | Wiki — `concepts/Persona Registry.md` | `DEFAULT_PERSONA_PROMPTS` has built-ins for all four. Precedence: prompt > prompt_file > `.golem/personas/<id>.md` > built-in | M | — | |
| 1.6/r015 (#W15) | Wiki — `concepts/Persona Registry.md` | `golem personas eject <id>` writes `.golem/personas/<id>.md` and never overwrites | M | — | |
| 1.6/r016 (#W16) | Wiki — `concepts/Persona Registry.md` | Ejected files are tracked by git by default | M | — | |
| 1.6/r017 (#W17) | Wiki — `concepts/Persona Registry.md` | A team-wide prompt comes through the `team` origin, merges per field, and the project layer outranks team | P | none | |
| 1.6/r018 (#W18) | Wiki — `concepts/Persona Registry.md` | `inference.default_coder` is retired and **raises** | M | — | |
| 1.6/r019 (#W19) | Wiki — `concepts/Persona Registry.md` | "What is not here yet": staffing lane — R14.2; agent definitions — R14.3; `discipline` on a task — R14.4 | D | — | |
| 1.6/r020 (#W20) | Wiki — `concepts/Persona Registry.md` | Sibling rule `golem-prefer-persona-agents.md` lists each dispatchable persona with model + discipline | M | — | |
| 1.6/r021 (#S1) | Wiki — `concepts/Hosted-multi-turn-claude-CLI-spike.md` | `-p --input-format stream-json --output-format stream-json`, one `session_id` across turns | D | none | |
| 1.6/r022 (#S2) | Wiki — `concepts/Hosted-multi-turn-claude-CLI-spike.md` | SIGINT does not interrupt on Windows; process-kill only | M | — | |
| 1.6/r023 (#S3) | Wiki — `concepts/Hosted-multi-turn-claude-CLI-spike.md` | Verdict: the `claude` CLI qualifies as the ADR-0007 §3a runner | M | — | |
| 1.6/r024 (#H1) | Spec §1 — Target hardware profiles (`docs/golem-spec.md:60-69`) | Four profiles P-cpu/P-min/P-mid/P-max, detected by probe | M | — | |
| 1.6/r025 (#H2) | Spec §1 — Target hardware profiles (`docs/golem-spec.md:60-69`) | Profile boundaries: P-min 8 GB (3060/4060), P-mid 12–16 GB, P-max 24 GB | D | none | |
| 1.6/r026 (#H3) | Spec §1 — Target hardware profiles (`docs/golem-spec.md:60-69`) | Graceful degradation: a missing capability downgrades and never breaks | M | — | |
| 1.6/r027 (#H4) | Spec §1 — Target hardware profiles (`docs/golem-spec.md:60-69`) | Meaningful savings (`compression.level` off–2) need no GPU | — (—) | — | |
| 1.6/r028 (#R1)<br>1.11/r013 (#13) | (merged) | **G22** LAN worker agent reporting GPU/VRAM/load | P | none | G22 |
| 1.6/r029 (#R2) | Spec §2.2 — Device registry & job scheduler (`docs/golem-spec.md:146-155`) | The hub keeps a capability table and routes jobs by task → minimum tier (Tier 0–3 lists) | N | none | |
| 1.6/r030 (#R3) | Spec §2.2 — Device registry & job scheduler (`docs/golem-spec.md:146-155`) | Tier thresholds: Tier1 ≥6 GB, Tier2 ≥12 GB, Tier3 ≥24 GB | D | none | |
| 1.6/r031 (#R4) | Spec §2.2 — Device registry & job scheduler (`docs/golem-spec.md:146-155`) | Fallback: drop **one** tier *with a quality note*, or Haiku via API if allowed, or skip the stage | D | none | |
| 1.6/r032 (#R5) | Spec §2.2 — Device registry & job scheduler (`docs/golem-spec.md:146-155`) | Single-machine is the default and primary deployment | M | — | |
| 1.6/r033 (#R6) | Spec §2.2 — Device registry & job scheduler (`docs/golem-spec.md:146-155`) | Every backing service is URL-addressable (the inference half) | M | — | |
| 1.6/r034 (#R7)<br>1.11/r026 (#26) | (merged) | **G21** mTLS / auth between hub and LAN workers | conflict: 1.6=N, 1.11=P | none | G21 |
| 1.6/r035 (#L1) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Summarizer role (compaction, digests) | M | — | |
| 1.6/r036 (#L2) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Classifier/Router ("does this need Claude?" triage, intent tagging) | N | none | |
| 1.6/r037 (#L3) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Extractor (structured JSON from logs/HTML/PDF) | N | none | |
| 1.6/r038 (#L4) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Draft/Critic via the `coder` MCP tool only, never auto-triggered | M | — | |
| 1.6/r039 (#L5) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Reranker: cross-encoder rerank of RAG hits | D | none | |
| 1.6/r040 (#L6) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Runtime: Ollama-first, OpenAI-compatible, any compatible server is a drop-in via config | M | — | |
| 1.6/r041 (#L7) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Bundled llama.cpp as a v2 fallback; vLLM opt-in | N | none | |
| 1.6/r042 (#L8) | Spec §3.3 — Local LLM subtasks (`docs/golem-spec.md:176-184`) | Model catalog auto-selected per node: ~3–4B P-min, 7–8B P-mid, 14B P-max, Q4–Q5 | M | — | |
| 1.6/r043 (#D5) | Decisions | Ollama-first behind an OpenAI-compatible interface | M | — | |
| 1.6/r044 (#D6) | Decisions | Models per tier (advisory): ~4B/8B/14B instruct, bge-m3-class embed, **bge-reranker-v2-class cross-encoder** | P | none | |
| 1.6/r045 (#D7)<br>1.11/r022 (#22) | (merged) | **G38** Level-5 per-project local-only answers (D7 / P3 roadmap) | X | none | G38 |
| 1.6/r046 (#D12) | Decisions | LAN lab offload: every backing service URL-addressable from P0 (inference half) | M | — | |
| 1.6/r047 (#D25a) | Decisions | `coder` (ex-`delegate`) is the explicit local-model path | M | — | |
| 1.6/r048 (#D25b) | Decisions | Mode A draft / Mode B local_first proxy intercept, `ProxyRequest.localResponse`, live slider reload | X | — | |
| 1.6/r049 (#D26a) | Decisions | New modules `ollama-native.ts`, `install-runner.ts`, `ollama-bootstrap.ts`, reusing `chatModelFor(tier,"drafter")` | M | — | |
| 1.6/r050 (#D26b) | Decisions | Per-OS plans: winget arg array / brew / Linux script to tmpdir + `sh <file>`, temp file removed in `finally` | M | — | |
| 1.6/r051 (#D26c) | Decisions | `golem ollama status` / `setup`; consent gate (`--yes`, TTY prompt, non-TTY refuses immediately, decline → `{kind:"cancelled"}`) | M | — | |
| 1.6/r052 (#D26d) | Decisions | `golem ollama setup` is the only call site that installs or pulls; `golem init` and proxy never import `ollama-bootstrap.ts` | D | none | |
| 1.6/r053 (#D26e) | Decisions | "`drafter` is the only role any call site ever invokes", so one model covers all projects | D | none | |
| 1.6/r054 (#D26f) | Decisions | No settings-schema change; target model derived, not configured | M | — | |
| 1.6/r055 (#D26g) | Decisions | Status "ACCEPTED, implementing now" | D | — | |
| 1.6/r056 (#D26h) | Decisions | Real spawn/download and multi-GB pull are manual-verification checklist items only | P | R1.6 | |
| 1.6/r057 (#G1) | Also verify — generated agent definitions and preference rule (R13.12, R14.1) | `.claude/agents/golem-<id>.md` matches what `inference.personas` produces | M | — | |
| 1.6/r058 (#G2) | Also verify — generated agent definitions and preference rule (R13.12, R14.1) | `golem-prefer-persona-agents.md` matches the roster | M | — | |
| 1.6/r059 (#G3) | Also verify — generated agent definitions and preference rule (R13.12, R14.1) | Generation is deterministic, the ledger decides deletion, edits are kept as conflicts | M | — | |
| 1.6/r060 (#G4) | Also verify — generated agent definitions and preference rule (R13.12, R14.1) | Coder definition uses `inference.coder_prompt` when set (same prompt as the MCP tool) | M | — | |
| 1.6/r061 (#G5) | Also verify — generated agent definitions and preference rule (R13.12, R14.1) | Live resync on settings edit (polling watcher) plus a session-start sync | M | — | |
| 1.6/r062 (#C-a)<br>1.8/r016 | (merged) | **G08** `inference.worker_targets` retired-and-raises vs live leaf | conflict: 1.6=D, 1.8=P | none | G08 |
| 1.6/r063 (#C-b) | Owned-code claims not in the owned docs, where the comment contradicts the code | `persona-lane.ts` is "the ONE implementation"; `coder-route.ts` "now delegates to it" | D | none | |
| 1.6/r064 (#C-c) | Owned-code claims not in the owned docs, where the comment contradicts the code | Dispatch route label | D | none | |

#### DUST1.7

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.7/r001 (#1) | Findings table | `snooze.enforce` default | D | none | |
| 1.7/r002 (#2) | Findings table | `snooze.spawn_gate` default | D | none | |
| 1.7/r003 (#3) | Findings table | Park enforce/advisory wording in code | D | none | |
| 1.7/r004 (#4) | Findings table | Park mechanism: 0.9 threshold, fresh-only enforce, stale warn-once, exempt set | M | none | |
| 1.7/r005 (#5) | Findings table | D38 limit-state file name | D | none | |
| 1.7/r006 (#6) | Findings table | D38 park instruction | D | none | |
| 1.7/r007 (#7) | Findings table | D38 on-by-default wiring | M | — | |
| 1.7/r008 (#8) | Findings table | Spawn headroom gate logic | D | none | |
| 1.7/r009 (#9) | Findings table | D37 auto-resume removal | M | — | |
| 1.7/r010 (#10) | Findings table | DURABLE_TASKS guidance snippet | D | none | |
| 1.7/r011 (#11) | Findings table | D39 coder-first key/rule name | D | none | |
| 1.7/r012 (#12) | Findings table | D39 gate ordering | D | none | |
| 1.7/r013 (#13) | Findings table | D40 autonomy `enabled` flag, fail-closed, enable/disable | M | — | |
| 1.7/r014 (#14) | Findings table | D40 "corrected the misleading init comment" | D | none | |
| 1.7/r015 (#15) | Findings table | ADR-0002 levels + matrix + invalid→manual | M | — | |
| 1.7/r016 (#16) | Findings table | ADR-0002 audit log | M | — | |
| 1.7/r017 (#17) | Findings table | ADR-0002 destructive/outward → `ask` (human) | D | none | |
| 1.7/r018 (#18) | Findings table | ADR-0002 read MCP set incl. `level` | X | none | |
| 1.7/r019 (#19) | Findings table | ADR-0002 "misclassification only escalates; unknown never auto-allowed" | D | none | |
| 1.7/r020 (#20) | Findings table | Autonomy Gate wiki (two hooks, shapes, fail-safe) | M | — | |
| 1.7/r021 (#21) | Findings table | Blocked read model: v2, kinds, non-block types, staleness, pending-tool correlation, 2 000-char cap, fail-closed redaction | M | — | |
| 1.7/r022 (#22) | Findings table | Change Ledger: shadow refs, temp index, `.golem/` excluded, pre-restore, 50 keep, refusals, destructive class | M | — | |
| 1.7/r023 (#23) | Findings table | Guidance Rules wiki feature list + wiring location | D | none | |
| 1.7/r024 (#24) | Findings table | Generated `.claude/rules/golem-*.md` == registry | M | — | |
| 1.7/r025 (#25) | Findings table | Plan task frontmatter parse (all docs load) | P | none | |
| 1.7/r026 (#26) | Findings table | Quoted scalar values | D | none | |
| 1.7/r027 (#27) | Findings table | `golem task resume` for plan tasks | P | none | |
| 1.7/r028 (#28) | Findings table | Escalate / local multiplex | D | none | |
| 1.7/r029 (#29) | Findings table | Task `worktree` capture | N | none | |
| 1.7/r030 (#30) | Findings table | `spawnResume` failure detection | D | none | |
| 1.7/r031 (#31) | Findings table | Drift guards | M | — | |
| 1.7/r032 (#32) | Findings table | README frontmatter table vs parser | D | none | |
| 1.7/r033 (#33) | Findings table | `golem task done` refuses on unreviewed delegations | D | none | |
| 1.7/r034 (#34)<br>1.8/r039 | (merged) | **G09** Spec §5.1 slash-command table | D | none | G09 |
| 1.7/r035 (#35)<br>1.8/r038<br>1.7/r038 (#38)<br>1.11/r006 (#6)<br>1.11/r018 (#18) | (merged) | **G10** Skills layout `/golem/<cmd>` nested vs flat `/golem-<cmd>` | conflict: 1.7=D, 1.8=X, 1.7=X, 1.11=D, 1.11=D | none | G10 |
| 1.7/r036 (#36)<br>1.8/r013 | (merged) | **G11** Spec §5.1 / D11 / D19 settings hierarchy | D | none | G11 |
| 1.7/r037 (#37) | Findings table | D11 `.claude/commands/` files | X | — | |
| 1.7/r040 (#40) | Findings table | D10 PostToolUse CCR hook wiring | M | — | |

#### DUST1.8

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.8/r001 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | Seven origins, one `ORIGIN_ORDER`, pass 1 forward / pass 2 reversed | M | — | |
| 1.8/r002 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | `"!important"` sibling array; unlisted key warns, malformed list throws | M | — | |
| 1.8/r003 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | env/override contribute normal only; file `!important` beats `GOLEM_*` | M | — | |
| 1.8/r004 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | `default!` is the floor for future non-negotiables | N | none | |
| 1.8/r005 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | `REMOTE_DENIED_SETTINGS` compiled in, dropped with `REFUSED` warning, re-checked after rename | M | — | |
| 1.8/r006 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | `LayerName` gains `team`; `ProvenanceEntry.important?: true` | M | — | |
| 1.8/r007 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | Team value provenance names the team | M | — | |
| 1.8/r008 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | "The team origin is a slot, not a feature … nothing fetches one yet" | D | — | |
| 1.8/r009 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | Failure rule: nothing about a team link may stop the proxy starting | D | none | |
| 1.8/r010 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | Pinned control renders locked with origin + recourse (`IMPORTANT_LOCKED`) | P | none | |
| 1.8/r011 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | `ApplyResult.overridden` reported for writes the cascade overrules | P | none | |
| 1.8/r012 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | Team cache per org `~/.golem/teams/<org_id>.json` | M | — | |
| 1.8/r014 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | User scope is literal `~/.golem`, not env-paths | M | — | |
| 1.8/r015 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | `GOLEM_<SECTION>_<KEY>` env mapping | M | — | |
| 1.8/r017 | Settings cascade (SC, ADR8, D62, §5.1 hierarchy half, D19 config line) | Existing installs resolve identically when nothing is important | M | — | |
| 1.8/r018<br>1.9/r013 | (merged) | **G31** `SETTING_META` is `satisfies`-checked over `LeafPath` | M | none | G31 |
| 1.8/r019<br>1.9/r014 | (merged) | **G32** Widget kind derived from zod (`deriveKind`) | M | none | G32 |
| 1.8/r020 | Configuration Surfaces (CS) | `SECTION_META` title/summary/order | M | — | |
| 1.8/r021<br>1.9/r015 | (merged) | **G26** `SettingMeta.ownedBy` hides runtime-owned keys (CS §1 / D50(a)) | conflict: 1.8=D, 1.9=X | none | G26 |
| 1.8/r022<br>1.9/r016 | (merged) | **G27** Control-surface writes route to existing writers (CS §2 / D50(b)) | D | none | G27 |
| 1.8/r023<br>1.9/r017 | (merged) | **G30** Env-layer controls are locked | M | none | G30 |
| 1.8/r024 | Configuration Surfaces (CS) | `applyControl` throws for a locked control | D | none | |
| 1.8/r025<br>1.9/r018 | (merged) | **G29** `danger` confirms only in the risky direction | M | none | G29 |
| 1.8/r026<br>1.9/r019 | (merged) | **G28** Stable control ids `setting:/guidance:/runtime:` | conflict: 1.8=M, 1.9=D | none | G28 |
| 1.8/r027<br>1.9/r020 | (merged) | **G33** `golem config schema [--json]` | M | none | G33 |
| 1.8/r028<br>1.9/r022 | (merged) | **G34** Bare `golem` opens the panel (TTY-only, before commander) | conflict: 1.8=D, 1.9=M | none | G34 |
| 1.8/r029<br>1.9/r023 | (merged) | **G35** `ui.*` section keys | M | none | G35 |
| 1.8/r030 | Configuration Surfaces (CS) | `config set` coercion incl. objects (R9.9), whole-object replace, `{}` clears, named errors | M | — | |
| 1.8/r031 | Configuration Surfaces (CS) | `--value-file` / stdin, both-given is an error | M | — | |
| 1.8/r032 | Configuration Surfaces (CS) | `models.*` keys; `catalog_url` read only by `models refresh` | M | — | |
| 1.8/r033 | Init (D43, D58, §5.1 commands/mechanism) | `.golem/settings.json` is a content-free `{}` marker; port + level in `settings.local.json` | D | — | |
| 1.8/r034 | Init (D43, D58, §5.1 commands/mechanism) | Legacy project-scoped `proxy.port` still honoured | M | — | |
| 1.8/r035 | Init (D43, D58, §5.1 commands/mechanism) | Claude Code wiring in `.claude/settings.local.json`; `claude.settings_scope` default `local` | M | — | |
| 1.8/r036 | Init (D43, D58, §5.1 commands/mechanism) | Scope moves writes, never reads; init sweeps the other file; uninit sweeps both; CA excluded | M | — | |
| 1.8/r037 | Init (D43, D58, §5.1 commands/mechanism) | `golem config set/unset` default `--scope local` | M | — | |
| 1.8/r040 | Init (D43, D58, §5.1 commands/mechanism) | `golem init` appends guidance to project CLAUDE.md | X | — | |
| 1.8/r041 | Init (D43, D58, §5.1 commands/mechanism) | `UNPREFIXED_SKILLS` allowlist for `/vibe` | M | — | |
| 1.8/r042 | Init (D43, D58, §5.1 commands/mechanism) | MCP registered as `golem` stdio | M | — | |
| 1.8/r043 | Vibe (VG) | Layout `VIBE.md` / `guidelines/` / `snippets/` / `candidates.jsonl` / `sources.json` under `~/.golem/vibe` | M | — | |
| 1.8/r044 | Vibe (VG) | Brief capped at 4 KiB, truncated at a section boundary | M | — | |
| 1.8/r045 | Vibe (VG) | Gate: non-Golem dir performs zero reads; home dir is not a project | M | — | |
| 1.8/r046 | Vibe (VG) | Measured by line counting; evidence on every rendered row | P | none | |
| 1.8/r047 | Vibe (VG) | Generated block between `vibe-measured` markers, human text preserved | M | — | |
| 1.8/r048 | Vibe (VG) | Confirmed block inserted ABOVE measured | M | — | |
| 1.8/r049 | Vibe (VG) | Every byte written to the guide is redacted before write | P | none | |
| 1.8/r050 | Vibe (VG) | Two-half capture: PostToolUse hash+reading, UserPromptSubmit re-read; ledger in `.golem/state/vibe-pending.json` | M | — | |
| 1.8/r051 | Vibe (VG) | Quiz asks only open candidates seen ≥ 2; `no` tombstones forever | M | — | |
| 1.8/r052 | Vibe (VG) | `/vibe quiz` is the only surface that writes a stated preference | D | — | |
| 1.8/r053 | Vibe (VG) | `golem vibe show/seed/sources/path` | M | — | |
| 1.8/r054 | Vibe (VG) | Seed from `git log --author`; prompt text as voice source | N | `vibe-authored-history` (queued) | |
| 1.8/r055 | Vibe (VG) | Mark linter-enforced habits as enforced | N | `vibe-authored-history` | |
| 1.8/r056 | Distribution, versioning, update (D41, D16, D19, D4, D9) | One canonical version; `sync-version.mjs` in build generates `src/version.ts`; `index.ts` re-exports | M | — | |
| 1.8/r057 | Distribution, versioning, update (D41, D16, D19, D4, D9) | `release.mjs` bumps both package.json + VERSION in lockstep, "all three move or none do" | P | none | |
| 1.8/r059 | Distribution, versioning, update (D41, D16, D19, D4, D9) | golem.run UA routing | — (—) | — | |
| 1.8/r060 | Distribution, versioning, update (D41, D16, D19, D4, D9) | Bun cross-compiled binaries in CI | M | — | |
| 1.8/r062 | Distribution, versioning, update (D41, D16, D19, D4, D9) | `updateAvailable` in status/statusline; VS Code badge + `golem.update` | M | — | |
| 1.8/r063 | Distribution, versioning, update (D41, D16, D19, D4, D9) | TypeScript, Node ≥ 22, ESM, Biome, vitest, zod | M | — | |
| 1.8/r065 | Distribution, versioning, update (D41, D16, D19, D4, D9) | Python/uvx implementation | X | — | |
| 1.8/r066<br>1.11/r005 (#5) | (merged) | **G18** 3-OS CI matrix (macOS advisory) / `platformdirs` | conflict: 1.8=P, 1.11=D | none | G18 |
| 1.8/r067 | Release pipeline (RP, CM "Branches and releases") | `ci.yml` trigger "PR to `main`; `workflow_call`" | D | — | |
| 1.8/r068 | Release pipeline (RP, CM "Branches and releases") | No `push:` trigger in CI | M | — | |
| 1.8/r069 | Release pipeline (RP, CM "Branches and releases") | Matrix: quality ubuntu 22/24 + windows 24; test ubuntu×2×10 + windows×24×10; macOS ×4 advisory; one `CI gate` | M | — | |
| 1.8/r070 | Release pipeline (RP, CM "Branches and releases") | `release-prepare.yml` manual, development-only, bumps, pushes, opens PR, prints approval beat | M | — | |
| 1.8/r071 | Release pipeline (RP, CM "Branches and releases") | `release.yml` on push to main calls `ci.yml`; resolve refuses an existing tag | M | — | |
| 1.8/r072<br>1.10/r069 (#69) | (merged) | **G23** Release workflow asserts every required asset | conflict: 1.8=P, 1.10=M | release-portal-assets (done) | G23 |
| 1.8/r074 | Release pipeline (RP, CM "Branches and releases") | npm publish always, via OIDC trusted publisher, `--provenance` | M | — | |
| 1.8/r075 | Release pipeline (RP, CM "Branches and releases") | VS Code publish gated on `VSCE_PAT` | M | — | |
| 1.8/r076 | Release pipeline (RP, CM "Branches and releases") | `config-schema.json` rendered `--no-header` with isolated HOME + dir, asserted header-free / default+runtime layers | M | — | |
| 1.8/r077 | Release pipeline (RP, CM "Branches and releases") | Portal webhook: OIDC bearer, own job with `id-token: write`, retry 5xx / stop 4xx, inert without `PORTAL_WEBHOOK_URL`, `notify_only` mode, local `aud`/`workflow_ref` check | M | — | |
| 1.8/r078 | Release pipeline (RP, CM "Branches and releases") | `gh api repos/cloudcatalyst/golem/...` clearing commands; repository-settings evidence | D | — | |
| 1.8/r079 | Release pipeline (RP, CM "Branches and releases") | "`development` requires nothing, matching the decision that CI runs only at the release boundary" | D | — | |
| 1.8/r080 | Release pipeline (RP, CM "Branches and releases") | PRs target `development`; merge release PR with a merge commit | M | — | |
| 1.8/r081 | Release pipeline (RP, CM "Branches and releases") | CM "Running the tests" scripts: `test:changed`, `test:unit`, `test:serial`, `test:full`, `verify:deps`, `lint`, `format:check`, `typecheck` | M | — | |
| 1.8/r082 | Release pipeline (RP, CM "Branches and releases") | `golem verify`: log path first, one `golem-verify:` line per check, build before `dist/` readers, exit code | M | — | |

#### DUST1.9

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.9/r001 | Spec §5 — Telemetry & UX | Dashboard exists as a local web UI | M | — | |
| 1.9/r002 | Spec §5 — Telemetry & UX | Dashboard: tokens saved/spent | P | none | |
| 1.9/r003 | Spec §5 — Telemetry & UX | Dashboard: cache hit rates | P | none | |
| 1.9/r004 | Spec §5 — Telemetry & UX | Dashboard: cost estimate | P | none | |
| 1.9/r005 | Spec §5 — Telemetry & UX | Dashboard: per-stage savings attribution | M | — | |
| 1.9/r006 | Spec §5 — Telemetry & UX | Dashboard: per-device utilization | N | none | |
| 1.9/r007 | Spec §5 — Telemetry & UX | Dashboard: quality-delta from canary runs | N | none | |
| 1.9/r008 | Spec §5 — Telemetry & UX | `golem status` | M | — | |
| 1.9/r009 | Spec §5 — Telemetry & UX | `golem devices` | M | — | |
| 1.9/r010 | Spec §5 — Telemetry & UX | `golem index <path>` | M | — | |
| 1.9/r011 | Spec §5 — Telemetry & UX | `golem compression 3` | M | — | |
| 1.9/r012 | Spec §5 — Telemetry & UX | `golem replay-eval` | N | none | |
| 1.9/r021 | Decision 50 | `golem ui` / alias `golem settings` | X | — | |
| 1.9/r024 | Decision 50 | ink + React accepted | X | — | |
| 1.9/r025 | Decision 50 | Guard: the panel is reachable only by dynamic import | M | — | |
| 1.9/r026 | Decision 50 | Guard: `src/tui/state.ts` is a pure reducer | M | — | |
| 1.9/r027 | Decision 50 | U+25A0 pet is drawn in a fixed-width box, `--no-pet` escape hatch | M | — | |
| 1.9/r028 | Decision 51 | ink replaced by `render/screen/keys/ansi/width` (~765 lines) | M | — | |
| 1.9/r029 | Decision 51 | Back to 6 runtime dependencies | M | — | |
| 1.9/r030 | Decision 51 | `header.ts` / `controls.ts` are pure | M | — | |
| 1.9/r031 | Decision 51 | ANSI pre-paint splash deleted | M | — | |
| 1.9/r032 | Decision 51 | Panel paints in ~170ms | — ((unverifiable)) | — | |
| 1.9/r033 | Decision 51 | `tui-state.test.ts`: 32 tests passed unchanged | M | — | |
| 1.9/r034 | Decision 51 | Colour detection over the `NO_COLOR/FORCE_COLOR/COLORTERM/TERM/WT_SESSION` matrix | M | — | |
| 1.9/r035 | Decision 51 | `main.ts` is a dependency-free router | M | — | |
| 1.9/r036 | Decision 51 | `fast-path.ts` serves hooks and statusline without commander | M | — | |
| 1.9/r037 | Decision 51 | `cli/slider-read.ts` is the read-only half | X | none | |
| 1.9/r038 | Decision 51 | `cli/upstream-display.ts` read-only half | M | — | |
| 1.9/r039 | Decision 51 | Standing constraint: display never pays for write machinery | D | none | |
| 1.9/r040 | Decision 51 | Latency figures (hook 126/135ms, statusline 275ms) | — ((unverifiable)) | — | |
| 1.9/r041 | Decision 51 | Proxy adds +4.4ms p50 | — ((unverifiable)) | — | |
| 1.9/r042 | Decision 51 | `golem ui` / `settings` removed, bare `golem` IS the panel | M | — | |
| 1.9/r043<br>1.11/r081 (#81) | (merged) | **G36** Panel flags `--dir` / `--no-pet` / `--advanced` | M | none | G36 |
| 1.9/r044 | Decision 51 | An unrecognised flag falls through to commander | M | — | |
| 1.9/r045 | Decision 51 | Bare `golem` outside a TTY prints help, and panel flags outside a TTY explain why | M | — | |
| 1.9/r046 | Decision 51 | A test asserts documented flags equal accepted flags | M | — | |
| 1.9/r047 | Decision 51 | `ui`/`settings` recognised "for one release" (exit 2) | D | none | |
| 1.9/r048 | Decision 51 | `golem status` deliberately kept | M | — | |
| 1.9/r049 | Decision 51 | `ControlSurface.header` nullable | M | — | |
| 1.9/r050 | Decision 51 | `PanelState` gains `version` / `projectDir` | M | — | |
| 1.9/r051 | Context Ledger wiki page | `golem stats --context` | M | — | |
| 1.9/r052 | Context Ledger wiki page | Exhaustive buckets (8 names) | M | — | |
| 1.9/r053 | Context Ledger wiki page | Top 8 biggest blocks | M | — | |
| 1.9/r054 | Context Ledger wiki page | `tool_result` grouped by producing tool | M | — | |
| 1.9/r055 | Context Ledger wiki page | `tools` block decomposed per definition, owner from `mcp__` prefix, `defer_loading` | M | — | |
| 1.9/r056 | Context Ledger wiki page | No prompt content, ever | M | — | |
| 1.9/r057 | Context Ledger wiki page | Clock-free; the caller stamps `capturedAt` | M | — | |
| 1.9/r058 | Context Ledger wiki page | Latest-only, atomic temp+rename, fail-open | M | — | |
| 1.9/r059 | Context Ledger wiki page | "One atomic ... write **per request**" | D | none | |
| 1.9/r060 | Context Ledger wiki page | Estimates, not a tokenizer | M | — | |
| 1.9/r061 | Context Ledger wiki page | "Never written at level 0" | D | none | |
| 1.9/r062 | Honest observability — does each number have a source, and is an estimate called one? | H1 `golem stats` / dashboard / `watch` token figures | D | none | |
| 1.9/r063 | Honest observability — does each number have a source, and is an estimate called one? | H2 `requests` count | D | none | |
| 1.9/r064 | Honest observability — does each number have a source, and is an estimate called one? | H3 `golem bench cost` "Golem's measured contribution" | D | none | |
| 1.9/r065 | Honest observability — does each number have a source, and is an estimate called one? | H4 `golem watch` when Golem net-adds tokens | D | none | |
| 1.9/r066 | Honest observability — does each number have a source, and is an estimate called one? | H5 `/api/state` compression when state collection fails | D | none | |
| 1.9/r067 | Honest observability — does each number have a source, and is an estimate called one? | H6 `golem status` limits line | M | — | |
| 1.9/r068 | Honest observability — does each number have a source, and is an estimate called one? | H7 statusline quota meter | M | — | |
| 1.9/r069 | Honest observability — does each number have a source, and is an estimate called one? | H8 cost bench `$` | M | — | |
| 1.9/r070 | Honest observability — does each number have a source, and is an estimate called one? | H9 dashboard vs `golem stats` horizon | D | none | |

#### DUST1.10

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.10/r001 (#1) | ADR-0006 / Decision 59 (remote steering) | Capability 1 observe: read-only surface on a separate server from the write surface | M | R12.5 (done) | |
| 1.10/r002 (#2) | ADR-0006 / Decision 59 (remote steering) | Capability 2 class line enforced at `PermissionRequest` deny | M | R12.13 (queued, owner user) | |
| 1.10/r003 (#3) | ADR-0006 / Decision 59 (remote steering) | 59(a) "destructive/outward never remotely approvable, no setting to change it" | X | none | |
| 1.10/r004 (#4) | ADR-0006 / Decision 59 (remote steering) | Decision 61: gate-map item 3 as an off-by-default setting, fresh re-auth per answer, loud log, kill switch | N | R13.9 | |
| 1.10/r005 (#5) | ADR-0006 / Decision 59 (remote steering) | mTLS device pairing: Golem-issued client certs, `requestCert`, no bearer token | D | none | |
| 1.10/r006 (#6) | ADR-0006 / Decision 59 (remote steering) | Relay, account, 2FA, self-host tested path (59(c)-(e), ADR-0006 §3b/§3c) | N | R13.10 | |
| 1.10/r007 (#7) | ADR-0006 / Decision 59 (remote steering) | Silence denies (59(f), ADR-0006 §5) | M | — | |
| 1.10/r008 (#8) | ADR-0006 / Decision 59 (remote steering) | Decision binding `{session, tool, digest, nonce, deadline}` | X | none | |
| 1.10/r009 (#9) | ADR-0006 / Decision 59 (remote steering) | Remote decisions logged to `autonomy-log.jsonl` with device fingerprint | X | none | |
| 1.10/r010 (#10) | ADR-0006 / Decision 59 (remote steering) | Capability 3 "does not exist" / DECLINED | X | — | |
| 1.10/r011 (#11) | ADR-0006 / Decision 59 (remote steering) | `golem device revoke` works while the phone is off | M | R13.4 (done) | |
| 1.10/r012 (#12) | ADR-0007 / Decision 60 (hosted + joined sessions) | Hosted runner = one long-lived `claude -p --input-format stream-json` process through the proxy | D | none | |
| 1.10/r013 (#13) | ADR-0007 / Decision 60 (hosted + joined sessions) | Host decision enum separate from `GateEmission`; destructive/outward deny; derives from `decideGate` | M | — | |
| 1.10/r014 (#14) | ADR-0007 / Decision 60 (hosted + joined sessions) | Unanswered `ask` is a refusal, not a wait | M | — | |
| 1.10/r015 (#15) | ADR-0007 / Decision 60 (hosted + joined sessions) | Host injects its own `PreToolUse` gate via `--settings`, synchronous | M | — | |
| 1.10/r016 (#16) | ADR-0007 / Decision 60 (hosted + joined sessions) | Host gate fails closed (deny), guest gates fail silent | M | — | |
| 1.10/r017 (#17) | ADR-0007 / Decision 60 (hosted + joined sessions) | Attribution written and awaited BEFORE delivery | M | — | |
| 1.10/r018 (#18) | ADR-0007 / Decision 60 (hosted + joined sessions) | Remote-authored turns "surfaced locally" to the developer | P | none | |
| 1.10/r019 (#19) | ADR-0007 / Decision 60 (hosted + joined sessions) | Host log bounded to 5,000 lines | D | none | |
| 1.10/r020 (#20) | ADR-0007 / Decision 60 (hosted + joined sessions) | Hosted session "parks at the usage limit like anything else" | P | none | |
| 1.10/r021 (#21) | ADR-0007 / Decision 60 (hosted + joined sessions) | Interrupt a running turn from the device | P | none | |
| 1.10/r022 (#22) | ADR-0007 / Decision 60 (hosted + joined sessions) | Permission questions answered in place from the device | N | R13.9 | |
| 1.10/r023 (#23) | ADR-0007 / Decision 60 (hosted + joined sessions) | SSE down / POST up, seq, 500-event ring, `gap: true`, 15 s heartbeat, drop a subscriber >200 behind | D | none | |
| 1.10/r024 (#24) | ADR-0007 / Decision 60 (hosted + joined sessions) | Idempotent POST by `messageId` ("exactly once") | D | none | |
| 1.10/r025 (#25) | ADR-0007 / Decision 60 (hosted + joined sessions) | ACK means delivered; refusal → 502 | M | — | |
| 1.10/r026 (#26) | ADR-0007 / Decision 60 (hosted + joined sessions) | 413 above 32,000 chars; 128 KiB body cap sits above it | M | — | |
| 1.10/r027 (#27) | ADR-0007 / Decision 60 (hosted + joined sessions) | Joined session: queued for the next request, fenced block, off by default, 12 h TTL, exclusive-create claim | M | — | |
| 1.10/r028 (#28) | ADR-0007 / Decision 60 (hosted + joined sessions) | Ambiguous key refused; addressable again after 30 min idle; conversation id = hash of first message | M | — | |
| 1.10/r029 (#29) | ADR-0007 / Decision 60 (hosted + joined sessions) | `GET /sessions` lists every addressable session, hosted AND joined | P | R13.8 | |
| 1.10/r030 (#30) | ADR-0007 / Decision 60 (hosted + joined sessions) | Conversation store: redacted before write, `0o600`, 32 convs / 30 days, `forget` / `forget --all`, gitignored, shared id | M | — | |
| 1.10/r031 (#31) | ADR-0007 / Decision 60 (hosted + joined sessions) | The store feeds scrollback and continuation; "consumers: session host (R13.3), transport (R13.5)" | P | R13.8 | |
| 1.10/r032 (#32) | ADR-0007 / Decision 60 (hosted + joined sessions) | Store bounds "both configurable" | D | none | |
| 1.10/r033 (#33) | ADR-0007 / Decision 60 (hosted + joined sessions) | Start a new conversation / continue one from the device | N | R13.8 | |
| 1.10/r034 (#34) | ADR-0007 / Decision 60 (hosted + joined sessions) | Gate map items 1-9 as real controls | N | R13.9 | |
| 1.10/r035 (#35) | ADR-0007 / Decision 60 (hosted + joined sessions) | Two factors (cert + passcode); windows 15 / 5 / 2 min; step-up measured from when the passcode was typed | D | R13.8 | |
| 1.10/r036 (#36) | ADR-0007 / Decision 60 (hosted + joined sessions) | Chat surface names the session kind; no approve button for destructive/outward | M | — | |
| 1.10/r037 (#37) | ADR-0007 / Decision 60 (hosted + joined sessions) | `session-tree.ts` stores hashes only; the store is the one exception | M | — | |
| 1.10/r038 (#38) | ADR-0007 / Decision 60 (hosted + joined sessions) | Invariant 6: with injection off, no queue is handed to the pipeline | M | — | |
| 1.10/r039 (#39) | ADR-0007 / Decision 60 (hosted + joined sessions) | Hosted-session CLI: `start`, `list`, `log`, `explain`, `stop`, `serve` | D | none | |
| 1.10/r040 (#40) | ADR-0007 / Decision 60 (hosted + joined sessions) | Hosted session = "ADR-0007 invariant 8, no exemption" | D | none | |
| 1.10/r041 (#41) | Decision 63 (per-org cache) | Cache at `~/.golem/teams/<org_id>.json` | M | — | |
| 1.10/r042 (#42) | Decision 63 (per-org cache) | 63(c) `golem status` reports cache age per team | M | — | |
| 1.10/r043 (#43) | Decision 63 (per-org cache) | 63(d) `unlink` keeps the cache | M | — | |
| 1.10/r044 (#44) | Decision 63 (per-org cache) | 63(e) org id is not sanitised; an invalid shape is refused | M | — | |
| 1.10/r045 (#45) | Decision 63 (per-org cache) | 63(f) sync refreshes the current project's team; `--all` sweeps | M | — | |
| 1.10/r046 (#46) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | 64(b)/(c) unlinked project: zero portal I/O, no cache read, no token lookup, one mention | M | — | |
| 1.10/r047 (#47) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | 64(c2) real CLI exit code on a default install | M | — | |
| 1.10/r048 (#48) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | 64(d)/(d2) a 402/403 stamps the cache; the read path refuses a stamped cache | M | — | |
| 1.10/r049 (#49) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | `api_error` → "team settings are NOT being applied" | D | none | |
| 1.10/r050 (#50) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | 64(e)/(e2) matrix: unreachable/5xx/401 → cache; 402/403 → no cache; unknown status → no cache; unknown throw → cache; 403 with unknown code denies | M | — | |
| 1.10/r051 (#51) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | "200 with a non-JSON body" classified one way | D | none | |
| 1.10/r052 (#52) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | 64(f) nothing entitlement-related fails `golem init`, and "degrade, but never silently" | D | none | |
| 1.10/r053 (#53) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | 64(g) no local licence file / key check | M | — | |
| 1.10/r054 (#54) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | The team origin is applied on every config load ("every config load reads that file") | D | none | |
| 1.10/r055 (#55) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | `enforced: true` → `"!important"` at the team origin | M | — | |
| 1.10/r056 (#56) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Floor: `REMOTE_DENIED_SETTINGS` compiled in; a denied key is DROPPED with a loud `REFUSED` | M | — | |
| 1.10/r057 (#57) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Provenance names the team (`team org_… (cached copy, fetched …)`) | M | — | |
| 1.10/r058 (#58) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Wire tolerates `null` where a field is optional (the §164 lesson) | D | none | |
| 1.10/r059 (#59) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Committed `team.portal_url` is "the API base only"; credentials stay in the keychain and "do not follow it" | D | none | |
| 1.10/r060 (#60) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | One team per project, committed at project scope | M | project-team-binding (done) | |
| 1.10/r061 (#61) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Sign-in = auth code + PKCE S256 over a `127.0.0.1` loopback; timing-safe `state`; no device grant | M | team-portal-auth (done) | |
| 1.10/r062 (#62) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Refresh once on 401, then one full re-link, then give up | D | none | |
| 1.10/r063 (#63) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Tokens in the OS keychain | M | — | |
| 1.10/r064 (#64) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | Team skills: flat `golem-team-<name>/`, name validated, hash checked, 500 / 512 KiB caps, deletions propagate, edited file kept | M | — | |
| 1.10/r065 (#65) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | `golem init` syncs the team layer; skills sync is `golem team skills` | M | — | |
| 1.10/r066 (#66) | Decision 64 + Team Layer / Project Team Binding / Free and Team Tiers | `link` exits 2 when sign-in succeeds but binding does not | M | — | |
| 1.10/r067 (#67) | Portal Install Contract | Installers fetch `$base/bin/golem-${os}-${arch}` / `golem-windows-$arch.exe`; `GOLEM_INSTALL_BASE` defaults to `https://golem.run` | M | — | |
| 1.10/r068 (#68) | Portal Install Contract | Installer ladder is exactly two rungs, "do not reorder" | D | none | |
| 1.10/r070 (#70) | Portal Install Contract | "no release has been cut since" | D | none | |
| 1.10/r071 (#71) | Portal Install Contract | `config-schema.json` rendered from `schema.ts` and shipped | M | — | |
| 1.10/r072 (#72) | Buzz Integration (R14.2-R14.5) | `golem acp`: ACP Agent over stdio, one persona per process, `--persona` required, stdout protocol-only | M | R14.3 (queued) | |
| 1.10/r073 (#73) | Buzz Integration (R14.2-R14.5) | The four required ACP methods | M | R14.3 | |
| 1.10/r074 (#74) | Buzz Integration (R14.2-R14.5) | `session/cancel` → the in-flight turn resolves `cancelled`, nothing stale posted | D | R14.3 | |
| 1.10/r075 (#75) | Buzz Integration (R14.2-R14.5) | Lane resolved once per turn; prompt from `resolvePersonaPrompt()` with the coder special-case | M | R14.3 | |
| 1.10/r076 (#76) | Buzz Integration (R14.2-R14.5) | "Two defects that block axis 2 today" (no `model` on `DispatchRequest`; no worker-lane `resolvePersonaPrompt`) | X | — | |
| 1.10/r077 (#77) | Buzz Integration (R14.2-R14.5) | Rate limit: pre-flight park via `decideSnoozeNudge`, bounded in-turn retry with keepalive, defer, `end_turn`, `persistSnoozeNote` | M | R14.3 | |
| 1.10/r078 (#78) | Buzz Integration (R14.2-R14.5) | Deferral "posts … with `buzz messages send`" | D | R14.4 | |
| 1.10/r079 (#79) | Buzz Integration (R14.2-R14.5) | Thread recorded as deferred; orchestrator state machine across turns | N | R14.4 | |
| 1.10/r080 (#80) | Buzz Integration (R14.2-R14.5) | One Nostr keypair per persona per project; secret in the credential store; pubkeys in a committed manifest; `buzz-admin add-member` printed, not run | P | R14.2 (queued) | |
| 1.10/r081 (#81) | Buzz Integration (R14.2-R14.5) | `BUZZ_ACP_RESPOND_TO=owner-only` default | M | R14.2 | |
| 1.10/r082 (#82) | Buzz Integration (R14.2-R14.5) | Buzz Desktop BYOH `custom_harnesses/golem.json` makes `golem` selectable | P | R14.2 | |
| 1.10/r083 (#83) | Buzz Integration (R14.2-R14.5) | `golem buzz status` reports the missing binaries and the optional tier-C add-on | N | R14.2 / R14.5 | |
| 1.10/r084 (#84) | Buzz Integration (R14.2-R14.5) | Tier C: nested `claude-agent-acp` | N | R14.5 | |
| 1.10/r085 (#85) | Buzz Integration (R14.2-R14.5) | Orchestrator `@Golem` addressable in Buzz | N | R14.4 | |

#### DUST1.11

| ref | section | feature | class | task | dup |
|---|---|---|---|---|---|
| 1.11/r001 (#1) | Spec header, §1 Vision & Goals, Non-goals, hardware profiles | Spec version/date line | D | none | |
| 1.11/r002 (#2) | Spec header, §1 Vision & Goals, Non-goals, hardware profiles | Naming note | D | none | |
| 1.11/r003 (#3) | Spec header, §1 Vision & Goals, Non-goals, hardware profiles | Identity: "agentic developer assistant layer for Claude" | D | none | |
| 1.11/r010 (#10) | Spec header, §1 Vision & Goals, Non-goals, hardware profiles | Non-goals (no cloud-hosted deployment, and so on) | D | none | |
| 1.11/r019 (#19) | §7 Phased Roadmap | P1: Qdrant indexing, MCP `index_path` / `search_local` / `get_chunk`, guidance "prefer search_local" | D | none | |
| 1.11/r023 (#23) | §7 Phased Roadmap | P4: fleet (device registry, scheduler, LAN workers, canary evals) | P | none | |
| 1.11/r024 (#24) | §7 Phased Roadmap | Decision 21 phase placement note | X | none | |
| 1.11/r028 (#28) | §8 Risks & Mitigations | Autonomy gates for irreversible actions | M | — | |
| 1.11/r029 (#29) | §8 Risks & Mitigations | Remote approval = RCE, needs strong auth and default-deny | M | — | |
| 1.11/r030 (#30) | §8 Risks & Mitigations | Resumed durable task double-applies a side effect (idempotency keys) | X | none | |
| 1.11/r031 (#31) | §8 Risks & Mitigations | Decision 25 local-first row | M | — | |
| 1.11/r032 (#32) | §8 Risks & Mitigations | ToS and quota-arbitrage caution | M | — | |
| 1.11/r033 (#33) | §9 "To verify against live docs" | PostToolUse replaces output via `updatedToolOutput` | M | — | |
| 1.11/r034 (#34) | §9 "To verify against live docs" | Init refuses under `headroom wrap` | D | none | |
| 1.11/r035 (#35) | Decisions 20, 21, 32, 36 (and >64) | 20a durable task queue (auto-resume dropped) | M | — | |
| 1.11/r036 (#36) | Decisions 20, 21, 32, 36 (and >64) | 20b task/question queue + concurrent-conversation multiplexing | P | none | |
| 1.11/r037 (#37) | Decisions 20, 21, 32, 36 (and >64) | 20c self-hosted remote session access | P | R13.10, R13.8 | |
| 1.11/r038 (#38) | Decisions 20, 21, 32, 36 (and >64) | 20d cruise-control autonomy | M | R13.9 (gate map) | |
| 1.11/r039 (#39) | Decisions 20, 21, 32, 36 (and >64) | 20e tiered user/workspace/org standards | P | none | |
| 1.11/r040 (#40) | Decisions 20, 21, 32, 36 (and >64) | 20f note capture that shapes context (CLI + MCP tool + hook) | P | none | |
| 1.11/r041 (#41) | Decisions 20, 21, 32, 36 (and >64) | 20g writing-style adaptation and prompt translation | P | R5.5-scoring | |
| 1.11/r042 (#42) | Decisions 20, 21, 32, 36 (and >64) | 21a parallel conversations with model escalation | P | none | |
| 1.11/r043 (#43) | Decisions 20, 21, 32, 36 (and >64) | 21b remote steering / permission-granting | P | R12.13, R12.14, R13.15 | |
| 1.11/r044 (#44) | Decisions 20, 21, 32, 36 (and >64) | 21c dashboard sidecar: statusline, watch, VS Code | D | none | |
| 1.11/r045 (#45) | Decisions 20, 21, 32, 36 (and >64) | 21d account switching | D | none | |
| 1.11/r046 (#46) | Decisions 20, 21, 32, 36 (and >64) | 21e multi-provider routing / quota arbitrage | P | none | |
| 1.11/r047 (#47) | Decisions 20, 21, 32, 36 (and >64) | 21f cost-governance benchmarks | M | — | |
| 1.11/r048 (#48) | Decisions 20, 21, 32, 36 (and >64) | 32 positioning: universal pre-LLM processor | M | — | |
| 1.11/r049 (#49) | Decisions 20, 21, 32, 36 (and >64) | 36 roadmap refocus: R5/R6 ON HOLD; housekeeping | D | none | |
| 1.11/r050 (#50) | Decisions 20, 21, 32, 36 (and >64) | Decisions above 64 / unclaimed | M | — | |
| 1.11/r051 (#51) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | §1 topology: one process; MCP "search · fetch · expand · coder · ingest · stats" | D | none | |
| 1.11/r052 (#52) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | §2 lifecycle: local answer "opt-in" | D | none | |
| 1.11/r053 (#53) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | §3 routing; "switch with `golem account use <id>`" | D | none | |
| 1.11/r054 (#54) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | §4 observability, one `SessionStateReport` | M | — | |
| 1.11/r055 (#55) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | §5 PreToolUse stack = snooze, coder-first, autonomy | P | none | |
| 1.11/r056 (#56) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | §6 task multiplexing and prompt translation | M | — | |
| 1.11/r057 (#57) | Wiki: `concepts/Architecture.md`, `concepts/Dogfooding Golem.md` | Dogfooding Golem (dev loop) | D | none | |
| 1.11/r058 (#58) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r3.7-lancedb-scale-spike.md` | M | — | |
| 1.11/r059 (#59) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r1.2-positioning-universal-preprocessor.md` | M | — | |
| 1.11/r060 (#60) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r1.1-net-of-cache-ab.md` | D | none | |
| 1.11/r061 (#61) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r2.1-avoidedupstream-spike.md` | X | — | |
| 1.11/r062 (#62) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r4.7-drafter-quality-baseline.md` | M | — | |
| 1.11/r063 (#63) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/le2-grounded-refined-coder-quality.md` | D | none | |
| 1.11/r064 (#64) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r4-co-developer-core-batch.md` | D | none | |
| 1.11/r065 (#65) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r5-autonomy-orchestration-batch.md` | P | none | |
| 1.11/r066 (#66) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/r6-multi-provider-batch.md` | D | none | |
| 1.11/r067 (#67) | Wiki: `syntheses/`, `questions/`, `sources/` | `syntheses/wiki-knowledge-loop-batch.md` | D | none | |
| 1.11/r068 (#68) | Wiki: `syntheses/`, `questions/`, `sources/` | `questions/r1.6-ollama-verification-blocked.md` | M | R1.6 | |
| 1.11/r069 (#69) | Wiki: `syntheses/`, `questions/`, `sources/` | `questions/wiki-write-autonomy.md` | M | — | |
| 1.11/r070 (#70) | Wiki: `syntheses/`, `questions/`, `sources/` | `sources/agentic-token-saving-techniques.md` | D | none | |
| 1.11/r071 (#71) | Wiki: `syntheses/`, `questions/`, `sources/` | `sources/kimi-k3.md` | D | none | |
| 1.11/r072 (#72) | Wiki: `syntheses/`, `questions/`, `sources/` | `sources/llm-wiki-second-brain-obsidian.md` | D | none | |
| 1.11/r073 (#73) | Wiki: `syntheses/`, `questions/`, `sources/` | `sources/local-coder-models-2026.md` | M | — | |
| 1.11/r075 (#75) | Project prose: CLAUDE.md, README.md | CLAUDE.md MCP tool list `search`, `fetch`, `expand`, `stats`, `ingest`, `coder` | P | none | |
| 1.11/r076 (#76) | Project prose: CLAUDE.md, README.md | CLAUDE.md `level` retired; `/golem-<cmd>`, `GOLEM_*` | M | — | |
| 1.11/r077 (#77) | Project prose: CLAUDE.md, README.md | CLAUDE.md "Source of truth" (task docs → ROADMAP generated) | D | none | |
| 1.11/r078 (#78) | Project prose: CLAUDE.md, README.md | README pillars and identity | M | — | |
| 1.11/r079 (#79) | Project prose: CLAUDE.md, README.md | README "`/golem/*` skills", "one local process", "opt-in" local answer | D | none | |
| 1.11/r082 (#82) | Project prose: CLAUDE.md, README.md | README `npm run check` = lint + typecheck + tests | M | — | |
| 1.11/r083 (#83) | Project prose: CLAUDE.md, README.md | README non-interactive `golem config`, `guidance`, `compression`, `brevity`, `config schema --json` | M | — | |
| 1.11/r084 | Unowned code | autonomy.ts | M | — | |
| 1.11/r085 | Unowned code | bench.ts | M | — | |
| 1.11/r086 | Unowned code | buzz.ts | M | — | |
| 1.11/r087 | Unowned code | checkpoint.ts | M | — | |
| 1.11/r088 | Unowned code | config.ts | M | — | |
| 1.11/r089 | Unowned code | device.ts | M | — | |
| 1.11/r090 | Unowned code | dials-stats.ts | M | — | |
| 1.11/r091 | Unowned code | gateway.ts | D | — | |
| 1.11/r092 | Unowned code | init-uninit.ts | M | — | |
| 1.11/r093 | Unowned code | local-ollama.ts | M | — | |
| 1.11/r094 | Unowned code | mcp-serve.ts | M | — | |
| 1.11/r095 | Unowned code | note-dashboard-watch.ts | M | — | |
| 1.11/r096 | Unowned code | personas.ts | M | — | |
| 1.11/r097 | Unowned code | pkg-models.ts | M | — | |
| 1.11/r098 | Unowned code | plugin.ts | M | — | |
| 1.11/r099 | Unowned code | prompt-guidance.ts | D | — | |
| 1.11/r100 | Unowned code | proxy.ts | D | — | |
| 1.11/r101 | Unowned code | ps.ts | P | — | |
| 1.11/r102 | Unowned code | select-target.ts | D | — | |
| 1.11/r103 | Unowned code | session-host.ts | M | — | |
| 1.11/r104 | Unowned code | session.ts | D | — | |
| 1.11/r105 | Unowned code | status-update.ts | M | — | |
| 1.11/r106 | Unowned code | target.ts | D | — | |
| 1.11/r107 | Unowned code | tasks.ts | M | — | |
| 1.11/r108 | Unowned code | team.ts | D | — | |
| 1.11/r109 | Unowned code | verify.ts | M | — | |
| 1.11/r110 | Unowned code | vibe.ts | M | — | |
| 1.11/r111 | Unowned code | wiki.ts | M | — | |
