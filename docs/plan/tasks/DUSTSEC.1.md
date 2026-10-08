---
task: DUSTSEC.1
title: "Proxy pipeline error: redact-then-forward, fail closed (5xx) if redaction throws — never forward raw"
state: queued
owner: agent
size: M
discipline: code
design: "docs/plan/audit/dust-1/DECISIONS.md R1/S3 (USER, 2026-10-08); SUMMARY.md S3; DUST1.1 headline 1"
gate: "A probe that throws from each named throw site (compression.compress incl. a failed CCR blob write, policy(), onEvent, substituteKnownContent, applyBrevity, buildContextLedger, sessionRecorder.snapshot()) forwards a body with the secret REDACTED — it forwarded the raw key before; a probe where redaction itself throws gets a 5xx and nothing reaches upstream. The fail-open test at tests/integration/pipeline-proxy.test.ts:191 is rewritten to pin the new behaviour. golem verify green by exit code."
touches: [src/proxy/server.ts, src/pipeline, src/compression/local-blob-store.ts, tests/integration/pipeline-proxy.test.ts]
created: 2026-10-08
---

## What this is

Out-of-band HIGH security fix, lands before Dust Phase 3. Today any throw inside
`pipeline.process()` forwards the ORIGINAL request (`src/proxy/server.ts:346-356`, comment
"FAIL-OPEN"), so a full disk during a CCR blob write sends a raw secret upstream at compression ≥ 1.

**USER decision (verbatim, R1/S3):** on any pipeline error the proxy REDACTS THEN FORWARDS
(re-run redaction alone on the original body); if redaction itself throws, FAIL CLOSED with 5xx.

## Evidence (SUMMARY.md S3)

- Catch site: `src/proxy/server.ts:346-356` (forward stays the original body)
- Reachable via `src/compression/local-blob-store.ts:61-89` → `NativeLosslessCompression.compress` rejects
- Probed throw sites: `compression.compress`, `policy()`, `onEvent`
- Unguarded throw sites to cover: `substituteKnownContent`, `applyBrevity`, `buildContextLedger`, `sessionRecorder.snapshot()`
- Test pinning raw fail-open: `tests/integration/pipeline-proxy.test.ts:191`

## The work

1. Find where the redaction stage can be invoked alone (the stage-1 redaction in `src/pipeline/`).
   The fallback path calls exactly that on the original body. It must be the SAME redaction
   (same rules, same order, plugin rules included) — not a copy.
2. Restructure the catch: pipeline throw → redaction-only pass → forward; redaction-only throw →
   respond 5xx with a Golem-attributed error body, forward nothing, surface via `onPipelineError`.
3. Rewrite the `:191` test. Add one test per throw site listed above (recorded-shape: assert the
   upstream-received bytes contain the placeholder, never the secret).
4. Update the comment at the catch site to state the new contract.

## Hard rules

- Redaction never weakened or reordered. The fallback adds a redaction pass; it never skips one.
- `proxy.bypass_all` stays the single redaction-off path; a bypassed request is not affected by this change.
- Lossless and prefix-stable at level ≤ 1 (C1 rewording of the byte-faithful rule): an untouched request still forwards its original bytes.
- `src/interfaces/` is frozen: if a contract type must change, update its tests and flag dependents in the PR.

## Out of scope

- Removing `/__golem/pipeline/*` and `x-golem-bypass` (DUSTSEC.2 — same file; land this first).
- S8 (plugin mutating `body` in place skips re-redaction), S9, S10 — Phase 3.
- Changing which stages run at which level.

## Verification bar

`golem verify` green by exit code. Commit early on your own branch.
