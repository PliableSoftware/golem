# Golem feature overview

**DRAFT. Not published. Not a source of truth.** See [`README.md`](README.md).
Every factual sentence ends with the id of its row in [`CLAIMS.md`](CLAIMS.md)
in a trailing HTML comment. A sentence with no id is opinion or a transition.

## What Golem is

Golem is a local layer between your tools and an LLM provider. The npm package is `@pliable/golem` and the command is `golem`. <!-- C-26 -->

It has a proxy that sits in front of model traffic and an MCP server that offers explicit tools. The sections below take each part in turn and say what it does and what it does not.

## Redaction before the model

The proxy redacts the JSON body of `POST /v1/messages` requests before any other pipeline stage runs and before the request is forwarded. <!-- C-01 -->
Other paths and non-JSON bodies are not rewritten by this stage, so they are not redacted by it. <!-- C-01 -->

Every compression level, including `off`, runs redaction, and no level value can turn it off. <!-- C-02 -->
If the pipeline throws, the proxy re-runs redaction alone on the original request and forwards that. <!-- C-03 -->
If redaction itself throws, it answers 502 and forwards nothing. <!-- C-03 -->
Oversized tool output is redacted before it is stored or excerpted, so the stored original is the redacted text. <!-- C-08 -->

### The honest limits

There is exactly one way to switch redaction off: the setting `proxy.bypass_all`. <!-- C-04 -->
It defaults to `false`, takes effect when the proxy starts, and no request header or HTTP endpoint changes it. <!-- C-04 -->
When it is on, the status output warns that redaction is off and that secrets and PII reach the upstream unredacted. <!-- C-05 -->
A remote team layer cannot set it. <!-- C-06 -->

A Claude Code hook denies the documented ways an agent's Bash command or file edit would set it. <!-- C-07 -->
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

On cached Anthropic traffic, compression saves roughly nothing: about 0%, measured in July 2026. <!-- C-13 -->
Compression pays off on non-caching upstreams. <!-- C-13 -->

## Local tools

**Oversized tool output.** When a Bash, Read, Grep, Glob or WebFetch result exceeds 12,000 characters, a hook replaces it with a head/tail excerpt and a `hash=` reference. <!-- C-14 -->
The redacted original is stored under `.golem/ccr`, and Claude can retrieve it with the `expand` tool. <!-- C-14 -->

**Local answers.** For an eligible question, the proxy can answer from the project knowledge base without calling the model. <!-- C-15 -->
The answer is extractive: it quotes retrieved text and uses no generative model. <!-- C-15 -->
It carries the visible prefix "Answered locally from the project knowledge base, verify independently", and the feature is on by default. <!-- C-15 -->
Treat it like any cited source: it quotes the project's own pages, and it can quote the wrong one.

**Knowledge base.** It works with no setup. A pure-TypeScript lexical hashing embedder is the default, replaced by an Ollama embedding model when one is reachable, and the vector store is a local file. <!-- C-16 -->
A Qdrant server is not supported. <!-- C-16 -->

**Local models.** Golem picks a local model tier from detected GPU or unified memory: under 8 GiB is P-min, 8 to 16 GiB is P-mid, over 16 GiB is P-max, and none detected is P-cpu. <!-- C-17 -->
`golem ollama setup` asks for confirmation before it installs Ollama or pulls models, and nothing else here does. <!-- C-18 -->

## The MCP surface

The MCP server registers up to eleven tools: `code`, `coder`, `devices`, `snooze`, `search`, `fetch`, `ingest`, `expand`, `stats`, `wiki_read` and `wiki_upsert`. <!-- C-19 -->
Several register only when their dependency exists: a knowledge base for `search`, `fetch` and `ingest`, a local-inference dependency for `coder`, a code root for `code`, and a wiki for the two wiki tools. <!-- C-19 -->
It can run over stdio or streamable HTTP. <!-- C-19 -->

On the proxy side, nine upstream providers are accepted: Anthropic, Azure Foundry, OpenRouter, OpenAI, Gemini, NVIDIA NIM, Ollama, llama.cpp and a custom endpoint. Anthropic is the default. <!-- C-20 -->

## Team and hosted features

A hosted team portal can supply a `team` settings layer. In the normal band it ranks above the user's own settings and below the project, local and environment layers. <!-- C-21 -->
An invalid team value skips the whole team layer with a warning, and the proxy still starts. <!-- C-21 -->
The portal identity keys and `proxy.bypass_all` cannot be set from a remote layer. <!-- C-06 -->

`golem session host` can run an agent session that Golem supervises and that outlives the CLI call. <!-- C-22 -->
Golem keeps a per-project record of hosted sessions in `.golem/state/hosted-sessions.json`, checks liveness on every read, and offers `list`, `log`, `stop` and `forget`. <!-- C-22 -->

A paired device talks to a separate HTTPS server. That server requires a client certificate for everything except the one enrolment-claim route, and checks the certificate on every other request. <!-- C-23 -->

## Honest observability

Savings figures are estimates. Golem's token-savings numbers use about four characters per token, and the request count covers rewritten requests only. <!-- C-24 -->
`golem stats` labels them "est." and "rewritten requests", and any figure taken from it should be called an estimate. <!-- C-24 -->

Cache numbers come from a different source. `golem stats --cache` reports the prompt-cache hit rate from the token usage the API billed on each response, kept separate from Golem's own prediction of what broke the prefix. <!-- C-25 -->
`golem bench cost` compares Golem's savings estimates with Claude Code's cost-doc baselines. <!-- C-25 -->
The dashboard does not show cache hit rate or cost. <!-- C-25 -->

This draft states no savings percentage and does not claim that Golem lowers a bill.
