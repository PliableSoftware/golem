---
description: Run the Dust shake-out (audit, rebaseline, refactor) when docs and code have drifted after heavy development — not a code review or release gate
invocationMode: user
---

The user wants the Dust shake-out: find where the docs and the shipped code
disagree, make the docs true, then clean the code. Scope: $ARGUMENTS (default:
the whole repo). Work one phase at a time; do not start a phase until the human
has accepted the one before. "The spec" means the spec or design doc, "the wiki"
the wiki or docs tree.

## Phase 1 — audit (read-only)
1. **Partition by subsystem.** One note and one branch per partition, each in its
   own `git worktree` (one HEAD per agent), run in parallel. Auditors write
   notes only, never code.
2. **Classify every documented claim** as matches, drifted, partial, not started
   or contradicted, each with `path:line` evidence.
3. **Close out.** Merge the notes and write a SUMMARY whose counts are recounted
   mechanically from the tables, never added up from the notes' own headers.
   List contradictions for the human; do not resolve them. Flag HIGH security
   items for an out-of-band fix before any refactor.

## Decisions record
The human decides the listed contradictions. Everything else follows the
**default rule: the doc follows the shipped code, unless the item touches
security, a hard rule or a recorded user decision.** Record every choice made
under it (id, outcome, task) so any can be overturned. Leave the exceptions OPEN
and name them.

## Phase 2 — rebaseline
- Wiki and spec follow the verified code, cited `path:line`. Decision text is
  never rewritten; add a dated note. Open contradictions get their own section.
- Every partial or not-started gap gets a task doc or is retired.
- Land code-comment passes before docs cite line numbers, or cite a symbol too.
- Audits are wrong in places: re-check a claim against the code before acting.

## Phase 3 — refactor
1. **Re-verify every audit item against current code.** Drop what no longer
   reproduces, with a note.
2. **Classify each deletion.** Safe: internal, unreferenced, proven by search.
   Needs the human: anything touching public config, CLI, MCP, plugin or
   interface surface. Propose those; do not delete them.
3. **A no-behaviour-change pass needs machine evidence.** Strip comments and
   mask string contents in base and head, then compare. Defects found on the way
   are filed as tasks, not fixed in that pass.

## Review and verification
- **Independent read-only review of every hard-rule change** before merge, by a
  reviewer who did not write it. Authors' green tests prove the new test passes,
  not that nothing got weaker. Review again after fixes: fix rounds introduce
  new defects.
- **Verify serially.** The project's verify command (`golem verify`, judged by
  exit code) runs one at a time; parallel typechecks get killed for memory
  (exit 137) and make "before" baselines unreliable.
- **Merge only on the CI gate for the pushed head**, never an older commit's.
- Merge one PR at a time; never hand-resolve a generated file, regenerate it
  (`golem task index --write` for the roadmap).

## Standing rules for every agent in the run
- Commit early on your own branch.
- At a usage limit, park with a note (`/golem-park`) instead of stopping.
- Never commit the proxy's bracketed REDACTED markers: check bytes before
  quoting anything read through the proxy.
- No attribution trailers in committed content unless the project asks for them.
