---
title: "Dust Phases 4 and 5: the golem-dust skill and the marketing drafts"
type: debrief
tags: [dust, dust4, dust5, skill, marketing, fact-check, redaction, windows]
sources: [docs/plan/tasks/DUST4.1.md, docs/plan/tasks/DUST5.2.md, docs/marketing/REVIEW.md, docs/plan/audit/dust-4-dogfood/FINDINGS.md]
created: 2026-10-09
updated: 2026-10-09
---

# Dust Phases 4 and 5: the skill and the drafts

Closes DUST4.1-DUST4.5 and DUST5.1-DUST5.7 (PRs #259-#273). This debrief follows the skill's own debrief template, its first real use. The method it describes is on the page [[Dust Method]]; the earlier phases are in [[Dust Phase 1 — eleven audits, one baseline]] and the debriefs named `2026-10-08-DUST2-rebaseline.md` and `2026-10-08-DUST3-refactor.md`.

## Outcome

- **Phase 4:** a user-invoked skill, `golem-dust`, as one new file in `src/cli/skills/` plus a registration entry. It installs by default like the other skills, because a skill the user has to type costs one description line. Lifecycle tests run the real `golem init` and `golem uninit` in temp directories (7 tests). A wiki page, a README line, a spec note and a headings-only debrief template were added. The skill was dogfooded once on a small slice (the Change Ledger: 46 rows, 38 matches, 6 partial, 2 drifted, recounted mechanically) and the run found 11 defects in the skill text; 9 were fixed and 2 filed.
- **Phase 5:** a claims ledger (26 verified claims, 38 banned items), and three DRAFTS under `docs/marketing/` (feature overview, changelog for v0.54.x, a blog post about the method). Nothing is published; publishing is the user's (DUST5.8). `docs/marketing/` is excluded from local answers, so drafts cannot be quoted to users as answers.
- Test count rose from 4464 to 4559 across the work, which also shipped the redaction and Windows fixes below.

## Default rules applied and where

The default rule stayed "doc follows shipped code unless it touches security, a hard rule or a recorded user decision". In Phase 5 it decided one case: where the ledger and its banned list disagreed about the "about 0 percent, measured" figure, the sentence was dropped (the stricter list won), and the user may settle it differently. Recorded in `docs/marketing/REVIEW.md`.

## Open exceptions

DUST5.8 (publishing, and whether to cut a release and an advisory first) is the user's. No release tag contains any DUSTSEC fix: the newest tag was cut on 2026-09-23, before that work. The contradictions G3, M2, H2, P3, P4 and the fleet question stay open, and the drafts say nothing that depends on them.

## What review caught

- **The fact-check of the drafts returned BLOCK.** One draft sentence had been made false by a merged fix (it said other routes were not redacted), the changelog used a wording the ledger bans ("independent" review), and it equated the npm 0.54.2 build with a commit that predates the package rename. A second pass found the exception list still incomplete.
- **Building the ledger found a real redaction gap**, which became DUSTSEC.19: only `POST /v1/messages` bodies were redacted, so the token-count and batches routes forwarded raw bodies. Its review then found a request-corrupting bug that already existed on the main route: the long-token rule rewrote 33-character API ids, which the API rejects (DUSTSEC.20). That review also tightened the fix: the first exemption would have let a bearer value shaped like an id through.
- **A Windows CI failure turned out to be a real bug in merged code:** the vector-store lock treated only `EEXIST` as contention, but on Windows an exclusive create on a busy file fails with `EPERM`, `EACCES` or `EBUSY`. One platform-gated, bounded fix covered three earlier flakes.
- **The dogfood's own grade was weak** (the agent had also read the project docs and wrote the fixes itself).

## Lessons

- A fact-check against code is not optional for marketing copy: three drafts written by agents told to stay inside a ledger still contained a false sentence, a banned word and a wrong inference, and the ledger itself was out of date by the time it was reviewed.
- Land a fix that changes what a claim says before the draft that cites it, or the draft is wrong the day it merges.
- A docs-only change can fail CI: run the full `golem verify`, not only the wiki check (the plan-task test rejects a task brief under 200 characters and an `owner: user` task with no reason).
- Delete a branch only after its pull request shows MERGED. A cleanup that ran on a failed gate deleted a live branch and closed its PR; the branch was recovered from its commit.
- A conflict-resolution script that fails an assertion before it writes must stop the rebase: a conflicted file was committed once with its markers and caught before it was pushed.
- The harness does not let subagents write report files, so the orchestrator transcribes review results.
- A passing "recent failures were flakes" story is a hypothesis: a Windows failure that repeated across runs was a real defect.

## Follow-ups filed

`DUSTSEC.21` (encoded and non-JSON bodies, a JSON array or scalar sent to the messages route, no size bound on the redaction walk), `DUSTSEC.22` (secret runs over 128 characters are never sweep candidates), `windows-handrolled-rename-sweep` (about 17 modules still use a bare rename), `skill-opt-out-sticks` (a deleted skill is re-seeded by `golem init`), `DUST4.6` (parallel worktrees and a non-Golem repo layout were not exercised by the dogfood), and the earlier `proxy-runtime-webcache-windows-flake`.
