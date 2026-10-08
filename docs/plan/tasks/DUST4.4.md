---
task: DUST4.4
title: "Dogfood /golem-dust Phase 1 on a small slice by an agent that has only the skill, and record what the skill got wrong"
state: done
owner: agent
size: M
discipline: code
design: "The installed .claude/skills/golem-dust/SKILL.md (after DUST4.1-DUST4.3) is the only method input. Slice: the Change Ledger (docs/wiki/concepts/Change Ledger.md, the checkpoint skill and the matching spec text, against src/cli/checkpoint.ts and the ledger code it calls)."
gate: "docs/plan/audit/dust-4-dogfood/ holds the audit note the run produced and a FINDINGS.md that lists every place the skill was wrong, missing or ambiguous, each with what the agent did and what the skill should say; each skill defect is either fixed in src/cli/skills/dust.ts (with tests still green) or filed as a follow-up task doc; no product code changed."
depends_on: [DUST4.1, DUST4.2, DUST4.3]
touches: [docs/plan/audit/dust-4-dogfood, src/cli/skills/dust.ts, .claude/skills/golem-dust, docs/plan/tasks]
created: 2026-10-08
updated: 2026-10-08T23:21:54.032Z
---

## What this is

A test of the skill, not of the code. The question is whether an agent that has never seen this repo's Dust history can run Phase 1 from the skill alone and produce a usable audit note.

## How

1. In a fresh worktree off `development`, dispatch ONE agent whose prompt is: run `/golem-dust` Phase 1 on the slice named in `design`, and nothing else. Do not hand it the Dust debriefs, `DECISIONS.md`, `SUMMARY.md` or this brief: they are what the skill is supposed to replace, and an agent that reads them is not testing it.
2. Keep the slice small. The Change Ledger is one concept page, one skill and a few source files, it has a debrief (`2026-07-31-r8.9-change-ledger.md`) and it was not one of the Phase 3 hot spots. If it turns out larger than about a dozen claims, narrow it and say how. A small second project (a scratch repo with `golem init` run in it) is an acceptable alternative if this repo's slice is contaminated by the agent having the wiki in its KB; say which and why.
3. Run the partition step with two sub-partitions (for example, the CLI surface and the ledger store) so the parallel-worktree and mechanical-recount steps are exercised, not just described.
4. Grade the result yourself, separately from the agent: re-check a sample of its classified rows against the code, and compare its counts with its own tables.
5. Record in `FINDINGS.md`: every instruction the agent misread, skipped, could not follow in a non-Golem layout, or followed literally into a bad result; anything it needed that the skill did not say; and whether any classification was wrong.

## Out of scope

- Phases 2 and 3 of the method on the slice. Phase 1 only.
- Fixing any drift the audit finds in the Change Ledger. File it as a normal task if it is real.
- Rewriting the skill wholesale. Small wording fixes go into `dust.ts` with tests; anything larger is a follow-up task doc.

## Outcome

shipped; see the Phase 4 and 5 debrief
