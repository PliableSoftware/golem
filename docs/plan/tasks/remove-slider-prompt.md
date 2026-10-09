---
task: remove-slider-prompt
title: "Remove the retired slider prompt from the frozen MCP prompt set and amend the contract (USER decision M2)"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md M2 (USER, 2026-10-09); SUMMARY.md contradiction M2; ADR-0004 (the slider was retired). The frozen prompt set still lists a slider prompt."
gate: "The slider prompt is no longer registered by the MCP server or listed anywhere in the prompt set; the frozen prompt-set contract (find it under src/interfaces and its contract test) is amended with a dated note and its test updated; nothing else in the repo (skills, docs, wiki, the Tool Search figures, the golem-compression skill, the dashboard) still points users at it, with each remaining mention rewritten to the compression dial; a test shows the prompt list no longer contains it; golem verify exit 0 and the generated skills and docs regenerated from source, never hand-edited."
depends_on: []
touches: [src/mcp, src/interfaces, src/cli/skills, docs/wiki, docs/golem-spec.md, tests]
created: 2026-10-09
updated: 2026-10-09T12:54:07.422Z
---

## What this is

The recommendation was to keep the prompt name as a rewritten pointer so the frozen contract stays stable; the user chose to remove it. That is a breaking change for anything that lists or calls the prompt, so say so in the contract note and the changelog entry (a `golem` release note, not a marketing draft). Check the Tool Search token figures, which counted the prompt, and update the dated figures.

## Out of scope

- Any other prompt in the set.

## Outcome

shipped (PR merged with CI gate green; not independently reviewed, not a hard-rule change)
