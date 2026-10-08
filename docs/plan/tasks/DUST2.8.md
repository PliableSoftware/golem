---
task: DUST2.8
title: "Wiki rebaseline: syntheses/sources drift and the WIKI.md index"
state: done
owner: agent
size: S
discipline: write
design: "SUMMARY.md drift group 'wiki: syntheses/' (:736-746) and hygiene 'WIKI.md index' (:749-754)"
gate: "The 8 syntheses/sources rows carry a dated note correcting the drifted claim (syntheses are historical records: annotate, do not rewrite their findings); WIKI.md lists the six unlisted pages and its ten stale descriptions are fixed (incl. :132 ADR-0003 PROPOSED and missing ADR-0004–0008); golem wiki check green by exit code."
depends_on: [DUST2.3, DUST2.4, DUST2.5, DUST2.6, DUST2.7]
touches: [docs/wiki/WIKI.md, docs/wiki/syntheses, docs/wiki/sources]
created: 2026-10-08
updated: 2026-10-08T12:19:11.649Z
---

## Rows

- syntheses: 1.11/r060 `r1.1-net-of-cache-ab.md`, r063 `le2-grounded-refined-coder-quality.md` **HR**,
  r064 `r4-co-developer-core-batch.md`, r065 `r5-autonomy-orchestration-batch.md` (partial),
  r066 (see SUMMARY :742 for the file), r067 `wiki-knowledge-loop-batch.md`
- sources: r070 `agentic-token-saving-techniques.md`, r071 `kimi-k3.md`, r072
  `llm-wiki-second-brain-obsidian.md`
- `syntheses/r1.2-positioning-universal-preprocessor.md`: C1 wording note
- WIKI.md unlisted: `concepts/Context Ledger.md`, `concepts/Hosted-multi-turn-claude-CLI-spike.md`,
  `concepts/Plan Tasks.md`, `questions/wiki-write-autonomy.md`,
  `syntheses/le2-grounded-refined-coder-quality.md`, plus the sixth page named at SUMMARY :752
- WIKI.md stale descriptions (DUST1.11 lists all ten); index entries for any ADR DUST2.3 adds

Runs LAST among the wiki tasks so the index reflects their edits.

## Out of scope

- Teaching `golem wiki check` to flag unlisted non-debrief pages (a code change; note it in the PR).

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.

## Outcome

shipped; fact-checked by sampling (58 claims), follow-ups in PR 240
