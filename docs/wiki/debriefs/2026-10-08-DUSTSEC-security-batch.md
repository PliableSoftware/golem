---
title: "DUSTSEC: the Dust Phase 1 security batch"
type: debrief
tags: [dust, dustsec, security, redaction, proxy, portal, autonomy, npm]
sources: [docs/plan/audit/dust-1/SUMMARY.md, docs/plan/audit/dust-1/DECISIONS.md, docs/plan/tasks/DUSTSEC.1.md]
created: 2026-10-08
updated: 2026-10-08
---

# DUSTSEC: the Dust Phase 1 security batch

Ships DUSTSEC.1-9 and 11-16 as PRs #213-#219. No task is closed yet: an independent review found follow-ups (see Review), tracked as DUSTSEC.17. DUSTSEC.10 also stays open. The findings came from Dust Phase 1 (`docs/plan/audit/dust-1/SUMMARY.md`); the choices came from the USER decisions in `docs/plan/audit/dust-1/DECISIONS.md`.

## Outcome

- **Redaction cannot be switched off from outside.** The `/__golem/pipeline/*` endpoint and the `x-golem-bypass` header are removed. `bypass_all` is the only exception, and a PreToolUse guard denies agent Bash that sets it. The guard is not a sandbox, and the skill says what it does not catch.
- **A pipeline error no longer forwards the raw body.** The proxy redacts the original and forwards that, and answers 502 if redaction itself throws.
- **Redaction rules are frozen**, plugin rules reach the hook, vibe and join-queue paths, and the vibe `sources.json` and `candidates.jsonl` are redacted.
- **The portal token is bound to the API origin** recorded at link time, https only (loopback http exempt). Tokens linked before this need one `golem team link`.
- **Autonomy classifier:** newline-chained commands, `git branch -D`, linter autofix flags and `git diff --output` are no longer `read`.
- **Buzz keygen parser** can no longer commit the secret as the public key.
- **Config and routing:** `owner: user` binds the worker lane, the shim runs no compression, an unknown `default_target` always fails closed, `inference.worker_targets` is live, and an invalid team value skips the team layer with a warning.
- **npm name:** `golem update`, the installers, `ps` detection and the docs use `@pliable/golem`. Claiming `golem-run` stays a USER task.

## Review

An independent `golem-reviewer` pass over the merged diff returned VERDICT: block. Nothing leaks an unredacted body upstream. The findings:

- **High:** the portal token refresh POSTs the refresh token to a `token_endpoint` that is never origin-checked, and a committed project file can set `portal.issuer`. `team link` also records `api_origin` from a project-settable `portal.url`.
- **High:** the Buzz keygen positional fallback still swaps the keys when label lines carry no hex (bech32 lines first).
- **Medium:** bypass guard misses an Edit that flips only the value, misses common wrappers (`timeout`, `nice`, `sudo -u`, `xargs`), and falsely denies quoted text. An explicit `target` skips the `owner: user` check. `golem acp` never loads plugin redaction rules.
- **Low:** a quoted write flag hides from the classifier, `git branch --contains` regressed to `unknown`, and the shim exemption makes the new fail-closed warning false.

## Lessons

- **The brief was wrong in one place, and the agent said so.** DUSTSEC.4 asked for the issuer origin. In production the issuer and the API are different origins, so that check would have broken every real link. The agent bound to the API origin instead and flagged the deviation.
- **Freezing an array is not freezing its contents.** `re.compile()` still rewrites a frozen RegExp in V8, so the exported rules are a frozen copy with their own RegExp objects.
- **A planned decision can fail its own verify step.** DUSTSEC.10 stopped because the premise (a relay-connected signal) does not exist at the hook. Stopping and recording that was the right outcome; building a signal would have been invention.
- **Removing a side door has a UX cost.** `golem on`/`golem off` now persist but need a proxy restart, because the live toggle was the removed endpoint.
- **Redaction rewrites what an agent writes.** Commit trailers and a few file paths landed as literal placeholders. The repo rule is now: no placeholders in committed content (see the cleanup of four SHIPPED rows in this change).
- **A recurring Windows flake surfaced.** `tests/integration/device-sessions.test.ts` fails with `EPERM` on the atomic rename of `hosted-sessions.json` on Windows. It hit #209, #216 and #219 and passed on re-run each time. Tracked as `device-sessions-windows-eperm`.

## Related

[[Redaction Stage]] (the hard rule these fixes defend), [[Autonomy Gate]] (the classifier fix), [[Redaction Path Placeholders]] (why placeholders appear in committed text), and the audit that found all of this, [[Dust Phase 1 — eleven audits, one baseline]].

## Sources

- `docs/plan/audit/dust-1/SUMMARY.md`, `docs/plan/audit/dust-1/DECISIONS.md`
- PRs #213-#219
