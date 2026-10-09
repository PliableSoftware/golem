---
title: Skill Opt-Out
type: concept
tags: [init, skills, provenance, guidance]
sources: ["src/cli/init-skills.ts", "docs/plan/tasks/skill-opt-out-sticks.md", "tests/integration/cli-init-dust-skill-lifecycle.test.ts"]
created: 2026-10-09
updated: 2026-10-09
---

# Skill Opt-Out

Deleting a Golem skill (`.claude/skills/golem-<cmd>/`) sticks. `golem init` keeps an
already-offered record in `.golem/state/skills-offered.json`, the same idea as
`seededByDefault` for guidance rules. Offered and absent means declined, so init reports
it as skipped and does not re-create it.

- A skill never offered (new in a later release) is created once, then recorded.
- Provenance is unchanged: an edited skill is `owned`, kept and reported, and
  `--restore-skill` never overwrites it. The managed-files hash is untouched.
- No record yet: init infers "offered" from the skills on disk, so a skill deleted before
  the record existed is re-offered once.
- The record is machine-local (gitignored `.golem/state/`), so a fresh clone with a
  skill deleted in git is re-offered it once.
- **Recourse:** `golem init --restore-skill <cmd>` (repeatable, or `all`).
- `golem uninit` removes the record, so the next init offers everything again.
