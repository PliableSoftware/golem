---
task: skill-opt-out-sticks
title: "Deleting a Golem skill does not stick: the next `golem init` re-seeds it, because skills have no already-offered record"
state: queued
owner: agent
size: M
discipline: code
design: "Guidance rules solved the same problem with the offered record in `.golem/state/guidance.json` (`seededByDefault` in `src/hooks/guidance.ts`). The provenance rule stays: a skill the user edited is `owned` and kept. Decide whether the record is per skill or a user-facing `golem skills disable <cmd>`; a design call, not assumed here."
gate: "Integration test: init, delete `.claude/skills/golem-<cmd>/`, init again — the skill is NOT recreated and the report says it was declined; an explicit opt-back-in recreates it. Applies to every `P0_SKILLS` entry, not one. Replaces the pin in `tests/integration/cli-init-dust-skill-lifecycle.test.ts` (`re-seeds a deleted skill`). golem verify exit 0."
depends_on: [DUST4.2]
touches: [src/cli/init-skills.ts, src/cli/managed-files.ts, tests/integration]
created: 2026-10-08
---

## The defect

`installSkills` treats a missing `SKILL.md` as `absent` and writes it again, so a
user who removes a skill they do not want gets it back on the next init. All
skills, not just `/golem-dust`.

Evidence:

- `src/cli/init-skills.ts:105` sets `existing = null` when the read fails, and
  `src/cli/init-skills.ts:110` passes it to `classifyManaged`.
- `src/cli/managed-files.ts:200` returns `"absent"` for `onDisk === null`, with
  no distinction between "never installed" and "installed, then deleted".
- `src/cli/init-skills.ts:131` maps `absent` to a `create` action and the
  following write recreates the file.
- Pinned by `tests/integration/cli-init-dust-skill-lifecycle.test.ts`
  (`re-seeds a deleted skill on the next init`), which passes today.

Guidance rules do not have this problem: `src/hooks/guidance.ts` records which
defaults a project was already offered, so a removed rule stays removed.

## Out of scope

- Changing which skills are seeded by default (DUST4.2 decided: all of them).
- Team skills (`golem-team-*`).
- Weakening provenance: an edited skill must still be kept and reported.
