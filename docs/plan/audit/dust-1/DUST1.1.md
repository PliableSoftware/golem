# DUST1.1 — redaction, security, pipeline core and proxy: audit findings

_In progress. Findings so far are recorded; sections fill as the audit proceeds._

## Headline findings (confirmed by probe against `dist/` built from `fd3aedc`)

1. Plugin stage that mutates `body` in place skips the post-plugin redaction re-run (`src/pipeline/pipeline.ts:587`, `:601`) — raw secret forwarded.
2. `connection-password` re-matches its own placeholder (`src/pipeline/redaction-rules.ts:197`) — redaction not idempotent for that kind.
3. `isPathLikeToken` rejects any chunk containing `=`/`+` (`src/pipeline/redaction-rules.ts:352`) — `VAR=/path/<uuid>` and `--flag=/path/<uuid>` still redact.
4. Any throw inside `GolemPipeline.process()` forwards the ORIGINAL unredacted request (`src/proxy/server.ts:350-356`, fail-open by design). Probed: throwing `compression.compress`, `policy()`, or `onEvent` sink each put a raw AWS key upstream.
5. Unauthenticated `POST /__golem/pipeline/false` (`src/proxy/server.ts:206-211`) disables the whole pipeline, redaction included, live, without persisting `proxy.bypass_all` — no Origin/auth check (probed with a foreign `Origin`: 200, raw key forwarded).
6. `x-golem-bypass` header (`src/proxy/server.ts:350`, `src/proxy/headers.ts:86`) is a per-request redaction-off path outside `bypass_all`.
7. `redactValue` never redacts object KEYS (`src/pipeline/redaction.ts:287-290`) — probed: secret as key survives, count 0.
