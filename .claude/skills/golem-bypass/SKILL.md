---
description: Send the next request(s) untouched — bypass Golem compression
invocationMode: user
---

<!-- golem:layering-exception off — a true full bypass turns REDACTION off, so
     by design no tool call can reach it (R11.1/ADR-0004 moved it to a CLI-only
     setting). Naming the command for the user to run in their OWN terminal is the
     point, not a shortcut around a tool. -->

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
   and restart, and that they must run it in their own terminal: no tool call can
   turn redaction off.

Then remind them to run `golem compression 1` (or their previous value) to
re-enable savings when done, and `golem on` if they used option 2 — every status
surface shows the bypass while it is on, so it is not a state to leave behind.
