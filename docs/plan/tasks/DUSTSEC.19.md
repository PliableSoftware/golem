---
task: DUSTSEC.19
title: "Redact every JSON request body, not only POST /v1/messages"
state: done
owner: agent
size: S
discipline: code
design: "CLAUDE.md hard rule: redaction must never be weakened; found while building the Dust marketing claims ledger"
gate: "A secret in a count_tokens body, a batches body (requests[].params) and an arbitrary JSON POST is a placeholder at the upstream, also on the redactOnly fail-safe path; GET and non-JSON bodies unchanged; tests/contract untouched and green. golem verify green by exit code."
touches: [src/pipeline, tests/integration]
created: 2026-10-08
---

## What this is

`src/pipeline/pipeline.ts` gated both `process` and the DUSTSEC.1 `redactOnly` fail-safe on
`isMessagesRequest` (POST + `MESSAGES_PATH_RE`, which excludes sub-resources by design). Every
other request, including `POST /v1/messages/count_tokens` (full message array),
`/v1/messages/batches` and any other JSON POST, was forwarded with no redaction. The proxy only
answers count_tokens locally for OpenAI-schema targets (`isCountTokensPath`, `src/proxy/server.ts:90`),
so on the Anthropic upstream the raw body went out.

## The rule

`redactJsonBody` (`src/pipeline/pipeline.ts:329`): for any non-messages request whose body parses as
a JSON object or array, run `redactRequestBody` over it (every string value, keys untouched, same
rules and order, plugin rules included). No compression, policy, observers or other stage. Returns
the original request object when nothing was found. Called from `process` (`:430`, gated on
`policy.stages.redaction`, which is true at every level) and from `redactOnly` (`:409`).
count_tokens uses this walker, not the messages path, so brevity, local answer and injection can
never touch it.

## Out of scope / left as is

- Absent, empty, or non-JSON bodies are forwarded unchanged: they cannot be walked.
- `proxy.bypass_all` still skips the pipeline entirely, as before. No new bypass.
- Bodies that are bare JSON scalars (`"x"`, `1`) are not walked.

Evidence: `tests/integration/pipeline-redact-json-bodies.test.ts`.
