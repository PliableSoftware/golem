# DUST1.1 — redaction, security, pipeline core and proxy: audit findings

_In progress. Findings so far are recorded; sections fill as the audit proceeds._

## Headline findings (confirmed by probe against `dist/` built from `fd3aedc`)

1. Plugin stage that mutates `body` in place skips the post-plugin redaction re-run (`src/pipeline/pipeline.ts:587`, `:601`) — raw secret forwarded.
2. `connection-password` re-matches its own placeholder (`src/pipeline/redaction-rules.ts:197`) — redaction not idempotent for that kind.
3. `isPathLikeToken` rejects any chunk containing `=`/`+` (`src/pipeline/redaction-rules.ts:352`) — `VAR=/path/<uuid>` and `--flag=/path/<uuid>` still redact.
