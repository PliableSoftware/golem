# Marketing drafts (Dust Phase 5)

**DRAFT. Not published. Not a source of truth.**

Everything under `docs/marketing/` is working copy for a possible public launch.
Nothing here has been released, posted or approved for release. None of it is
authoritative: the spec (`docs/golem-spec.md`) and the code are. If a draft and
the spec disagree, the draft is wrong.

## The rule

A draft may make only the claims that are rows in
[`CLAIMS.md`](CLAIMS.md), worded no stronger than the row. A claim that is not
in the ledger is not in a draft. Anything in the BANNED section of the ledger
must not appear in any draft, in any wording.

Re-check a row against the code before a draft ships. Rows carry the commit they
were read at, and line anchors drift.

## Files

- [`CLAIMS.md`](CLAIMS.md): the claims ledger and the banned-claims list.

## Local answers

This directory is excluded from the proxy's local answers (DUST5.1), so a draft
is never quoted back as "answered from the project knowledge base". The drafts
are still indexed and findable through `search`.

## Hygiene

No redaction placeholder (the proxy's bracketed marker) may appear anywhere
under this directory. Grep the diff for an opening square bracket followed by
the word REDACTED before committing.
