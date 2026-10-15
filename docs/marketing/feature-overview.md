# Golem feature overview

**DRAFT. Not published. Not a source of truth.** See [`README.md`](README.md).
Every factual sentence ends with the id of its row in [`CLAIMS.md`](CLAIMS.md)
in a trailing HTML comment. A sentence with no id is opinion or a transition.

## What Golem is

Golem is a local layer between your tools and an LLM provider. The npm package is `@pliable/golem` and the command is `golem`. <!-- C-26 -->

It has a proxy that sits in front of model traffic and an MCP server that offers explicit tools. The sections below take each part in turn and say what it does and what it does not.

## Redaction before the model

The proxy redacts the JSON body of `POST /v1/messages` requests before compression and before the request is forwarded. <!-- C-01 -->
A request to any other path gets redaction only: the same rules in the same order, and no other stage. A JSON body is walked whatever its content label says, and a body that is not JSON is redacted as text. <!-- C-01 -->
A body sent with a content encoding (gzip, deflate, brotli) is decoded first and forwarded uncompressed. An unsupported encoding gets a 415, a body that cannot be decoded gets a 400, and in both cases nothing is forwarded. A JSON body that repeats an object key is refused with a 400, and a body that looks UTF-16 or UTF-32 is refused with a 502. <!-- C-27 -->
The request-body limit is 32 MiB by default, on the wire and after decompression, and a memory cap on bodies in flight answers 503. <!-- C-27 -->
These changes are on `development` and in no release tag. <!-- C-01; C-27; B-29 -->

Redaction is best-effort pattern matching, not a guarantee. What it does not do, among others: <!-- C-01 -->

- A non-JSON body under a known binary content label (images, audio, video, fonts, multipart, octet-stream, PDF, archives, protobuf) or one that starts with a binary signature and looks binary is forwarded unscanned. The label is chosen by the client. <!-- C-01 -->
- Object keys are never redacted. <!-- C-01 -->
- The redaction walk is synchronous, so the size limit bounds what is admitted, not how long a walk takes. <!-- C-01 -->
- A secret in a run longer than 128 characters is found only when it starts with a named prefix, and some shapes are found only at the edge of the run. A long random run with no named prefix, and some keys with junk on both sides, are not redacted. Cutting out a secret is repeated at most 16 times, then the proxy answers 502 and forwards nothing. <!-- C-29 -->
- The long-token sweep skips a whole token shaped like a documented `srvtoolu_` or `msgbatch_` id, because it used to corrupt them. A `container_` id is still rewritten. <!-- C-28 -->
- The named rules were rewritten so a 10 MB run no longer overflows the stack. That change accepted weakenings, among them: a Luhn-valid digit run glued onto a hex-only token is no longer redacted as a card; only the last 128 characters of an email's local part before the `@` are redacted; and a second redaction pass can re-redact a placeholder that a glued scheme exposes in a connection string's password position (over-redaction only, nothing is left in clear). A card number preceded by digits and a space is missed, before and after that change. <!-- C-30 -->

Every compression level, including `off`, runs redaction, and no level value can turn it off. A pipeline policy built in code can no longer say "redaction off" either: the type forbids it and a runtime check throws. <!-- C-02; C-31 -->
If the pipeline throws, the proxy re-runs redaction alone on the original request and forwards that. <!-- C-03 -->
If redaction itself throws, it answers 502 and forwards nothing. <!-- C-03 -->
Oversized tool output is redacted before it is stored or excerpted, so the stored original is the redacted text. <!-- C-08 -->

### The honest limits

There is exactly one way to switch redaction off: the setting `proxy.bypass_all`. <!-- C-04 -->
It defaults to `false`, takes effect when the proxy starts, and no request header or HTTP endpoint changes it. <!-- C-04 -->
When it is on, the status output warns that redaction is off and that secrets and PII reach the upstream unredacted. <!-- C-05 -->
A remote team layer cannot set it. <!-- C-06 -->

A Claude Code hook that used to answer permission requests for destructive and outward tool calls with an automatic deny now returns no decision, so the normal permission dialog opens and a person answers. The hook never answers `allow`. With a permission-relay channel connected, the relay may now be told when that dialog opens; whether it is told has not been observed. Ignoring relay answers to destructive prompts is a queued task, not built. <!-- C-32; B-07 -->

A Claude Code hook denies the documented ways an agent's Bash command or file edit would set `proxy.bypass_all`. <!-- C-07 -->
That hook guards common spellings. It is not a sandbox, and an agent with arbitrary shell access is not stopped by it. <!-- C-07 -->

## Compression levels

The default is `compression.level` `1` (lossless), and `brevity.level` defaults to `off`. <!-- C-09 -->

- `off`: redaction only. <!-- C-10 -->
- `1`: adds lossless compression (dedup, compaction). <!-- C-10 -->
- `2` and `3`: add semantic compression of stale turns, and are lossy. <!-- C-10 -->

At level 1 or below the pipeline is lossless and prefix-stable. Whatever level 1 removes is retrievable byte for byte from the CCR store, and a later turn forwards the same bytes for the earlier history. <!-- C-11 -->
Requests that no stage changes are forwarded with their original bytes. Redaction and dedup do rewrite the body. <!-- C-11 -->

Levels 2 and 3 behave differently by upstream. On an Anthropic prompt-caching upstream they run as level 1, because rewriting history would break the cached prefix. <!-- C-12 -->
They apply on non-caching upstreams and need the optional Headroom sidecar, which is off by default. <!-- C-12 -->
An opt-in research flag, off by default, overrides that gate. <!-- C-12 -->

Token savings from compression are situational, not the headline, and Golem's own stats note calls them near zero on cached Anthropic traffic. <!-- C-13 -->

## Local tools

**Oversized tool output.** When a Bash, Read, Grep, Glob or WebFetch result exceeds 12,000 characters, a hook replaces it with a head/tail excerpt and a `hash=` reference. <!-- C-14 -->
The redacted original is stored under `.golem/ccr`, and Claude can retrieve it with the `expand` tool. <!-- C-14 -->

**Local answers.** For an eligible question, the proxy can answer from the project knowledge base without calling the model. <!-- C-15 -->
The answer is extractive: it quotes retrieved text and uses no generative model. <!-- C-15 -->
It carries the visible prefix "**Golem** Answered locally from the project knowledge base — verify independently.", and the feature is on by default. <!-- C-15 -->
Treat it like any cited source: it quotes the project's own pages, and it can quote the wrong one.

**Knowledge base.** It works with no setup. A pure-TypeScript lexical hashing embedder is the default, replaced by an Ollama embedding model when one is reachable, and the vector store is a local file. <!-- C-16 -->
A Qdrant server is not supported: the `knowledge.vector_db_url` setting is deprecated and ignored, and the embedded store is always used. <!-- C-16 -->
Lookup matches page aliases (frontmatter `aliases`, added by hand-editing) as well as titles, and `fetch` returns the full text of any hit that `search` returned. <!-- C-39 -->
Writing to the vector store takes a lock that is fenced against a stalled writer, with two documented residuals. A file watched outside the project is keyed by its absolute path, so editing it no longer deletes the project's chunks of the same relative name. <!-- C-46; C-47 -->

**Web pages.** The web cache honours `max-age` and `Expires`. A response marked `no-store`, `private` or `no-cache`, or one that sets a cookie, is served but not cached or ingested, and an earlier copy of that URL is deleted. A page over 1,000,000 characters is cached and served but not embedded. <!-- C-38 -->
Limitation: when Claude Code's own `WebFetch` ran instead, or `knowledge.webcache_fetch_raw` is off, the hooks cannot see the response headers and may store that output regardless. <!-- C-38; B-43 -->

**Which upstream.** Every proxied request appends a line to `.golem/state/selection-log.jsonl` with the gateway, provider, target and a short reason. It carries no URL, header, environment value or body, and the reason is passed through redaction. <!-- C-40 -->

**Local models.** Golem picks a local model tier from detected GPU or unified memory: under 8 GiB is P-min, 8 to 16 GiB is P-mid, over 16 GiB is P-max, and none detected is P-cpu. <!-- C-17 -->
`golem ollama setup` asks for confirmation before it installs Ollama or pulls models, and nothing else here does. `--yes` skips the prompt, and without a TTY the command refuses unless `--yes` is given. <!-- C-18 -->

## The MCP surface

The MCP server registers up to eleven tools: `code`, `coder`, `devices`, `snooze`, `search`, `fetch`, `ingest`, `expand`, `stats`, `wiki_read` and `wiki_upsert`; plugin tools may add more. <!-- C-19 -->
Several register only when their dependency exists: a knowledge base for `search`, `fetch` and `ingest`, a local-inference dependency for `coder`, a code root for `code`, and a wiki for the two wiki tools. <!-- C-19 -->
It can run over stdio or streamable HTTP. <!-- C-19 -->
It offers seven prompts. The retired `slider` prompt is gone, and anything that lists prompts or calls it by name no longer finds it; the control is `golem compression`. <!-- C-19; C-50 -->

On the proxy side, nine upstream providers are accepted: Anthropic, Azure Foundry, OpenRouter, OpenAI, Gemini, NVIDIA NIM, Ollama, llama.cpp and a custom endpoint. Anthropic is the default. <!-- C-20 -->

## Team and hosted features

A hosted team portal can supply a `team` settings layer. In the normal band it ranks above the user's own settings and below the project, local and environment layers. <!-- C-21 -->
An invalid team value skips the whole team layer with a warning, and the proxy still starts. <!-- C-21 -->
The portal identity keys and `proxy.bypass_all` cannot be set from a remote layer. <!-- C-06 -->

Every settings reader loads through one function that applies the team layer: status, config, the TUI, hooks, the MCP server, the proxy and its hot reload. Hooks read the team layer from the local cache only, so a member's view is as fresh as the last `golem team sync`. A test fails when production code reads settings around that function, outside a documented allow-list. <!-- C-33 -->
A team may only tighten. The policy table is default-deny: every settings key has a class, and a key with none is denied. A team can force a risky boolean off but not on, force a protective boolean on but not off, and lower a numeric limit but not raise it. Anything that runs a command or sets a URL, endpoint, credential or path is denied. A refusal is per key, names the key and the rule, and never prints the value. <!-- C-34 -->
This does not mean a member cannot get around a team: a member can still edit their own files or run another binary. <!-- B-01 -->
A `default!` floor, which pins a key to its built-in default no matter who says otherwise, is built, and **no key is pinned today**: the list is empty, and choosing keys is a decision the project owner has not made. <!-- C-35; B-42 -->
A setting pinned by `!important` or `default!` shows as locked on the config CLI, status, the TUI and the VS Code panel, with the origin that pinned it and who can still override it. A write that a higher origin overrules says so, and the file is still written. <!-- C-36 -->

`golem session host` can run an agent session that Golem supervises and that outlives the CLI call. <!-- C-22 -->
Golem keeps a per-project record of hosted sessions in `.golem/state/hosted-sessions.json`, checks liveness on every read, and offers `list`, `log`, `stop` and `forget`. <!-- C-22 -->

A paired device talks to a separate HTTPS server. That server requires a client certificate for everything except the one enrolment-claim route, and checks the certificate on every other request. <!-- C-23 -->

## Plugins

`golem plugin` counts and lists every plugin problem and exits 0 by default; `--check` exits 1 on an error-level problem and `--strict` on any problem. It warns about regular expressions with a backtracking-prone shape, and the warning does not catch every such shape. <!-- C-37 -->
A plugin pipeline stage runs on a snapshot of the body. If it throws, runs past 5 seconds, or edits in place and then throws, the stage is skipped and the body from before it, already redacted by the built-in rules, is kept. Three timeouts in a row skip the stage for 60 seconds. <!-- C-37 -->
A stage that blocks the event loop synchronously cannot be interrupted, and a stage that scrubs content fails open while it is skipped, so scrubbing belongs in a redaction rule. <!-- C-37; B-47 -->

## Setup and credentials

A Golem skill you delete stays deleted: `golem init` records what it offered and skips what you removed, and `golem init --restore-skill <name>` opts back in. <!-- C-44 -->
A stored credential is returned as it was written, minus one trailing newline. Gateway key ingestion trims surrounding whitespace and refuses a key with a control character, a byte-order mark or a character above U+00FF, without echoing it. Real PowerShell and the macOS keychain were exercised only through stand-in scripts. <!-- C-45 -->

## Honest observability

Savings figures are estimates. Golem's token-savings numbers use about four characters per token, and the request count covers rewritten requests only. <!-- C-24 -->
`golem stats` labels them "est." and "rewritten requests", and any figure taken from it should be called an estimate. <!-- C-24 -->

Cache numbers come from a different source. `golem stats --cache` reports the prompt-cache hit rate from the token usage the API billed on each response, kept separate from Golem's own prediction of what broke the prefix. <!-- C-25 -->
`golem bench cost` compares Golem's savings estimates with Claude Code's cost-doc baselines. <!-- C-25 -->
The dashboard has a "Usage and cost" row. Cache hit rate and billed input tokens come from billed usage. The cost tile is billed token counts times catalog prices, not an invoice, and it reads "(partial)" when a model is unpriced. The "Avoided upstream in / out (est.)" tile is an estimate and says so. With no data the tiles say "no usage data yet". <!-- C-41; B-18 -->

This draft states no savings percentage and does not claim that Golem lowers a bill.
