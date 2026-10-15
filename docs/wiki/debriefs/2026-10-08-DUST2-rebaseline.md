---
title: "Dust Phase 2: the spec, wiki and ADR rebaseline"
type: debrief
tags: [dust, dust2, rebaseline, spec, wiki, adr, docs-drift, fact-check]
sources: [docs/plan/audit/dust-1/SUMMARY.md, docs/plan/audit/dust-1/DECISIONS.md, docs/plan/tasks/DUST2.26.md, docs/golem-spec.md]
created: 2026-10-08
updated: 2026-10-08
---

# Dust Phase 2: the spec, wiki and ADR rebaseline

Closes DUST2.1-DUST2.10 and DUST2.24 (PRs #225, #230-#240). The audit that produced the work is [[Dust Phase 1 — eleven audits, one baseline]]; the security fixes that ran alongside are in the debrief `2026-10-08-DUSTSEC-security-batch.md`.

## Outcome

- `docs/golem-spec.md` is rebaselined to v1.33. Sections 1-8 describe what the code does; decision numbers are unchanged and each decision keeps its text with a dated rebaseline note. Three new sections hold the open contradictions (10), every default-rule choice (11) and a gap register (12).
- About forty wiki concept pages, ten syntheses and sources, and nine ADRs were corrected. ADR-0009 is new (the polling watcher), and ADR-0001 is marked superseded by it. Accepted decision text was not rewritten: each drifted ADR got a dated amendment note.
- `WIKI.md` lists the six pages that were missing, and the ADR line is current.
- The hard rule in `CLAUDE.md` now reads "lossless and prefix-stable at level <= 1" (decision C1), and the README, spec, wiki and code strings follow.
- Code-owned claims (tool descriptions, comments, CLI and dashboard labels) were corrected in a strings-and-comments pass. The one behaviour-visible change is a wider `coder` `outputSchema`, which matches what the result builder already emits.
- Four contract suites were added under `tests/contract/` (ConversationStore, JoinQueue, SessionEvent, and level <= 1 recorded shapes), each shown to fail when the code under test is broken.

## Default rules applied

The DEFAULT RULE was "doc follows shipped code, unless the item touches security, a hard rule or a recorded USER decision". Every choice made under it is listed in spec section 11 so any can be overturned. Two were flagged because a recorded decision may be touched: A11 (local answer is on by default, against D7) and G5 (the panel writes `project` scope, against D58(f)).

## Open exceptions, not decided

G3, M2, H2, P3, P4 and the fleet question (DUST2.25) are listed as OPEN in spec section 10 and on the pages they touch. DUSTSEC.10 (R8, no relay-connected signal at the hook) is also open for a USER decision; ADR-0002 records it.

## Review

A sampled fact-check of the merged result found 54 of 58 claims true and 4 false (VERDICT: concerns). No behaviour problem, no claim that decided an open item. The review also found a conflict with decision C1 left in the README and an ADR-0002 passage that offered to reopen R8. Both were fixed in #240.

## Lessons

- **Line anchors drift when comment edits land last.** The code-comment pass merged after the docs had cited `file:line`, shifting 27 anchors by one or two lines. They were repaired exactly by mapping each cited line through that pass's own diff hunks. Land comment passes first, or cite a symbol as well as a line.
- **A passing checker is not a complete one.** `golem wiki check` flags only unlisted debriefs, so six unlisted pages passed it. Tracked as `wiki-check-unlisted-pages`.
- **A no-behaviour-change pass should stay one.** The comment pass found two real defects and left them alone on purpose; they are tracked as `dust-comment-pass-code-defects`.
- **The audit was wrong in places.** S10 (redaction idempotence) is narrower than the SUMMARY states, and the audit's claim that step-up paths are never passed is wrong: the write path ignores the relock and step-up minutes settings, and step-up is wired only on the session host's conversation route.
- **The review gate cannot be satisfied run by run for old backlog.** Thirteen runs were genuinely reviewed across the batch; the rest were waived with recorded reasons.

## Follow-ups filed

`roadmap-generator-quoted-titles`, `wiki-check-unlisted-pages`, `stale-committed-to-git-claims`, `dust-comment-pass-code-defects`. Phase 3 (refactor) is now unblocked: Phase 2 is merged and the `DUSTSEC` tasks have landed, except DUSTSEC.10.

## Sources

- `docs/plan/audit/dust-1/SUMMARY.md`, `docs/plan/audit/dust-1/DECISIONS.md`
- PRs #225, #230-#240
