---
description: Send the next request(s) untouched — bypass Golem compression
invocationMode: user
---

<!-- golem:layering-exception off — a true full bypass turns REDACTION off, so
     it is a CLI-only setting (R11.1/ADR-0004). Naming the command for the user to
     run in their OWN terminal is the point, not a shortcut around a tool. -->

The user wants to bypass Golem's compression pipeline.

Two different things, in increasing order of what they switch off. There is no
per-request bypass: the old `x-golem-bypass` header and the
`/__golem/pipeline/*` admin endpoint were removed, so neither changes anything.

1. **Compression off, redaction still on** — `golem compression off`. This is
   the usual answer: lossless forwarding with secrets still redacted.
2. **A true full bypass, redaction included** — `golem off`, which persists
   `proxy.bypass_all` (it is the ONLY way to turn redaction off) and takes effect
   when the proxy next starts: `golem proxy restart`. Tell the user plainly that
   secrets and PII then reach the upstream unredacted until they run `golem on`
   and restart. The user runs it in their own terminal. Do not run it yourself.

What is actually enforced, so you claim no more than that: a PreToolUse hook
DENIES an agent Bash call that runs `golem off` or `golem config set` on
`proxy.bypass_all` (or sets `GOLEM_PROXY_BYPASS_ALL`), and a Write or Edit of a
`.golem/*.json` file that sets it. It holds at every autonomy level. It is NOT a
sandbox: a shell that writes a settings file another way, or an obfuscated command,
is not caught. The MCP tools cannot set it at all.

Even with the bypass on, the proxy still refuses a request body over
`proxy.max_request_body_bytes` (413) and caps the request bytes held across
concurrent requests (503). Those are memory-safety limits, not redaction: nothing is
decoded, scanned or redacted in bypass mode, and "full bypass" means exactly that.

Then remind them to run `golem compression 1` (or their previous value) to
re-enable savings when done, and `golem on` if they used option 2 — every status
surface shows the bypass while it is on, so it is not a state to leave behind.
