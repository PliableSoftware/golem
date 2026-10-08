---
title: ADR-0002 — Cruise-control autonomy modes & approval gates
type: adr
tags: [r5, autonomy, security, hooks, threat-model]
sources: [docs/plan/proposals/r5-autonomy-orchestration-memos.md, docs/golem-spec.md, docs/plan/verification-notes.md]
created: 2026-07-16
updated: 2026-07-16
---

# ADR-0002 — Cruise-control autonomy modes & approval gates

**Status: ACCEPTED (2026-07-16).** Written as the R5.4 build gate (spec Decision
20d is a Risk-table item — "a written threat model reviewed" is required *before*
enforcement code). This ADR is that threat model; the code lands in the same
R5.4 change but is designed against these constraints.

> **Amendment (2026-07-22, spec Decision 40).** The gate is no longer "inert by
> default (manual + not wired)": `golem init` wires the shared PreToolUse hook by
> default for the snooze nudge (Decision 38), and that hook also runs this gate.
> Because outward/destructive force an `ask` at *every* level — including
> `manual` — the gate is effectively active for outward/destructive as soon as
> the hook is wired. To keep "opted into snooze" from meaning "opted into gate
> prompts", the gate now has a separate `enabled` flag (`.golem/state/autonomy.json`,
> ON by default, fail-closed): `golem autonomy disable` turns the *whole* gate
> off (snooze + coder-first nudges keep running); `enable` restores it. The
> level semantics and invariants below are unchanged **while the gate is
> enabled**; disabling is a whole-gate opt-out (like slider level 0, Decision 30),
> not a per-level loosening.

## Context

R5.4 adds a directive layer: the user states an *outcome* and Golem drives the
agent loop at a chosen **autonomy level**, auto-approving low-risk steps so the
user isn't prompted for every read. Auto-approval is inherently dangerous — the
whole feature is a machine that clicks "yes" on the user's behalf. Safety is
therefore the feature, not a wrapper on it (memo R5.4).

Enforcement point (verified, verification-notes §65 + the hooks reference,
fetched 2026-07-16): a **`PreToolUse` hook** returning
`{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow|deny|ask",permissionDecisionReason}}`.
Key verified facts this design leans on:
- A hook that exits 0 **with no stdout** makes NO decision → Claude Code's
  native permission flow runs (it prompts the human for anything not already
  allow-listed). *Silence = defer to the human.* This is our safe default.
- `permissionDecision:"allow"` **auto-approves and skips the prompt** — the only
  output that removes a human from the loop. We emit it narrowly.
- `permissionDecision:"ask"` **forces a prompt** even if the user's allow-list
  would have auto-approved — our tool for making a gate *mandatory*.
- Exit 2 blocks the call (stderr → Claude). We use exit 0 + JSON, never exit 2,
  so a crash can't hard-block a session.

## Decision

### Autonomy levels (per project, explicit, loudly surfaced)

| Level | Meaning |
|---|---|
| `manual` (**default**) | Approve every step. Golem emits nothing → native prompt governs everything. Golem adds no auto-approval. |
| `assisted` | Auto-allow **read-only** actions; writes/destructive/outward/unknown → human. |
| `outcome` | Auto-allow read **and write** actions; destructive & outward always → human; unknown → human. |

**No level ever removes the irreversible/outward gates.** There is deliberately
no "full auto" level. The level is stored in `.golem/state/autonomy.json`
(project-scoped, like the slider) and surfaced in the R5.2 session-state report,
the status line, and `golem autonomy`.

### Action classifier (conservative allow-list)

`classifyAction(tool, input) → read | write | destructive | outward | unknown`.
The governing rule: **anything not positively recognized as read/write is
`unknown`, and `unknown` is never auto-allowed.**
- **read**: Read/Grep/Glob/LS/NotebookRead/WebSearch/WebFetch, Golem read MCP
  tools (search/fetch/stats/expand/level), and a small safe-Bash allow-list
  (`ls`, `cat`, `git status|diff|log`, `npm test`, `tsc`, `vitest`, …).
- **write**: Edit/Write/MultiEdit/NotebookEdit; local drafting (`coder`).
- **destructive**: Bash matching `rm -rf`, `git reset --hard`, `git clean -f`,
  `dd`, `mkfs`, `truncate`, `DROP TABLE`, `del /f`, `rmdir /s`, …
- **outward**: Bash matching `git push`, `gh pr|release`, `npm publish`,
  `curl/wget` with `-X POST|PUT|DELETE`/`--data`, `ssh`, `scp`, `deploy`, … and
  the wiki-write MCP tool (`wiki_upsert`, already "ask" at init).
- **unknown**: any other Bash (a shell can do anything) and any unrecognized
  tool. Gated.

### Decision matrix (decision the hook emits)

| class | manual | assisted | outcome |
|---|---|---|---|
| read | *silent* | **allow** | **allow** |
| write | *silent* | *silent* | **allow** |
| destructive | **ask** (+dry-run note) | **ask** | **ask** |
| outward | **ask** | **ask** | **ask** |
| unknown | *silent* | *silent* | **ask** |

*silent* = emit nothing (native prompt governs). `ask` = force a human prompt.

## Threat model & default-deny proofs

Failure modes and why the design is safe by construction:

1. **Hook crashes / bad stdin / unreadable policy.** Handler catches everything,
   exits 0 with **no stdout** → native prompt. *No path emits `allow` on error.*
   Proven by test: malformed stdin and a missing policy file both produce empty
   output.
2. **Unknown / novel tool or shell command.** Classifier defaults to `unknown`;
   `unknown` is never `allow`. A new destructive capability we didn't enumerate
   fails closed (worst case: `unknown` → human at `outcome`, silent→native
   prompt below it — still never auto-run).
3. **Ambiguous Bash.** Bash is `unknown` unless it matches the *positive* safe
   allow-list; the destructive/outward patterns only *escalate* (never
   downgrade). A command that is both (e.g. `rm` piped to `curl`) resolves to the
   more-restrictive class (outward/destructive → ask).
4. **Level tampering / injection.** The level is read from a zod-validated local
   file; an invalid value parses to the **most restrictive** (`manual`), not the
   least. The level cannot be set from within a tool call (no MCP surface writes
   it) — only the explicit `golem autonomy` CLI.
5. **Removing the human entirely.** Impossible: there is no level whose matrix
   auto-allows destructive/outward. `allow` is only ever emitted for read
   (assisted+) and write (outcome).
6. **Silent scope creep.** Every emitted decision is appended to
   `.golem/state/autonomy-log.jsonl` (tool, class, level, decision, ts) — an
   auditable action log. Activation is opt-in (`golem autonomy wire`), never
   auto-enabled by `golem init`.
7. **Redaction interaction.** The gate observes tool calls; it never transforms
   request/response content and never sits on the proxy path — redaction and
   byte-fidelity are untouched.

## Consequences

- The gate is **inert by default** (level `manual` + not wired). It only removes
  a prompt after the user (a) wires the hook and (b) explicitly raises the level
  — two conscious acts, each loudly surfaced.
- The "drive the loop" outcome level is shipped only with the gate enforcement
  proven (memo's explicit ordering).
- Extending coverage = extending the classifier's positive allow-lists; the
  fail-closed default means an incomplete list is safe, just more prompt-y.

Related: [[Redaction Stage]] (untouched), R5.1 `--permission-mode` plumbing
(a resumed task can pair a launch mode with this gate), verification-notes §65.

> **Amended 2026-10-08 (DUST2.3; DECISIONS.md R8; SUMMARY rows 1.7/r017, 1.7/r019).**
> The decision text above is unchanged and is history. Two things drifted.
>
> **1. Destructive and outward now end in a `deny`, not a human prompt.** The
> `PreToolUse` gate still emits `ask` for both classes at every level
> (`src/autonomy/gate.ts:27-34`). R12.12 added a second, earlier layer: the
> `PermissionRequest` hook returns a real `deny` for `destructive` and `outward`
> whenever the gate is enabled (`decidePermissionRequest`, `src/autonomy/gate.ts:81-86`;
> `src/hooks/permission-request.ts:91-100`). The reason was to stop a connected
> channel's permission relay from being triggered by the dialog opening
> (verification-notes §141). The effect is that a human at the terminal is not
> shown the dialog for these two classes: Claude gets the deny message. `allow`
> is still never emitted for either class, so invariant 5 above holds. What no
> longer holds is the reading "destructive/outward means a human decides".
>
> **USER decision R8 (2026-10-08):** the deny should apply only when a relay
> channel is connected. That is not implemented. DUSTSEC.10 checked first
> whether the `PermissionRequest` hook can observe a connected relay and found no
> signal in the hook payload, an environment variable, or a Golem-owned marker
> (verification-notes, 2026-10-08 DUSTSEC.10 entry). **The deny is currently
> unconditional.** Open question, recorded and not decided here: accept the
> unconditional deny, or build a Golem-owned channel server that writes a
> connected marker. DUSTSEC.10 stays queued until the user chooses. Separately,
> R12.13 is unconfirmed: nobody has observed live whether the deny pre-empts the
> relay (`owner: user`, needs an interactive session).
>
> **2. "Misclassification only escalates; unknown is never auto-allowed" was
> false for newlines.** `SHELL_COMPOSITION_RE` lacked `\n` and `\r`, so a command
> chained on a new line after a safe-listed read could classify as `read`
> (SUMMARY S5). Fixed by DUSTSEC.5 (`7528c67`): the pattern now includes
> both (`src/autonomy/classify.ts:129`, applied at `:318`),
> and `git branch -D`, linter autofix flags and `git diff --output` no longer
> classify as `read`. DUSTSEC.18 (`56983c4`) then judged git write flags on shell
> words, so a quoted search term is data and an escaped flag is still a flag.
