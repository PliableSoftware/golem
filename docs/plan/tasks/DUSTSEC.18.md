---
task: DUSTSEC.18
title: "Second-review follow-ups to DUSTSEC.17: local-layer portal link, token POST redirects, bypass-guard gaps and heredoc false deny, classifier quoting, keygen false refusal"
state: queued
owner: agent
size: M
discipline: code
design: "Second independent golem-reviewer pass over PRs #221-#224, 2026-10-08, VERDICT: concerns (no High). Original DUSTSEC.17 findings: B and D closed, A and C partly closed. USER decisions in docs/plan/audit/dust-1/DECISIONS.md stand."
gate: "Each finding below has a regression test that fails on the merged code and passes after; golem verify exit 0."
depends_on: [DUSTSEC.17]
touches: [src/portal, src/hooks/bypass-guard.ts, src/autonomy/classify.ts, src/buzz/identity.ts, tests]
created: 2026-10-08
---

## Findings

**Portal (`src/portal`)**
- MED `config.ts:83`: the `local` layer is trusted at link time, but git tracks a committed `.golem/settings.local.json` even if it is gitignored, so a repo can ship `portal.url`/`portal.issuer` and `golem team link` binds the token to that host. Refuse the local layer too, and give `golem team link` an explicit flag for a non-default portal URL so the documented setup still works.
- LOW `exchange.ts:114`: the token POST follows redirects, so a 307/308 resends the refresh token to a host the origin check never sees. Use manual redirect handling and refuse.
- LOW `client.ts:202`: refresh requires `token_endpoint` to share the issuer origin, so a legitimate auth server with a token endpoint on another origin links and can never refresh. Keep strict; make the failure message say why and what to do.

**Bypass guard and classifier**
- MED `bypass-guard.ts:256-281`: not denied: piping the text `golem off` into `sh`, `env -S` with the command as its value, `bash -o pipefail -c` with the command, and a here-string to `bash`.
- LOW `:284`: `textSetsBypass` matches raw text; a JSON key written with a unicode escape for one letter of `bypass_all` is allowed. Parse the JSON.
- LOW `:242`: heredoc bodies are split into commands, so ordinary file writes and commit messages that merely mention the off command are denied (it blocked the reviewer's own scratchpad write, and it blocked this task's own creation). Do not treat heredoc bodies as commands.
- LOW `classify.ts:146`: quote stripping for any git command makes a quoted search term look like a write flag (`git log --grep "--fix"` is `write`), and a backslash escape hides `--output` (`git diff --outpu\t=/tmp/x` is `read`).

**Keygen (`src/buzz/identity.ts:128`)**
- LOW: `/sec/` matches anywhere in a line, so `public key (secp256k1): <hex>` counts as both labels and is skipped, and the parse throws on valid output. Anchor the label match.

## Out of scope

- Re-opening USER decisions; making the guard a sandbox (it is not, and the skill says so).
