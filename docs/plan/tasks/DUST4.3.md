---
task: DUST4.3
title: "Document the Dust method: wiki concept page, debrief template in the skill, README line and a spec 5.1 mention"
state: queued
owner: agent
size: M
discipline: write
design: "DUST4.1 (the skill text is the source); the three Dust debriefs; docs/plan/audit/dust-1/DECISIONS.md (the default-rule table is the worked example); docs/golem-spec.md section 5.1; docs/wiki/WIKI.md."
gate: "docs/wiki/concepts/Dust Method.md exists with frontmatter, real [[wikilinks]] and is listed in WIKI.md; the skill gains a 'Debrief template' section and a unit test pins its headings; README has one line naming /golem-dust; spec 5.1 names the skill and points at the wiki page; `golem wiki check` exit 0; golem verify exit 0."
depends_on: [DUST4.1]
touches: [docs/wiki/concepts, docs/wiki/WIKI.md, README.md, docs/golem-spec.md, src/cli/skills/dust.ts, tests/unit/cli/skills.test.ts, .claude/skills/golem-dust]
created: 2026-10-08
---

## What this is

The prose around the skill. Four pieces:

1. **Wiki page `docs/wiki/concepts/Dust Method.md`.** What the method is, when to run it, the three phases, the default rule, and what this repo learned running it (link the three debriefs and [[Redaction Stage]], [[Plan Tasks]], [[Guidance Rules]]). Point at the skill as the canonical step list instead of restating it; the page explains *why*, the skill says *what to do*. Cite the numbers from the debriefs as this project's run, dated, not as expected results. Add it to `WIKI.md` (`golem wiki check` only flags unlisted debriefs, see `wiki-check-unlisted-pages`, so check the listing by eye).
2. **Debrief template**, as a `## Debrief template` section at the end of the skill body in `src/cli/skills/dust.ts`. It has to travel with the skill to other projects, and a skill is one file, so it lives there and not in this repo's wiki. One template per phase-end: Outcome (counts, recounted from tables), What review caught, Default-rule choices and open exceptions, Lessons, Follow-ups filed, Sources. Shape it on the three debriefs. Then re-run `golem init` here and commit the refreshed `.claude/skills/golem-dust/SKILL.md`. Add a unit test pinning the template's headings.
3. **README**: one line in the skills list or feature list naming `/golem-dust` and what it is for. No more.
4. **Spec**: one sentence in section 5.1 after the command table (the table lists command surfaces; check whether `/golem-dust` belongs as a row or a sentence by how the other method skills appear, and follow that). Do not bump the spec version for it; add it the way Phase 2 added dated notes if the file has a convention for that.

## Out of scope

- Any change to the method itself. If writing the page shows a gap in the skill, note it in the DUST4.4 dogfood record instead.
- Marketing prose about Dust (DUST5.6).
- Rewriting the existing Dust debriefs.
- Restating `DECISIONS.md` in the wiki page; link it.
