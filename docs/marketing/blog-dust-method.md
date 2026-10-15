# What we learned running a docs-and-code shake-out on our own repo

**DRAFT. Not published. Not a source of truth.** See [`README.md`](README.md). Publishing is the user's decision.

Heavy development leaves docs and code out of step. Renames are half finished, specs describe features that changed, and nobody knows which claims still hold. We wrote down a method for cleaning that up and ran it once in full, here, on one project. We do not know that it transfers, and the numbers below are what happened to us, not what you should expect.

## Phase 1: read-only audits in parallel

The first rule is that audits change nothing. We split the documented surface into eleven partitions and gave each its own git worktree. Each auditor checked one subsystem's documented claims against the code and committed one findings note with `path:line` evidence. Then one merge step rebuilt the totals. <!-- DUST1.12 debrief -->

On 2026-09-26 the eleven audits produced 800 table rows, 791 of them classified. 436 matched the code and 194 had drifted. <!-- DUST1.12 debrief -->
Roughly half the documented surface still matched, and about a quarter had drifted. <!-- DUST1.12 debrief -->
Five items were flagged as high-severity security findings for an out-of-band fix. <!-- DUST1.12 debrief -->

The recount step matters. Two of the eleven notes reported tallies that their own tables contradicted, so the roll-up recounts from the tables mechanically instead of adding up the headers. <!-- DUST1.12 debrief -->

## Phase 2: rebaseline docs to the code, with a default rule

For every disagreement someone must decide whether the doc or the code is right, and case by case does not scale. We used one default rule: the doc follows the shipped code, unless the item touches security, a hard rule or a recorded decision by the user. Every choice made under the rule is listed in one section of the spec so any of them can be overturned. Contradictions the rule could not settle are listed as open and left alone for a human. <!-- DUST2 debrief; docs/golem-spec.md section 11 -->

On 2026-10-08 the spec was rebaselined to v1.33. <!-- DUST2 debrief -->
A sampled fact-check of the merged result found 54 of 58 claims true and 4 false. <!-- DUST2 debrief -->
That is not a clean result, and we say so. The same review found a conflict with a hard rule left in the README and a passage in a decision record that offered to reopen an open question. Both were fixed afterwards. <!-- DUST2 debrief -->

The audit itself was also wrong in places. One of its claims about step-up authentication paths was false, and another finding was narrower than the summary stated. <!-- DUST2 debrief --> An audit is a set of claims about code, and it needs the same scepticism as the docs it checks.

## Phase 3: refactor, and re-verify before you touch anything

Before any fix, a planner re-checked every audit item against the current code. On 2026-10-08, 52 items did not reproduce, mostly because earlier work had already fixed them. <!-- DUST3 debrief -->
What remained became 63 confirmed bug fixes and 12 safe deletions. 25 dead-code proposals touching public surface were left for the user rather than decided by an agent. <!-- DUST3 debrief -->
The test count went from 4296 to 4464. <!-- DUST3 debrief -->

## What review caught that green tests did not

Every change on a hard-rule branch, such as redaction, credentials and the review gate, went through a read-only reviewer before merge, and some went through two. In every case below the author's own tests and verify run passed. <!-- DUST3 debrief -->

- The first version of the redaction fix let any password shaped like a placeholder through unredacted, and it refused plugin rules that had worked before. <!-- DUST3 debrief -->
- A credentials change made every credential removal throw on a headless Linux machine. Separately, a pre-existing bug forwarded one provider's credential to another when no key was stored. <!-- DUST3 debrief -->
- A change to the wiki write path then refused five existing wiki pages until a second review caught it. A vector-store fix needed a second round too, after a torn metadata file wedged every write. <!-- DUST3 debrief -->

This is the lesson we would keep if we kept only one. An agent's green tests show that the new test passes. They do not show that nothing else got weaker. Three of the fix rounds introduced a new defect, so budget for a second review. <!-- DUST3 debrief -->

These were reviews by project agents inside this project, not outside audits. We make no claim beyond that, and nothing here is a statement about released builds.

## Where the method nearly failed

Parallelism has a cost. On 2026-10-08, eight agents running the verify gate at once got their typechecks killed with exit 137, so their own "before" baselines were unreliable. We re-ran verify serially before merging. <!-- DUST3 debrief -->

The review gate also could not be satisfied run by run for the old backlog. Thirteen runs in the Phase 2 batch were genuinely reviewed, and the rest were waived with recorded reasons. <!-- DUST2 debrief --> A recorded waiver beats a silent skip, but it is still a gap.

Our own docs showed the same problem. On 2026-10-08 we built a claims ledger for this launch, every claim tied to a code line, and found places where the docs said more than the code does. The README described telemetry as billed-token figures, when the savings numbers are estimates. <!-- CLAIMS.md B-38 --> The spec gave a provider count the code did not support: one named provider is a spawn target, not a proxy upstream. <!-- CLAIMS.md B-34 -->

## Packaging the method, and a weak first grade

The method is packaged as a skill, `/golem-dust`. We did not take it on trust. On 2026-10-08 one agent followed the skill text literally on a small slice, the Change Ledger, and recorded every place the text was wrong, missing or ambiguous. It produced a 46-row audit table: 38 matches, 2 drifted and 6 partial. <!-- dogfood SUMMARY.md -->
It also found 11 defects in the skill text. Nine were fixed and two were filed as a follow-up task. <!-- dogfood FINDINGS.md -->
The missing pieces were basic: no table shape, no definition of the five classes, no unit for a "claim", and no guidance for a claim the code cannot settle. One more was subtle. A truncated file read looks like a complete read, and the agent only noticed because it checked. <!-- dogfood FINDINGS.md -->

The honest grade was weak. The agent had also read the project's `CLAUDE.md` and the Dust Method wiki page, and it wrote the fixes itself. It did not independently re-grade the 38 matching rows, and one partition does not exercise the parallel and cross-note parts of the method. <!-- dogfood FINDINGS.md -->
Those untested parts are filed as follow-up work. <!-- dogfood FINDINGS.md -->

## What we would tell you

- Keep audits read-only, and give each auditor its own worktree.
- Recount totals from the tables, never from the notes' own headers.
- Decide the default rule before the rebaseline, and list every choice made under it.
- Re-verify each audit item against current code before fixing it. In our run, 52 items had already gone away. <!-- DUST3 debrief -->
- Review the branches that guard hard rules, and plan for a second round.
- Run the gate serially at the end.

This is one project's run. If you try `/golem-dust` on your own repo, keep a debrief in the same form so the runs can be compared.
