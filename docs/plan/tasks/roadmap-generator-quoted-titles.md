---
task: roadmap-generator-quoted-titles
title: "The ROADMAP generator renders quoted title values with literal backslash-quotes"
state: queued
owner: agent
size: S
discipline: code
design: "Found by DUST2.9 (2026-10-08): about 65 plan task docs have a quoted title: value, and the generated ROADMAP index prints the escaped quotes literally (DUST2.1 and DUST2.9 are examples). Tasks must stay parseable; the generator is the defect."
gate: "A task doc whose title contains an escaped double quote renders in ROADMAP.md with plain quotes; a unit test fails on the old generator; golem task index --write leaves no literal backslash-quote in the index; golem verify exit 0."
depends_on: []
touches: [src/tasks, tests]
created: 2026-10-08
---

## What this is

The index generator copies the raw frontmatter string instead of the parsed YAML value, so a title written as a quoted YAML string with escaped quotes shows the escapes. Fix it in the generator, not by editing 65 docs.

## Out of scope

- Re-quoting or rewriting existing task docs.
- Changing the task frontmatter schema.
