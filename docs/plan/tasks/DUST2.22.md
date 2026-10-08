---
task: DUST2.22
title: "Team-wide prompt through the team origin, merged per field, project outranks team"
state: queued
owner: agent
size: S
discipline: code
design: "ADR-0008; wiki Team Layer, Persona Registry; SUMMARY.md Gaps 1.6/r017 (P)"
gate: "A persona/prompt field set in the team origin applies when the project does not set it, merges per field, and a project value wins; tests for each. golem verify green by exit code."
depends_on: [DUSTSEC.14]
touches: [src/config, src/inference, tests]
created: 2026-10-08
---

## What this is

Roadmap gap (DUST1.6 row 17).

## Out of scope

- G3/S18: where enforced team policy must apply across all config loads — open, USER.
