/**
 * WS-A A1 — the Golem proxy server: a transparent Anthropic API passthrough.
 *
 * Claude Code points `ANTHROPIC_BASE_URL` at this server; every request is
 * forwarded to the real API with method, path, query, headers (including
 * auth) and body preserved. Responses — most importantly SSE streams with
 * tool-use / thinking / tool_reference blocks — are piped back as raw bytes:
 * no parsing, no re-serialization, no buffering, no event reordering
 * (CLAUDE.md hard rule; verification-notes §15).
 *
 * Request bodies are buffered (they are bounded JSON documents) so the A3
 * pipeline seam ({@link RequestPipeline}) can operate on them; with the default
 * identity pipeline forwarded bytes equal received bytes, and with the real
 * pipeline they are redacted (and, at level >= 1, losslessly compacted).
 * No zod here on purpose: the proxy never interprets payloads, so there is
 * no boundary to validate — validation would require a parse/re-serialize
 * cycle that the byte-fidelity rule forbids.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import { type Dispatcher, Pool } from "undici";
import { mapUpstreamError, PROXY_ERROR_HEADER } from "./errors.js";
import { forwardableRequestHeaders, forwardableResponseHeaders } from "./headers.js";
import { classifyRateLimit, decideRetry } from "./rate-limit-retry.js";
import {
  BodyBudget,
  type BodyHold,
  normalizeRequestBody,
  RequestBodyRefusal,
  readBody,
} from "./request-body.js";
import {
  type ProxyConfig,
  type ProxyRequest,
  type ProxyRequestOutcome,
  type ProxyServerOptions,
  resolveProxyConfig,
} from "./types.js";
import { UsageSniffer } from "./usage-sniffer.js";

/**
 * R9.2: replace the body's `model` with the target's real model id, for a
 * request that selected its target with a virtual `golem/<id>` id.
 *
 * Returns `null` when the body is absent or is not JSON carrying a `model`
 * string — the caller then refuses the request rather than forwarding
 * `golem/coder` to a provider that has no such model and will 404 or, worse,
 * fuzzy-match it.
 *
 * This is the **only** place the proxy rewrites the request model, and it fires
 * only when the incoming value was a Golem selector — never a real model id — so
 * the byte-faithful guarantee for ordinary traffic is untouched.
 */
function rewriteBodyModel(body: Buffer | null, model: string): Buffer | null {
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.model !== "string") return null;
  return Buffer.from(JSON.stringify({ ...record, model }), "utf8");
}

/**
 * Is this request the Anthropic `count_tokens` route (R10.15)? Matches on the
 * path suffix so a gateway base-path prefix does not defeat it, and ignores any
 * query string.
 */
function isCountTokensPath(url: string): boolean {
  const path = url.split("?")[0]?.replace(/\/+$/, "") ?? "";
  return path.endsWith("/v1/messages/count_tokens");
}

/**
 * R9.2: how many distinct upstream origins one proxy run will pool connections
 * for. Generous next to any real target registry, and present only so a bug (or
 * a config that generates origins) cannot grow the map without bound. Reaching
 * it does not fail the request — the origin is dialled with a throwaway pool.
 */
const MAX_POOLED_ORIGINS = 32;

export class GolemProxy {
  readonly config: ProxyConfig;
  /** DUSTSEC.21: request-body bytes held across concurrent requests. */
  readonly #bodyBudget: BodyBudget;

  /**
   * When false, the proxy forwards every request as a raw passthrough (no
   * redaction/compression/brevity). Fixed at construction from
   * `proxy.bypass_all` (ADR-0004) and NEVER changed afterwards: DUSTSEC.2
   * removed the unauthenticated `/__golem/pipeline/<bool>` endpoint that used
   * to flip it, so redaction-off is only ever the persisted, CLI-only,
   * loudly-surfaced setting, applied at the next proxy start.
   */
  readonly #pipelineEnabled: boolean;

  private readonly server: Server;
  /**
   * R9.2 — one `Pool` per upstream origin, created lazily and all closed in
   * `close()`. Per-origin pooling is what undici is designed for, so serving
   * several targets concurrently falls out of it; a single `Pool` bound to one
   * origin in the constructor was the entire structural blocker.
   *
   * The single-upstream case is unchanged in behaviour: it is simply a map with
   * one entry, created on the first request instead of in the constructor.
   */
  private readonly pools = new Map<string, Pool>();
  /** Upstream path prefix for the DEFAULT upstream (empty unless the base URL carries one). */
  private readonly basePath: string;

  constructor(options: ProxyServerOptions = {}) {
    this.config = resolveProxyConfig(options);
    this.#bodyBudget = new BodyBudget(this.config.maxInFlightBodyBytes);
    // R11.1: `proxy.bypass_all` starts the proxy with the pipeline OFF, which is
    // the same state `golem off` reaches at runtime — the difference is that this
    // one survives a restart, and the restart is the reason the runtime toggle
    // could not be the bypass's home (ADR-0004).
    this.#pipelineEnabled = options.pipelineEnabled !== false;
    const upstream = new URL(this.config.upstreamBaseUrl);
    this.basePath = upstream.pathname.replace(/\/+$/, "");
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  /** The pooled dispatcher for an origin, created on first use. */
  private poolFor(origin: string): Pool {
    const existing = this.pools.get(origin);
    if (existing !== undefined) return existing;
    const pool = new Pool(origin, {
      connect: { timeout: this.config.connectTimeoutMs },
      headersTimeout: this.config.headersTimeoutMs,
      bodyTimeout: this.config.bodyTimeoutMs,
    });
    // Past the cap the pool is still returned but not retained, so it is closed
    // by GC rather than tracked — a request must never fail because of a cap
    // that exists only to bound a pathological config.
    if (this.pools.size < MAX_POOLED_ORIGINS) this.pools.set(origin, pool);
    return pool;
  }

  /** Bind the proxy. `port` 0 picks an ephemeral port (tests). */
  listen(port = 0, host = "127.0.0.1"): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        resolve(this.server.address() as AddressInfo);
      });
    });
  }

  address(): AddressInfo | null {
    const addr = this.server.address();
    return addr && typeof addr === "object" ? addr : null;
  }

  /** Request-body bytes currently reserved against the in-flight cap (tests, diagnostics). */
  get bodyBytesInFlight(): number {
    return this.#bodyBudget.used;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
      // Drop lingering keep-alive connections so close() completes promptly.
      this.server.closeAllConnections();
    });
    // Every origin dialled this run, not just the configured one.
    await Promise.all([...this.pools.values()].map((p) => p.close()));
    this.pools.clear();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Statusline endpoint — returns Golem state as JSON for the CLI statusline tool
    if (req.url === "/__golem/statusline" && req.method === "GET") {
      try {
        // Import collectGolemState from the statusline module
        // Note: We use dynamic import to avoid circular deps at bundle time
        const { collectGolemState } = await import("../cli/statusline.js");
        const state = await collectGolemState(process.cwd());
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(state));
      } catch (_err) {
        // On error, return minimal state to avoid breaking the statusline
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({}));
      }
      return;
    }

    // Low-latency streaming: disable Nagle on the client socket.
    res.socket?.setNoDelay(true);

    // R11.7 — one outcome per request, reported after it ends.
    //
    // The proxy used to log the routing decision it took BEFORE forwarding and
    // nothing after, so a request that died mid-stream left no trace: the
    // investigation of a live "Connection lost mid-response" had to be run from
    // the client's transcript and the process table. Most terminal paths below
    // report what became of the request; the upstream body-read and gunzip
    // failures destroy the response without reporting. Metadata only — never
    // bodies.
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    // Query stripped: a query string can carry identifiers, and the path is
    // what tells you which endpoint this was.
    const reqPath = (req.url ?? "/").split("?")[0] ?? "/";
    let outcomeTargetId: string | undefined;
    let reported = false;
    const report = (
      result: ProxyRequestOutcome["result"],
      extra: {
        status?: number;
        bytes?: number;
        streaming?: boolean;
        lastEvent?: string | null;
        events?: number;
        detail?: string;
      } = {},
    ): void => {
      // Exactly once. Several paths both respond and fall through to a return,
      // and a second line for one request would make the log lie about volume.
      if (reported) return;
      reported = true;
      const hook = this.config.onRequestOutcome;
      if (hook === undefined) return;
      try {
        hook({
          method,
          path: reqPath,
          ...(outcomeTargetId !== undefined ? { targetId: outcomeTargetId } : {}),
          result,
          durationMs: Date.now() - startedAt,
          bytes: extra.bytes ?? 0,
          streaming: extra.streaming ?? false,
          ...(extra.status !== undefined ? { status: extra.status } : {}),
          ...(extra.lastEvent != null ? { lastEvent: extra.lastEvent } : {}),
          ...(extra.events !== undefined ? { events: extra.events } : {}),
          ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
        });
      } catch {
        // Observe-only: a reporting error must never reach the client, and by
        // here the response is already finished anyway.
      }
    };
    /** Respond with a proxy error AND report it — the two always go together. */
    const failProxy = (status: number, message?: string, body?: string): void => {
      this.respondProxyError(res, status, message, body);
      report("proxy_error", { status, ...(message !== undefined ? { detail: message } : {}) });
    };

    const abort = new AbortController();
    res.on("close", () => {
      // Client went away before we finished — cancel the upstream request.
      if (!res.writableEnded) abort.abort();
    });

    let forward: ProxyRequest;
    const hold: BodyHold = { bytes: 0 };
    // Idempotent: called when the final upstream response headers arrive (the body
    // is no longer needed: the retry loop has ended) and again on close.
    const releaseHold = (): void => {
      this.#bodyBudget.release(hold.bytes);
      hold.bytes = 0;
    };
    try {
      // Release what this request reserved once the response is done, however it ends.
      res.once("close", releaseHold);
      const body = await readBody(req, this.config.maxRequestBodyBytes, this.#bodyBudget, hold);
      let headers = forwardableRequestHeaders(req.headers);
      let readable = body;
      // DUSTSEC.21: decode a content-encoded body so redaction can read it. Only
      // when the pipeline is on: `proxy.bypass_all` forwards byte-faithfully.
      if (body !== null && this.#pipelineEnabled) {
        const normalized = normalizeRequestBody(body, headers, this.config.maxRequestBodyBytes);
        // A decoded body is a separate buffer held alongside the wire form:
        // reserve it too. (Identity and BOM-strip share the wire buffer.)
        const extra = normalized.body.buffer === body.buffer ? 0 : normalized.body.length;
        if (extra > 0 && !this.#bodyBudget.tryReserve(extra)) {
          throw new RequestBodyRefusal(
            503,
            "golem proxy: too many large request bodies are in flight (proxy memory cap). " +
              "Nothing was forwarded; retry shortly.",
          );
        }
        hold.bytes += extra;
        readable = normalized.body;
        headers = normalized.headers;
      }
      forward = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers,
        body: readable,
      };
    } catch (err) {
      if (err instanceof RequestBodyRefusal) {
        // Fail closed: nothing was forwarded. `connection: close` because an
        // oversized body may still be arriving and is not worth draining.
        res.setHeader("connection", "close");
        if (err.status === 503) res.setHeader("retry-after", "1");
        failProxy(err.status, err.message);
        return;
      }
      // We could not even read the client request — nothing to forward.
      failProxy(400, `golem proxy: could not read request (${String(err)})`);
      return;
    }

    // R9.2: resolve the route BEFORE the pipeline, because the route decides two
    // pipeline inputs — the redaction floor (from the target's `trust`) and
    // whether the semantic stage may assume a caching upstream. Redaction still
    // runs first WITHIN the pipeline, so the hard rule is untouched.
    //
    // Fail-closed: an unknown target is an error, never a fallback to the
    // default. Applied before the bypass check as well — `proxy.bypass_all` turns
    // off *processing*, and must not also turn a refused route into a silent
    // forward to somewhere the caller did not name.
    if (this.config.resolveRoute !== undefined) {
      const decision = this.config.resolveRoute(forward);
      if (!decision.ok) {
        failProxy(decision.status, decision.message);
        return;
      }
      forward = { ...forward, route: decision.route };
      outcomeTargetId = decision.route.targetId;
      // A virtual `golem/<id>` model selected the target; no provider has a
      // model by that name, so the body must carry the target's real one. This
      // is the ONLY case where the proxy rewrites the model field, and it only
      // ever replaces a string that was never a real model id.
      if (decision.route.rewriteModel !== undefined) {
        const rewritten = rewriteBodyModel(forward.body, decision.route.rewriteModel);
        if (rewritten === null) {
          failProxy(
            400,
            `golem proxy: request selected target "${decision.route.targetId}" with a virtual ` +
              "model id, but the body is not JSON with a model field, so there is nothing to " +
              "rewrite. No request was forwarded.",
          );
          return;
        }
        forward = { ...forward, body: rewritten };
      }
    }

    // A3 seam: redaction -> compression. FAIL-SAFE, never fail-open (DUSTSEC.1,
    // USER decision R1/S3). A pipeline error must not break the session, but it
    // must not forward the raw body either: any compression, policy, telemetry or
    // CCR-write failure would otherwise send an unredacted secret upstream. So
    // on a throw we re-run REDACTION ALONE on the original request and forward
    // that. If redaction itself throws (or the pipeline has no redaction-only
    // entry point to prove it), we FAIL CLOSED: a 5xx, nothing forwarded.
    // Pipeline-disabled (`proxy.bypass_all`, the single redaction-off path) skips
    // this block and forwards the body untouched. No header or endpoint can do so.
    if (this.#pipelineEnabled) {
      const original = forward;
      try {
        forward = await this.config.pipeline.process(original);
      } catch (err) {
        this.config.onPipelineError?.(err, original);
        try {
          const redactOnly = this.config.pipeline.redactOnly;
          if (redactOnly === undefined) throw new Error("pipeline has no redaction-only fallback");
          forward = redactOnly.call(this.config.pipeline, original);
        } catch (redactErr) {
          failProxy(
            502,
            "golem proxy: the request pipeline failed and redaction could not be " +
              "re-applied, so the request was NOT forwarded (fail closed, nothing " +
              `reached the upstream). ${String(redactErr)}`,
          );
          return;
        }
      }
    }

    // R2.3 (Decision 33): the pipeline may have resolved a confident,
    // KB-composed answer for an eligible single-turn request. When it did,
    // serve it directly and skip the upstream call entirely.
    if (forward.respondDirectly !== undefined) {
      const direct = forward.respondDirectly;
      res.writeHead(direct.status, direct.headers);
      res.end(direct.body);
      report("answered_locally", {
        status: direct.status,
        bytes: Buffer.byteLength(direct.body),
      });
      return;
    }

    // R6.1 case (a): map auth/headers for a non-Anthropic Anthropic-protocol
    // upstream (strip the client's Anthropic credential, inject the configured
    // provider's). Transport-only, never touches the body — SSE/tool-use
    // fidelity is untouched. Default (Anthropic passthrough) has no mapper, so
    // this is literally a no-op there. Applied outside the pipeline so bypass
    // requests still reach the configured upstream with valid credentials.
    //
    // R9.2: read transport from the resolved ROUTE when there is one, falling
    // back to the single-upstream config otherwise. Byte-fidelity is a property
    // of the provider, not of the proxy — an Anthropic-protocol route stays a
    // raw byte pipe and a translating route was never byte-faithful (R6.1 case
    // b); per-route selection just states that per request instead of per run.
    const route = forward.route;
    const upstreamOrigin = route !== undefined ? new URL(route.baseUrl) : undefined;
    const mapHeaders =
      route !== undefined ? route.mapUpstreamHeaders : this.config.mapUpstreamHeaders;
    const upstreamHeaders = mapHeaders ? mapHeaders({ ...forward.headers }) : forward.headers;

    // R6.1 case (b) slice b1: translate the request body to the OpenAI schema
    // for a translating upstream (OpenAI / Ollama). The pipeline (redaction →
    // compression) has already run in Anthropic terms above, so translation is
    // the final step and never sees un-redacted content. A translation failure
    // is a clean proxy error, not a mismatched-shape forward.
    const translate = route !== undefined ? route.translateUpstream : this.config.translateUpstream;
    const basePath =
      upstreamOrigin !== undefined ? upstreamOrigin.pathname.replace(/\/+$/, "") : this.basePath;
    let requestPath = basePath + forward.url;
    let requestBody = forward.body;
    let requestHeaders = upstreamHeaders;
    let translateStreaming = false;
    // R10.15: `/v1/messages/count_tokens` has no OpenAI-schema equivalent, so a
    // translating upstream answers it here rather than forwarding it as a
    // completion. Never reached on the Anthropic passthrough, where the real
    // endpoint exists and the byte-faithful forward is correct.
    if (translate?.countTokens !== undefined && isCountTokensPath(forward.url)) {
      let counted: Buffer;
      try {
        counted = translate.countTokens(forward.body);
      } catch (err) {
        failProxy(400, `golem proxy: could not count tokens for this request (${String(err)})`);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(counted);
      report("ok", { status: 200, bytes: counted.length });
      return;
    }
    if (translate !== undefined) {
      let translated: { body: Buffer; stream: boolean; path?: string };
      try {
        translated = translate.translateRequest(forward.body);
      } catch (err) {
        failProxy(
          400,
          `golem proxy: could not translate request to the upstream schema (${String(err)})`,
        );
        return;
      }
      requestBody = translated.body;
      translateStreaming = translated.stream;
      requestPath = translated.path ?? translate.path;
      requestHeaders = { ...upstreamHeaders, "content-type": "application/json" };
    }

    // R14.5 — the origin actually being dialled, named once for every retry
    // attempt's RateLimitedError message. Falls back the same way the pool
    // lookup below does: the route's own target when there is one, else the
    // single configured upstream.
    const rateLimitSubject =
      outcomeTargetId ?? upstreamOrigin?.origin ?? this.config.upstreamBaseUrl;

    let upstream: Dispatcher.ResponseData;
    let attempt = 1;
    for (;;) {
      try {
        upstream = await this.poolFor(
          upstreamOrigin?.origin ?? new URL(this.config.upstreamBaseUrl).origin,
        ).request({
          path: requestPath,
          method: forward.method as Dispatcher.HttpMethod,
          headers: requestHeaders,
          body: requestBody,
          signal: abort.signal,
        });
      } catch (err) {
        if (abort.signal.aborted) {
          res.destroy();
          report("client_gone", { detail: "the client hung up before the upstream answered" });
          return;
        }
        const mapped = mapUpstreamError(err);
        this.respondProxyError(res, mapped.status, undefined, mapped.body);
        report("upstream_error", {
          status: mapped.status,
          detail: "the upstream request failed before any response",
        });
        return;
      }

      // R14.5 — transparently retry a rate-limited (429/529) response before
      // forwarding anything to the client, invisible to Claude Code beyond
      // taking longer: the request body is already fully buffered above
      // (`readBody`), so replaying it is trivially safe, and nothing has been
      // written to `res` yet. Bounded (MAX_RETRY_ATTEMPTS, RETRY_BUDGET_MS,
      // see rate-limit-retry.ts) — once exhausted, the loop falls through and
      // the still-rate-limited response is forwarded exactly as it always
      // was, byte for byte.
      const rateLimited = classifyRateLimit(
        rateLimitSubject,
        upstream.statusCode,
        upstream.statusText,
        upstream.headers,
        Date.now(),
      );
      if (rateLimited === null) break;
      const decision = decideRetry(rateLimited, attempt);
      if (decision.kind === "give-up") break;

      // Discard this attempt's body before reissuing on the same pool — undici
      // requires the body be consumed or dumped, and forwarding a rate-limited
      // response's headers to the caller's limit-prediction hook, then piping
      // its body to the client, would defeat the retry (and lie about which
      // response the client actually got).
      await upstream.body.dump().catch(() => {});
      if (abort.signal.aborted) {
        res.destroy();
        report("client_gone", {
          detail: "the client hung up while golem proxy was retrying a rate-limited upstream",
        });
        return;
      }
      await this.config.rateLimitSleep(decision.afterMs, abort.signal);
      if (abort.signal.aborted) {
        res.destroy();
        report("client_gone", {
          detail: "the client hung up while golem proxy was retrying a rate-limited upstream",
        });
        return;
      }
      attempt += 1;
    }

    // DUSTSEC.21: the retry loop is over and nothing replays the request body after
    // the response headers, so stop counting it against the in-flight cap: a long
    // SSE stream must not hold its request's bytes for its whole life. (The proxy
    // still references the buffer until the response ends; this bounds ADMISSION,
    // it does not shrink the resident set of requests already streaming.)
    releaseHold();

    // Translating upstream (R6.1 case b): convert the response to the Anthropic
    // shape. This is the ONLY path that parses/reserializes a response body — the
    // Anthropic passthrough below stays a raw byte pipe. An upstream error is
    // surfaced unchanged in either mode.
    if (translate !== undefined) {
      // Observe-only header hook (served-model + limit prediction) — the
      // translating branch returns before the byte-faithful hook below, so fire
      // it here too. Header-only; never touches the body pipe (fidelity preserved).
      const onResponseHeaders = this.config.onResponseHeaders;
      if (onResponseHeaders !== undefined) {
        try {
          onResponseHeaders(upstream.headers, forward);
        } catch {
          // observe-only — a hook error can never affect the forwarded response
        }
      }
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        let raw: Buffer;
        try {
          raw = Buffer.from(await upstream.body.arrayBuffer());
        } catch {
          res.destroy();
          return;
        }
        res.writeHead(upstream.statusCode, forwardableResponseHeaders(upstream.headers));
        res.end(raw);
        report("upstream_error", { status: upstream.statusCode, bytes: raw.length });
        return;
      }

      if (translateStreaming) {
        // b2: pipe the OpenAI SSE stream through the translator to the client
        // live, so tokens arrive incrementally. Never buffered.
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.flushHeaders();
        try {
          await pipeline(upstream.body, translate.createStreamTranslator(), res);
          report("ok", { status: 200, streaming: true });
        } catch {
          res.destroy();
          upstream.body.destroy();
          // A translated stream that failed mid-flight. The translator relays an
          // upstream `error` frame itself (R10.23); reaching here means the pipe
          // broke, which the client sees as a lost connection.
          report(abort.signal.aborted ? "client_gone" : "truncated", {
            status: 200,
            streaming: true,
            detail: abort.signal.aborted
              ? "the client hung up mid-stream"
              : "the translated stream ended before it completed",
          });
        }
        return;
      }

      // b1: non-streaming — buffer, translate, write the Anthropic JSON body.
      let raw: Buffer;
      try {
        raw = Buffer.from(await upstream.body.arrayBuffer());
        // The Anthropic passthrough relays bytes verbatim, but the translating
        // path must PARSE the body — so decode gzip first (undici doesn't
        // auto-decompress; some OpenAI-schema upstreams, e.g. Moonshot, gzip).
        const enc = this.header(upstream.headers, "content-encoding");
        if (enc?.toLowerCase().includes("gzip")) {
          raw = gunzipSync(raw);
        }
      } catch {
        res.destroy();
        return;
      }
      let translated: Buffer;
      try {
        translated = translate.translateResponse(raw);
      } catch (err) {
        // R10.18: an empty completion is not a translation failure — the
        // translation was fine, the upstream produced nothing. Say which it was,
        // or the message sends the reader hunting the wrong bug. Matched by name
        // rather than by class so the proxy keeps its layering and does not
        // import from providers/.
        // R10.23 adds UpstreamErrorResponse: an error-shaped 200 body. Same
        // reasoning as R10.18 — the translation worked, the upstream refused —
        // so relay ITS message rather than blaming the translator. Still matched
        // by name so the proxy keeps its layering and does not import providers/.
        const relayed =
          err instanceof Error &&
          (err.name === "EmptyCompletionError" || err.name === "UpstreamErrorResponse");
        failProxy(
          502,
          relayed
            ? `golem proxy: ${err.message}`
            : `golem proxy: could not translate the upstream response (${String(err)})`,
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(translated),
      });
      res.end(translated);
      report("ok", { status: 200, bytes: Buffer.byteLength(translated) });
      return;
    }

    res.writeHead(upstream.statusCode, forwardableResponseHeaders(upstream.headers));
    // Push headers immediately so SSE clients see the response open
    // before the first event arrives.
    res.flushHeaders();

    // Limit prediction (snooze P2a): observe the upstream rate-limit headers.
    // Header-only, never touches the body pipe below — fidelity preserved.
    // Fire-and-forget; must never throw or delay the response.
    const onResponseHeaders = this.config.onResponseHeaders;
    if (onResponseHeaders !== undefined) {
      try {
        onResponseHeaders(upstream.headers, forward);
      } catch {
        // observe-only — a prediction error can never affect the forwarded response
      }
    }

    // R1.1: optional read-only usage sniffer (verification-notes §30-37) —
    // only constructed when a consumer is listening, so the byte pipe stays
    // the plain two-stream case by default.
    //
    // R11.7: the outcome hook is a second consumer of the same scan — it needs
    // the byte count and, for an SSE body, whether the stream ended with
    // `message_stop`. One sniffer answers both, so the pipe still has exactly
    // one observation hop rather than two.
    const onResponseUsage = this.config.onResponseUsage;
    const wantsOutcome = this.config.onRequestOutcome !== undefined;
    const upstreamStatus = upstream.statusCode;
    const isStream = (this.header(upstream.headers, "content-type") ?? "")
      .toLowerCase()
      .includes("event-stream");

    try {
      if (onResponseUsage !== undefined || wantsOutcome) {
        // Still a raw byte pipe end-to-end — the sniffer forwards every
        // chunk unmodified (see usage-sniffer.ts); it never parses/transforms
        // what reaches the client.
        const sniffer = new UsageSniffer(
          this.header(upstream.headers, "content-type"),
          this.header(upstream.headers, "content-encoding"),
        );
        await pipeline(upstream.body, sniffer, res);
        onResponseUsage?.(sniffer.usage, forward);
        const end = sniffer.termination;
        // R11.7 — the one thing only the proxy can see. An Anthropic Messages
        // stream ends with `message_stop`; ending without it, and without an
        // `error` event to explain why, means the response was TRUNCATED. That
        // is what the client reports as "Connection lost mid-response", and it
        // used to leave no trace on this side at all.
        const truncated = end.streaming && !end.sawMessageStop && !end.sawErrorEvent;
        report(upstreamStatus >= 400 ? "upstream_error" : truncated ? "truncated" : "ok", {
          status: upstreamStatus,
          bytes: sniffer.bytes,
          streaming: end.streaming,
          lastEvent: end.lastEvent,
          ...(end.streaming ? { events: end.events } : {}),
          ...(truncated
            ? {
                detail:
                  "the SSE stream ended with no message_stop and no error event — " +
                  "the response reaching the client is incomplete",
              }
            : {}),
        });
      } else {
        // Raw byte pipe — the streaming path is never parsed or transformed.
        await pipeline(upstream.body, res);
      }
    } catch {
      // Mid-stream failure (upstream died or client hung up): we cannot
      // change the status any more, so surface truncation to the client.
      res.destroy();
      upstream.body.destroy();
      // R11.7: and say so on this side. A client that hung up is not a failure;
      // anything else is a stream that stopped before it finished.
      report(abort.signal.aborted ? "client_gone" : "truncated", {
        status: upstreamStatus,
        streaming: isStream,
        detail: abort.signal.aborted
          ? "the client hung up mid-stream"
          : "the response stream failed mid-flight",
      });
    }
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private respondProxyError(
    res: ServerResponse,
    status: number,
    message?: string,
    body?: string,
  ): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const payload =
      body ??
      JSON.stringify({
        type: "error",
        error: { type: "api_error", message: message ?? "golem proxy: internal error" },
      });
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      [PROXY_ERROR_HEADER]: "true",
    });
    res.end(payload);
  }
}
