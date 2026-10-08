# Fact-check of the Phase 5 marketing drafts (DUST5.6)

DRAFT record. Reviewer: a read-only `golem-reviewer` agent that did not write the drafts. Checked against the code at `a3f1d39` on 2026-10-08. Transcribed by the orchestrator, because the harness did not let the subagent write this file.

Documents checked: `feature-overview.md`, `changelog-v0.54.md`, `blog-dust-method.md`, against `CLAIMS.md` (claims C-01..C-26, banned list B-01..B-38).

## Counts

- Ledger rows checked: 26 (all cited by the feature overview). True 23, line-drifted 1 (C-03), overstated 1 (C-13), false 1 (C-01).
- Changelog: 34 commits checked against their cited PR merges, all correct; 48 other cited shas matched their subjects. The DUSTSEC.2 per-tag check and the DUSTSEC.6 claim reproduce. The DUSTSEC.19 entry matches PR #265 and its stated gaps match the DUSTSEC.20 and DUSTSEC.21 task docs.
- Blog: every number matches the DUST1.12, DUST2, DUST3 and dogfood sources; about 1,137 words of prose.
- No tag contains any of the 83 DUSTSEC, Phase 3 and later commits checked (`git tag --contains` was empty for each). Nothing in the drafts implies that a release, an advisory or a plan to issue one exists.

## Verdict, first pass: BLOCK

A false claim in a draft and a banned wording in the changelog. Both are fixed below.

## Findings and fixes

Status column: filled in by the fix commit, then re-checked by the second pass.

| # | Where | Severity | Finding | Fix | Status |
|---|---|---|---|---|---|
| 1 | feature-overview.md:15-16 (C-01) | block | Says other paths and non-JSON bodies are not redacted. Since DUSTSEC.19 (PR #265) JSON bodies on every path are redacted; only absent, non-JSON, gzip-encoded or byte-order-mark bodies pass through. | Rewrite C-01 and B-32 first, then the draft; keep the gzip and byte-order-mark caveat (DUSTSEC.21) | fixed in this commit series: re-verified at `pipeline.ts:313-341,407-433` (JSON bodies on every path redacted; gzip and byte-order-mark bodies fail `JSON.parse` and pass through). C-01 and B-32 rewritten first, then the overview |
| 2 | changelog-v0.54.md:105 | high | Cites C-01 for the DUSTSEC.19 entry, which C-01 contradicted | Re-cite once C-01 is rewritten | fixed: C-01 now agrees with the DUSTSEC.19 entry, which keeps its C-01 citation |
| 3 | changelog-v0.54.md:20, :103 | block (B-27) | "independent" review wording, which B-27 bans in every wording | "reviewed twice by a separate reviewer agent in this project", and say it is not an outside audit | fixed: both lines reworded to the agreed text |
| 4 | feature-overview.md:49 (C-13) | medium | "Compression pays off on non-caching upstreams" is gated on measured benefit (spec line 12, Decision 32) and runs into B-31 | Drop the sentence; mark C-13 overstated | fixed: re-verified against spec line 12 ("gated on measured benefit"); sentence dropped, C-13 marked overstated with a spec-supported replacement |
| 5 | feature-overview.md:48 | low | "about 0%, measured in July 2026" conflicts with B-26 (no percentage stated as measured) | Default: drop the percentage; the user may settle C-13 against B-26 differently | fixed: default taken, the percentage is dropped (B-26 wins); the settlement of C-13 against B-26 is still the user's call |
| 6 | changelog-v0.54.md:139, :67 | medium | Treats npm `0.54.2` as the `43ac834` build. At `43ac834` the package was named `golem-run`; the rename to `@pliable/golem` landed in `2fc7cd2` (2026-09-23) while the version still said 0.54.2, so `@pliable/golem@0.54.2` was built from `2fc7cd2` or later | Say the npm build's source commit is unknown but is `2fc7cd2` or later; drop "0.54.2 = 43ac834" | fixed: re-verified, `43ac834:package.json` names `golem-run` and `2fc7cd2:package.json` names `@pliable/golem` at 0.54.2. Draft now says the npm build's source commit is unknown but is `2fc7cd2` or later; the same fix removed "built before the fixes existed" from the tags paragraph |
| 7 | changelog-v0.54.md:143 | low | "Not on npm per the read above" read `@pliable/golem`, but 0.54.1 was named `golem-run` | Cite a `golem-run` read, or drop the sentence | fixed: sentence dropped (no `golem-run` registry read was made) |
| 8 | changelog-v0.54.md:79 | medium | "Still not caught:" lists three items and reads as complete; `src/hooks/bypass-guard.ts` lines 21-26 also list settings writes via `echo >`, `jq`, `sed -i` or a script, base64, and a renamed binary | "Not caught, among others:" plus settings-file writes | fixed: re-verified against `bypass-guard.ts:21-26`; reads "Not caught, among others" and lists settings-file writes, base64 and a renamed binary |
| 9 | changelog-v0.54.md:49 | low | `078b77f` cited as the refresh-path binding; its subject is the `golem team link` refusal | Move it to the link-refusal clause | fixed: re-verified (`078b77f` is the link refusal, `cb313c7` the refresh binding); each now sits with its own clause |
| 10 | feature-overview.md:65 (C-18) | low | Drops the caveat that `--yes` skips the prompt and that without a TTY the command refuses | Restore the caveat | fixed: caveat restored in the overview (C-18 already carried it) |
| 11 | feature-overview.md:69 (C-19) | low | "up to eleven tools" without "plugin tools may add more" | Restore the caveat | fixed: caveat restored in the overview (C-19 already carried it) |
| 12 | feature-overview.md:58 (C-15) | low | Local-answer prefix quoted with a comma; the code reads "**Golem** Answered locally from the project knowledge base — verify independently." (`local-answer.ts:20-21`) | Quote exactly | fixed: quoted exactly in the overview; C-15 now quotes `LOCAL_ANSWER_LABEL` exactly |
| 13 | changelog-v0.54.md:122 | low | Uses the banned word "byte-faithful" while describing its retirement (B-20) | "the retired wording" | fixed: reads "the retired wording" |
| 14 | blog-dust-method.md:9, :19, :60 | low | Factual sentences without a citation (9 and 60 are supported by the DUST1.12 debrief and the dogfood findings; 19 was not checked) | Add citations | fixed: citations added at the three lines. Line 19 was checked this pass: the DUST2 debrief (default rules section) and spec section 11 state the rule |
| 15 | blog-dust-method.md:5 | low | "ran it once": true for the full method, but lines 55-59 describe a second one-partition run (DUST4.4) | "once in full" | fixed: reads "once in full" |
| 16 | src/pipeline/pipeline.ts:9-15 (code comment, not a draft) | low | Still says only `POST /v1/messages` is rewritten; C-11 cites that range | Comment-only fix | fixed: comment-only edit at `pipeline.ts:10-15`, same line count, confirmed by diff (every changed line is a comment line) |

## Ledger line anchors to update

- C-01: path gate at `pipeline.ts:313-316`; non-messages redaction at `:329-341` and `:429-433`; stage 1 moved from `:497-505` to `:525-527`.
- C-03: `redactOnly` moved from `pipeline.ts:383-396` to `:407-421`.
- C-06: `loader.ts:107` is now `:108`. C-08: `post-tool-use.ts:267-278` is now `:269-277`.
- Ledger header: checked-at commit `7c92d36` becomes the current head.
- B-32: its reason no longer holds after DUSTSEC.19.

Anchor notes from the fix pass: C-08 now reads `post-tool-use.ts:269-278`, not the `:269-277` the review gave, because the `stripKnownSecrets` call that does the redaction is on line 278. C-11 now cites `pipeline.ts:10-24` (the header comment starts at line 10). Rows still stamped `7c92d36` sit in files that `git diff 7c92d36 a3f1d39` shows unchanged.

No tag contains `109f32b` (DUSTSEC.19) or `fd5b1dd` (`git tag --contains`, empty for both), so no draft claims a released build holds a security fix.

## Second pass

Pending. A second review of the fixed drafts and the ledger has not been run. The Status column above records what the fix commits did, not a second reviewer's verdict.
