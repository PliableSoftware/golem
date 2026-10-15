---
task: DUSTSEC.9
title: "Redact vibe sources.json and candidates.jsonl before write"
state: done
owner: agent
size: S
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R7 (USER, 2026-10-08); SUMMARY.md S15, Gaps 1.8/r049; DUST1.8 #7"
gate: "Probe: a candidate note and a source entry containing a fake AWS key are stored with a placeholder in candidates.jsonl and sources.json (before: raw). Existing brief redaction unchanged. golem verify green by exit code."
depends_on: [DUSTSEC.8]
touches: [src/vibe, tests/unit/vibe]
created: 2026-10-08
updated: 2026-10-08T10:26:12.063Z
---

## What this is

The Personal Vibe Guide says every byte is redacted, but only the brief is
(`src/vibe/store.ts:141`). `sources.json` and `candidates.jsonl` (free-text notes) are written raw.

**USER decision (verbatim, R7):** widen redaction to vibe `sources.json` and `candidates.jsonl`.

## The work

1. Find every writer under `src/vibe/` for both files; route string fields through the same
   redactor DUSTSEC.8 makes plugin-aware. For `sources.json`, decide which fields are paths/ids that
   must stay usable — redact free text, and say in the PR what was left and why.
2. Existing on-disk files are not rewritten by this task; note it in the PR.
3. Tests per the gate.

## Hard rules

- Redaction never weakened or reordered.

## Out of scope

- Migrating existing user files. Wiki wording (DUST2.7).

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.

## Outcome

shipped; independently reviewed twice (DUSTSEC.17 and DUSTSEC.18 hold the follow-ups)
