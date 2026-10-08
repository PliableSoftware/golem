---
task: DUST5.1
title: "Keep draft marketing prose out of local answers: exclude docs/marketing/ from local-answer sources"
state: queued
owner: agent
size: S
discipline: code
design: "src/knowledge/local-answer.ts:29 (WORKING_DOC_RE excludes only docs/plan/) and isProseSource; spec Decision 33 and DECISIONS.md A12 (source set is any markdown outside docs/plan/); .claude/rules/golem-local-answer.md."
gate: "A failing-first unit test shows isProseSource('docs/marketing/x.md') is true before and false after; docs/plan/ still excluded; wiki, spec, README still eligible; the spec Decision 33 note and the Local Answer wiki page name the new exclusion; golem verify exit 0."
depends_on: []
touches: [src/knowledge/local-answer.ts, tests/unit/knowledge, docs/golem-spec.md, docs/wiki/concepts]
created: 2026-10-08
---

## What this is

Phase 5 writes draft marketing copy under `docs/marketing/`. Today the proxy's local answer serves extractive quotes from "any markdown outside `docs/plan/`" (A12), so a draft blog line could come back to a user as a local answer from "the project knowledge base". Drafts are by definition unverified and promotional; they are not durable knowledge.

This is the one code change in Phase 5. PLAN.md says Phase 5 does not touch code; it lands first and on its own so the drafts never become sources. The alternative, putting the drafts under `docs/plan/marketing/`, needs no code but goes against the requested location; if the user prefers it, cancel this task and move the path in DUST5.2-DUST5.6.

Widen `WORKING_DOC_RE` to also match `docs/marketing/`. Keep it an explicit list of directories, not a broader glob.

## Out of scope

- A configurable exclusion list.
- Excluding `docs/marketing/` from the vector index or `search`. Being findable by search is fine; being quoted as an answer is not.
- Any other change to local-answer confidence or scope.
