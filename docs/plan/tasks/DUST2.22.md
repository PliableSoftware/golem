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

Roadmap gap (DUST1.6 row 17): the persona/prompt docs promise a team-wide prompt delivered
through the `team` origin, merged per field, with the project layer outranking team. Today only
part of that path exists; evidence in DUST1.6.

## The work

1. Trace how persona prompt fields are read today and which origins they consult.
2. Add the team origin as a source, merged per field (not whole-object replace).
3. Tests: team-only value applies; project value wins; partial team object merges.

## Out of scope

- G3/S18: where enforced team policy must apply across all config loads — open, USER.
