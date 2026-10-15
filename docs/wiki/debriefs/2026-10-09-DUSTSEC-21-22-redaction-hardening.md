---
title: "DUSTSEC.21 and DUSTSEC.22: redaction hardening, and why six review passes were needed"
type: debrief
tags: [dust, dustsec, redaction, review, proxy, hard-rule]
sources: [docs/plan/tasks/DUSTSEC.21.md, docs/plan/tasks/DUSTSEC.22.md, docs/plan/tasks/DUSTSEC.23.md, docs/plan/tasks/DUSTSEC.24.md]
created: 2026-10-09
updated: 2026-10-09
---

# DUSTSEC.21 and DUSTSEC.22: redaction hardening

Closes DUSTSEC.21, DUSTSEC.22 and the Windows rename sweep (PRs #275-#277). These are the two redaction gaps left after DUSTSEC.19 and DUSTSEC.20 (see the debrief for Dust Phases 4 and 5). The rule they defend is on the page [[Redaction Stage]], and the method that kept finding problems is on [[Dust Method]].

## Outcome

- **DUSTSEC.21** (the proxy and the body pipeline): encoded request bodies are decoded and redacted, JSON is parsed under every label, text bodies are redacted losslessly, duplicate-key and UTF-16 or UTF-32 bodies are refused fail-closed, and a size limit and an in-flight byte cap bound memory.
- **DUSTSEC.22** (the redaction rules): named-prefix secrets glued inside unbroken runs over 128 characters are found without touching legitimate long values.
- **Windows rename sweep:** 22 modules that hand-rolled a temp file plus a bare rename now use the shared retry helper.
- Tests rose from 4559 to 4832 across the batch.

## Default rules applied

The default rule did not decide anything here: both tasks are hard-rule changes, so every choice was reviewed. Where a design choice had to be made (refuse versus redact a duplicate-key body, redact versus forward a non-JSON body), the decision was written in the task document before the code changed.

## Open exceptions

Non-JSON bodies under a known-binary label, or with magic bytes plus a binary look, are forwarded unscanned: binary cannot be scanned reliably, and the label is client-chosen. Claude Code always labels its JSON as JSON. A plain random over-length run with no named prefix is not redacted. Object keys are never redacted. These are documented in the task documents and the verification notes.

## What review caught

Six independent read-only reviews (four on DUSTSEC.21, two on DUSTSEC.22) each found something the author's own tests had not, and most fix rounds introduced a new defect:

- **A regression:** the first DUSTSEC.21 checked a body's content-type label before trying to parse JSON, so JSON under an opaque label reached the upstream with its secret intact, which the old code had redacted.
- **Three more raw paths after that:** one NUL byte made a text body opaque, UTF-16 detection looked at only the first 4 KiB, and a duplicate JSON key whose shadowed value held a JSON-escaped secret defeated the text pass. The next round found a sparse UTF-32 secret and ASCII magic prefixes that made printable text opaque.
- **Real corruption:** the first DUSTSEC.22 scanned for the AWS key prefix anywhere in a run, but `ACCA` is valid hex, so up to 8.4 percent of 4096-character uppercase hex dumps were rewritten. The author had claimed a chance below 1e-10; the true figure was about 16 to the power of minus 4 per position.
- **Idempotence:** splitting a run at a match left a piece that a second pass would change. The fix repeats the stage and now fails closed at its bound.
- **Resource bounds:** an unbounded in-flight byte reservation, held for the whole stream; a decompression-bomb check; and a synchronous walk that can still stall the event loop for tens of seconds on a many-small-strings body.

## Lessons

- A redaction change needs a reviewer whose job is to break it. Four rounds on one change was not excessive: each one found a path the previous fixes opened or left.
- Measure before claiming a rate. A claimed chance of "under 1e-10" was wrong by about five orders of magnitude and the corruption it hid was found by testing realistic data (uppercase hex).
- Order matters: label checks before content checks are a bypass, because the label is client-chosen.
- Narrowing a pattern to avoid false positives loses real coverage: the glued-shape table is the honest record of what is and is not found.
- A resolver script that fails before it writes must stop the rebase. A rebase that had stopped on a conflict was verified by accident on a half-rebased tree and was noticed only by the lower test count.
- A reviewer that runs for four hours is a reviewer stuck on a heavy probe: cap probes and ask for the report.

## Follow-ups filed

`DUSTSEC.23` (an asynchronous or worker-thread redaction walk: the size limit bounds admission, not stall time), `DUSTSEC.24` (a stack overflow in the named rules on 10 MB of repeated prefixes, and the credit-card rule inside hex dumps). The earlier follow-ups stay open: object keys are never redacted, and a `__proto__` key is dropped when a sibling is redacted.
