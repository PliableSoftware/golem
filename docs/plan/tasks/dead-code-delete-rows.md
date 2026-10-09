---
task: dead-code-delete-rows
title: "Delete the dead public surface the Phase 3 audit recommended deleting (USER decision DEAD)"
state: queued
owner: agent
size: L
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md DEAD (USER, 2026-10-09); the NEEDS-USER proposal table in docs/plan/audit/dust-1/PHASE3-INDEX.md (25 rows: public config keys, CLI commands, MCP surface, plugin seams, frozen-interface fields), each with evidence and a recommendation; docs/plan/tasks/DUST3.1.md, DUST3.2.md and the other DUST3.* briefs for the per-area evidence."
gate: "Only the rows whose recommendation is delete are executed; every 'keep' row is left alone and recorded as deliberately kept; each row is RE-VERIFIED against the current code first (the table predates a lot of merged work) and dropped with a note if it no longer holds; one reviewed PR per area (config, CLI, MCP, plugin seams, frozen interfaces), never one giant PR; for each deletion a grep proof over src, tests, docs, skills and the VS Code extension shows zero references including string lookups and dynamic imports; a config key being deleted keeps being ACCEPTED on read with a one-time deprecation warning for one release if the audit shows any user could have set it (never a hard failure on an old settings file); a deleted CLI command or MCP tool has its help, skills, wiki pages and generated files updated from source; frozen-interface changes carry the contract amendment and updated contract tests and are called out in the PR; test count drops only by tests of deleted symbols (state which); golem verify exit 0 per PR; an independent read-only review before merging any PR that touches src/interfaces or a public surface."
depends_on: []
touches: [src/config, src/cli, src/mcp, src/plugins, src/interfaces, docs, tests]
created: 2026-10-09
---

## What this is

The user approved executing the delete rows. Start by reading the table and writing, in this task, a list of the rows you will execute and the rows you are leaving, with one line of evidence each, and commit it before deleting anything so the decision is reviewable. Do the zero-risk rows first. Anything a test pins as intended behaviour needs the test rewritten or the row dropped with a reason.

## Out of scope

- The 'keep' rows and anything not in the table.
- Renames or refactors beyond deletion.
