/**
 * WS-A A3 — the redaction stage: strip secrets/PII from request content
 * BEFORE anything is transformed, stored, or forwarded (CLAUDE.md hard rule).
 *
 * ## Determinism & prefix stability (verification-notes §14)
 * Redaction MUST be a pure function of the input text: same input prefix ->
 * same output prefix, forever. If it were not, prompt-cache hits would break
 * on every request. Two design choices enforce this:
 *
 *  1. Placeholder numbering is per-VALUE, not per-occurrence. Each distinct
 *     secret string maps to a stable index the first time it is seen within a
 *     single redaction pass, counted per placeholder kind; repeats of the
 *     same secret reuse the same placeholder. Because messages are redacted
 *     in order, prepending later turns can never renumber an earlier one.
 *  2. No clock, randomness, or config feeds a placeholder — only the rule id
 *     and the running per-kind counter.
 *
 * Placeholders look like `[REDACTED:aws-key:1]`. The brackets/colon are
 * outside every rule's charset and the entropy candidate charset (and
 * `connection-password` explicitly skips a whole placeholder), so the stage is
 * idempotent: redacting already-redacted text is a no-op. Proven per rule in
 * tests/unit/pipeline/redaction.test.ts.
 *
 * The stage reports a TokenDelta so telemetry (A4) can attribute how much a
 * request was reduced by redaction (usually a small increase — placeholders
 * are longer than short keys — but never a fidelity risk).
 */

import { estimateTokens } from "../compression/index.js";
import type { TokenDelta } from "../interfaces/compression.js";
import { RedactionAborted } from "../proxy/request-body.js";
import { isRecord } from "../shared/json.js";
import {
  activeRedactionRules,
  ENTROPY_CANDIDATE_RE,
  ENTROPY_RULE_ID,
  findEmbeddedSecrets,
  findOverlengthRuns,
  isApiObjectId,
  isHighEntropyToken,
  type RedactionRule,
} from "./redaction-rules.js";

/** Outcome of redacting one string. */
export interface RedactionResult {
  readonly text: string;
  /** Number of individual secret occurrences replaced. */
  readonly count: number;
}

/**
 * Per-pass placeholder allocator. Assigns each distinct (kind, value) a
 * stable 1-based index within the pass, so the same secret always renders the
 * same placeholder and re-numbering is impossible for a fixed input.
 */
class PlaceholderTable {
  /** kind -> (secret value -> index) */
  readonly #byKind = new Map<string, Map<string, number>>();

  placeholderFor(kind: string, value: string): string {
    let values = this.#byKind.get(kind);
    if (values === undefined) {
      values = new Map();
      this.#byKind.set(kind, values);
    }
    let index = values.get(value);
    if (index === undefined) {
      index = values.size + 1;
      values.set(value, index);
    }
    return `[REDACTED:${kind}:${index}]`;
  }

  /**
   * Every placeholder this pass allocated, paired with the ORIGINAL value it
   * replaced. Used only by {@link redactReversibleText} (R9.3) to restore a
   * remote model's reply; the map never leaves the process and is never
   * serialized, stored, or logged.
   */
  entries(): [placeholder: string, original: string][] {
    const out: [string, string][] = [];
    for (const [kind, values] of this.#byKind) {
      for (const [value, index] of values) out.push([`[REDACTED:${kind}:${index}]`, value]);
    }
    return out;
  }
}

/** Hard bound on the DUSTSEC.22 re-scan loop in {@link redactText}. */
const MAX_REDACTION_PASSES = 16;
let passBound = MAX_REDACTION_PASSES;

/**
 * Thrown when the in-run scan still finds something on the final pass: the text
 * may still hold a secret, so redaction FAILS CLOSED rather than return it. The
 * proxy answers a throw from the pipeline, and from `redactOnly`, with a 502 and
 * forwards nothing.
 */
export class RedactionBoundExceeded extends Error {
  constructor(passes: number) {
    super(
      `redaction did not converge in ${passes} passes over an over-length run; ` +
        "refusing to return text that may still hold a secret (fail closed)",
    );
    this.name = "RedactionBoundExceeded";
  }
}

/** TEST ONLY: lower the pass bound; returns a function that restores it. */
export function setRedactionPassBoundForTest(bound: number): () => void {
  const previous = passBound;
  passBound = bound;
  return () => {
    passBound = previous;
  };
}

/**
 * A rule's `scanEnd` is trusted code, but a wrong answer must fail toward MORE
 * redaction, never less: anything that is not an integer in `[0, length]` (NaN,
 * negative, fractional, past the end, not a number) scans the whole text.
 */
export function clampScanEnd(raw: number, length: number): number {
  return Number.isInteger(raw) && raw >= 0 && raw <= length ? raw : length;
}

function passesChecks(
  rule: RedactionRule,
  text: string,
  start: number,
  end: number,
  target: string,
): boolean {
  if (rule.validate !== undefined && !rule.validate(target)) return false;
  return rule.validateAt === undefined || rule.validateAt(text, start, end);
}

function applyRule(text: string, rule: RedactionRule, table: PlaceholderTable): [string, number] {
  // Redact by the EXACT matched span (whole match, or the captured group at its
  // real index) — never by first-substring replace, which can hit the wrong
  // occurrence and leak the actual secret (T-C3, verification-notes §24). The
  // `d` flag gives per-group start/end indices so a group rule redacts precisely
  // the captured range and leaves the rest of the match (e.g. the host in a
  // connection string) untouched.
  const flags = rule.pattern.flags.includes("d") ? rule.pattern.flags : `${rule.pattern.flags}d`;
  const re = new RegExp(rule.pattern.source, flags);

  let count = 0;
  let result = "";
  let cursor = 0;
  // DUSTSEC.24: a rule may bound the part of the text it can match in (see `scanEnd`).
  const haystack =
    rule.scanEnd === undefined
      ? text
      : text.slice(0, clampScanEnd(rule.scanEnd(text), text.length));
  for (const m of haystack.matchAll(re)) {
    const whole = m[0];
    const matchStart = m.index ?? 0;
    let redactStart = matchStart;
    let redactEnd = matchStart + whole.length;
    let target = whole;

    // An empty match is not a secret. A zero-width pattern (a plugin's `/x*/g`,
    // or a lookahead) would otherwise get a placeholder at every position.
    if (whole === "" && rule.group === undefined) continue;

    if (rule.group !== undefined) {
      const span = m.indices?.[rule.group];
      const value = m[rule.group];
      if (span === undefined || value === undefined || value === "") {
        continue; // no captured group → leave this match as-is
      }
      [redactStart, redactEnd] = span;
      target = value;
    }
    if (rule.extendStart !== undefined && rule.group === undefined) {
      const from = rule.extendStart(text, matchStart, cursor);
      if (from === -1) continue; // nothing in front of the tail: not a match
      redactStart = Number.isInteger(from) && from >= cursor && from <= matchStart ? from : cursor;
      target = text.slice(redactStart, redactEnd);
    }
    if (!passesChecks(rule, text, redactStart, redactEnd, target)) {
      // DUSTSEC.26: a rejected greedy run may hold the secret at its tail. Only reached
      // for a match the rule would have left alone, so nothing redacted before changes.
      const offsets = rule.retryStarts?.(target) ?? [];
      let retried = false;
      for (const offset of offsets) {
        if (!Number.isInteger(offset) || offset <= 0 || offset >= target.length) continue;
        const from = redactStart + offset;
        const sub = target.slice(offset);
        if (passesChecks(rule, text, from, redactEnd, sub)) {
          redactStart = from;
          target = sub;
          retried = true;
          break;
        }
      }
      if (!retried) continue; // failed the extra checks (e.g. Luhn) -> not a secret, leave it
    }

    result += text.slice(cursor, redactStart);
    result += table.placeholderFor(rule.id, target);
    cursor = redactEnd;
    count += 1;
  }
  result += text.slice(cursor);
  return [result, count];
}

/**
 * DUSTSEC.22 — redact named-prefix secrets glued inside runs longer than the
 * sweep's ceiling. Only the matched span is replaced; the rest of the run is
 * returned untouched, so base64 data holding no such secret is byte-identical.
 * Runs BEFORE the sweep so the fragments it leaves are swept in the same pass,
 * which keeps redaction idempotent.
 */
function applyOverlengthRuns(text: string, table: PlaceholderTable): [string, number] {
  let count = 0;
  let out = "";
  let cursor = 0;
  for (const [runStart, runEnd] of findOverlengthRuns(text)) {
    const run = text.slice(runStart, runEnd);
    const spans = findEmbeddedSecrets(run);
    if (spans.length === 0) continue;
    out += text.slice(cursor, runStart);
    let at = 0;
    for (const span of spans) {
      out += run.slice(at, span.start);
      out += table.placeholderFor(span.id, run.slice(span.start, span.end));
      at = span.end;
      count += 1;
    }
    out += run.slice(at);
    cursor = runEnd;
  }
  return count === 0 ? [text, 0] : [out + text.slice(cursor), count];
}

function applyEntropy(text: string, table: PlaceholderTable): [string, number, number] {
  const [scanned, embeddedCount] = applyOverlengthRuns(text, table);
  let count = embeddedCount;
  const out = scanned.replace(ENTROPY_CANDIDATE_RE, (match: string): string => {
    if (isApiObjectId(match) || !isHighEntropyToken(match)) {
      return match;
    }
    count += 1;
    return table.placeholderFor(ENTROPY_RULE_ID, match);
  });
  return [out, count, embeddedCount];
}

/**
 * Redact one string with a shared placeholder table. Rules run in table
 * order, then the high-entropy sweep runs last so provider-specific rules win
 * the placeholder kind for any string both would match.
 *
 * The table is `activeRedactionRules()`: every built-in, in their audited order,
 * followed by any plugin-contributed rules (R8.11 / ADR-0005). Built-ins are
 * always first and a plugin can only append, so an extension can redact *more*
 * and never less.
 */
export function redactText(text: string, table: PlaceholderTable): RedactionResult {
  let current = text;
  let total = 0;
  // DUSTSEC.22: cutting a secret out of an over-length run leaves fragments that
  // are tokens of their own (a boundary, a short run). Re-run the whole stage on
  // the result while the in-run scan keeps finding something, so a second
  // redaction pass is a no-op. Each extra pass strictly shortens the text that
  // can still hold a secret. Reaching the bound is an error, never a silent stop.
  for (let pass = 0; pass < passBound; pass += 1) {
    for (const rule of activeRedactionRules()) {
      const [next, count] = applyRule(current, rule, table);
      current = next;
      total += count;
    }
    const [afterEntropy, entropyCount, embeddedCount] = applyEntropy(current, table);
    current = afterEntropy;
    total += entropyCount;
    if (embeddedCount === 0) return { text: current, count: total };
  }
  throw new RedactionBoundExceeded(passBound);
}

/**
 * Redact a single, standalone string with its own fresh placeholder table:
 * the full {@link REDACTION_RULES} table plus the high-entropy sweep, as a
 * pure `(text) => text` function. Convenience entry point for callers that
 * redact one independent string at a time (e.g. the PostToolUse hook's
 * tool-output text, T-C3) and don't need placeholders shared across multiple
 * strings the way {@link redactRequestBody} shares one table across a whole
 * request body. Allocating a fresh table per call keeps this pure and
 * deterministic — no state survives between calls.
 */
export function redactStandaloneText(text: string): string {
  return redactText(text, new PlaceholderTable()).text;
}

/**
 * Rule table only — every built-in and plugin rule, in order, but NOT the
 * high-entropy sweep. For an identifier field that must stay usable as a key
 * (a filesystem path): the entropy detector treats any long run of
 * `[A-Za-z0-9/_-]` as a candidate secret, so it would mangle ordinary paths.
 * Provider-shaped secrets (AWS keys, tokens, PEM blocks...) are still caught.
 * Free text must use {@link redactStandaloneText}.
 */
export function redactIdentifierText(text: string): string {
  const table = new PlaceholderTable();
  let current = text;
  for (const rule of activeRedactionRules()) {
    current = applyRule(current, rule, table)[0];
  }
  return current;
}

/** A redaction whose placeholders can be put back afterwards. */
export interface ReversibleRedaction {
  /** The redacted text — this is what may leave the machine. */
  readonly text: string;
  readonly count: number;
  /**
   * Restore the original values in a reply that came back referring to the
   * placeholders. Pure; safe to call on text containing none.
   */
  readonly restore: (reply: string) => string;
}

/**
 * R9.3 — redact a string for dispatch to a NON-LOCAL model, keeping the
 * placeholder table so the model's reply can be de-redacted before it reaches
 * the caller.
 *
 * Why this exists: `coder` may now name a remote target, which makes it an
 * egress path. Redaction has to run before dispatch (CLAUDE.md hard rule), but a
 * draft full of `[REDACTED:aws-key:1]` is useless — so the round trip is part of
 * the requirement, not a nicety.
 *
 * **This does not weaken redaction anywhere.** It is an additional entry point
 * beside {@link redactStandaloneText}, using the exact same rules and the same
 * per-value placeholder allocation; the restoration map lives only in memory for
 * the duration of one dispatch and is never sent, stored, or logged. What
 * crosses the wire is identical to what `redactStandaloneText` would have
 * produced.
 *
 * Placeholders carry their closing bracket, so no placeholder is a prefix of
 * another (`[REDACTED:x:1]` cannot match inside `[REDACTED:x:11]`) and
 * restoration needs no ordering care.
 */
export function redactReversibleText(text: string): ReversibleRedaction {
  const many = redactReversibleTexts([text]);
  return {
    // `redactReversibleTexts` always returns one entry per input.
    text: many.texts[0] as string,
    count: many.count,
    restore: many.restore,
  };
}

/** A reversible redaction over several strings that share one placeholder table. */
export interface ReversibleRedactionMulti {
  /** The redacted strings, positionally matching the input — these may leave the machine. */
  readonly texts: readonly string[];
  /** Total redacted occurrences across every input. */
  readonly count: number;
  /** Restore the original values in a reply. Pure; safe on text containing none. */
  readonly restore: (reply: string) => string;
}

/**
 * R13.11 — the multi-string form of {@link redactReversibleText}, for a dispatch
 * that sends a CONVERSATION rather than one prompt.
 *
 * One shared {@link PlaceholderTable} is the whole point, and the reason this is
 * not just a `.map()` over the single-string entry point. Redacting each message
 * independently would allocate a fresh table per message, so the same secret
 * would become `[REDACTED:aws-key:1]` in two different messages while meaning
 * two different values — and a single `restore` map could then only put one of
 * them back, silently corrupting the other. Sharing the table is exactly what
 * {@link redactRequestBody} already does across a whole request body, for the
 * same reason.
 *
 * **This does not weaken redaction.** Same rules, same allocation, same
 * in-memory-only restoration map as the single-string form — which is now
 * implemented in terms of this function so the two cannot drift.
 */
export function redactReversibleTexts(texts: readonly string[]): ReversibleRedactionMulti {
  const table = new PlaceholderTable();
  let count = 0;
  const redacted = texts.map((text) => {
    const result = redactText(text, table);
    count += result.count;
    return result.text;
  });
  const entries = table.entries();
  return {
    texts: redacted,
    count,
    restore: (reply: string): string => {
      let out = reply;
      for (const [placeholder, original] of entries) out = out.split(placeholder).join(original);
      return out;
    },
  };
}

/**
 * Recursively redact every string in a JSON value, sharing one placeholder
 * table across the whole request so the same secret gets the same placeholder
 * everywhere it appears. Object key order is preserved (spread keeps existing
 * keys in place) so re-serialization stays byte-stable.
 *
 * DUSTSEC.23: this recursive walk is the SYNC reference and is deliberately left
 * as it always was (stack depth, speed). The proxy request path uses
 * {@link redactRequestBodyAsync}, an iterative, time-sliced walk that a
 * differential test holds to the same bytes.
 */
function redactValue(value: unknown, table: PlaceholderTable, stats: { count: number }): unknown {
  if (typeof value === "string") {
    const result = redactText(value, table);
    stats.count += result.count;
    return result.count === 0 ? value : result.text;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = redactValue(item, table, stats);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (isRecord(value)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const next = redactValue(v, table, stats);
      if (next !== v) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

export interface RedactBodyResult {
  /** The request body with secrets replaced (same object identity if none). */
  readonly value: unknown;
  /** Occurrences replaced across the whole body. */
  readonly count: number;
  /** Token estimate before/after redaction (for telemetry attribution). */
  readonly delta: TokenDelta;
  /**
   * `JSON.stringify(value)`, set only by {@link redactRequestBodyAsync} and only when
   * something was redacted: the walk already serialised the result for the token
   * estimate, and a caller that needs the bytes reuses it instead of paying a second
   * identical `JSON.stringify` (DUSTSEC.23).
   */
  readonly json?: string;
}

/**
 * Redact a parsed request body in place-preserving fashion. Runs over the
 * ENTIRE JSON: every string value (system prompt, every message, tool
 * definitions, tool_result content). Object keys are not redacted (S9 is
 * open). A secret anywhere must be stripped before it leaves the machine
 * or is handed to compression's CCR store.
 *
 * Synchronous: it holds the event loop for the whole walk. Anything on the
 * proxy's request path uses {@link redactRequestBodyAsync} (DUSTSEC.23).
 */
export function redactRequestBody(body: unknown): RedactBodyResult {
  const table = new PlaceholderTable();
  const stats = { count: 0 };
  const tokensBefore = estimateTokens(JSON.stringify(body) ?? "");
  const value = redactValue(body, table, stats);
  const tokensAfter =
    stats.count === 0 ? tokensBefore : estimateTokens(JSON.stringify(value) ?? "");
  return { value, count: stats.count, delta: { tokensBefore, tokensAfter } };
}

/** The slice budget of the async walk: wall time between two yields to the event loop. */
export const REDACTION_SLICE_MS = 20;

export { RedactionAborted };

export interface RedactBodyAsyncOptions {
  /** Aborts the walk between slices; the walk then rejects with {@link RedactionAborted}. */
  readonly signal?: AbortSignal;
  /** Shared by the steps of one request so the yields account for all its work; default: a new one. */
  readonly pacer?: RedactionPacer;
  /** TEST ONLY: slice budget in ms (default {@link REDACTION_SLICE_MS}). */
  readonly sliceMs?: number;
}

/** Hand the event loop one turn: I/O (poll) callbacks run before a setImmediate callback. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Work done since the last turn handed to the event loop beyond which the next step yields first. */
const PAUSE_AFTER_MS = 5;

/**
 * Paces one request's redaction between its unsliceable steps (a parse, a duplicate-key
 * scan, a stringify) and its sliced walk. `pause()` hands the event loop a turn only if
 * at least {@link PAUSE_AFTER_MS} of work ran since the last one, so a small body never
 * yields at all (no timer machinery in the common case) and a large one yields between
 * its big steps instead of running them back to back. Both kinds of pause stop with
 * {@link RedactionAborted} once the request was cancelled.
 */
export class RedactionPacer {
  #last = performance.now();
  readonly #signal: AbortSignal | undefined;

  constructor(signal?: AbortSignal) {
    this.#signal = signal;
  }

  throwIfAborted(): void {
    if (this.#signal?.aborted === true) throw new RedactionAborted();
  }

  /** Yield only if enough work ran since the last turn given away. */
  async pause(): Promise<void> {
    this.throwIfAborted();
    if (performance.now() - this.#last < PAUSE_AFTER_MS) return;
    await this.yieldNow();
  }

  /** Yield unconditionally (a spent slice). */
  async yieldNow(): Promise<void> {
    await yieldToEventLoop();
    this.#last = performance.now();
    this.throwIfAborted();
  }
}

type WalkFrame =
  | {
      readonly arr: true;
      readonly src: readonly unknown[];
      out: unknown[];
      i: number;
      changed: boolean;
    }
  | {
      readonly arr: false;
      readonly src: Record<string, unknown>;
      readonly entries: [string, unknown][];
      out: Record<string, unknown>;
      i: number;
      changed: boolean;
    };

/** Cost units between two clock reads: 1 per value, plus 1 per 32 characters of a string. */
const CLOCK_EVERY = 256;

/**
 * The same walk as {@link redactValue}, iterative: an explicit stack instead of
 * recursion, so it can never overflow the call stack (its depth is bounded only by
 * the `JSON.stringify` the caller already ran over the body) and costs no
 * allocation per primitive. `run` works until the slice is spent and returns
 * whether the walk finished. Output, identity and mutation behaviour (none) are
 * those of the recursive walk; a differential test holds it to that.
 */
class SlicedWalk {
  count = 0;
  value: unknown;
  readonly #table: PlaceholderTable;
  // A one-slot frame holds the root, so the root is committed like any child.
  readonly #stack: WalkFrame[];

  constructor(root: unknown, table: PlaceholderTable) {
    this.#table = table;
    this.#stack = [{ arr: true, src: [root], out: new Array<unknown>(1), i: 0, changed: false }];
  }

  run(sliceMs: number): boolean {
    const deadline = performance.now() + sliceMs;
    const stack = this.#stack;
    let cost = 0;
    for (;;) {
      // Every iteration counts: pushing and finishing a container cost a unit too, so
      // a body made mostly of containers cannot run as one slice. All state lives in
      // the frames, so stopping at the top of the loop is always safe.
      if (cost >= CLOCK_EVERY) {
        cost = 0;
        if (performance.now() >= deadline) return false;
      }
      const top = stack[stack.length - 1] as WalkFrame;
      let child: unknown;
      if (top.arr) {
        // Holes stay holes, as with `Array.prototype.map`.
        while (top.i < top.src.length && !(top.i in top.src)) top.i += 1;
        if (top.i >= top.src.length) {
          if (stack.length === 1) {
            this.value = top.out[0];
            return true;
          }
          this.#finish(stack);
          cost += 1;
          continue;
        }
        child = top.src[top.i];
      } else {
        if (top.i >= top.entries.length) {
          this.#finish(stack);
          cost += 1;
          continue;
        }
        child = (top.entries[top.i] as [string, unknown])[1];
      }
      let next: unknown = child;
      if (typeof child === "string") {
        const result = redactText(child, this.#table);
        this.count += result.count;
        if (result.count !== 0) next = result.text;
        cost += child.length >> 5;
      } else if (typeof child === "object" && child !== null) {
        if (Array.isArray(child)) {
          stack.push({
            arr: true,
            src: child,
            out: new Array<unknown>(child.length),
            i: 0,
            changed: false,
          });
          cost += 1;
          continue;
        }
        if (isRecord(child)) {
          stack.push({
            arr: false,
            src: child,
            entries: Object.entries(child),
            out: {},
            i: 0,
            changed: false,
          });
          cost += 1;
          continue;
        }
      }
      commit(top, next, child);
      cost += 1;
    }
  }

  /** Pop a finished container and commit its result (or itself, if unchanged) into its parent. */
  #finish(stack: WalkFrame[]): void {
    const done = stack.pop() as WalkFrame;
    const parent = stack[stack.length - 1] as WalkFrame;
    commit(parent, done.changed ? done.out : done.src, done.src);
  }
}

function commit(frame: WalkFrame, next: unknown, original: unknown): void {
  if (next !== original) frame.changed = true;
  if (frame.arr) frame.out[frame.i] = next;
  else frame.out[(frame.entries[frame.i] as [string, unknown])[0]] = next;
  frame.i += 1;
}

/**
 * DUSTSEC.23 — {@link redactRequestBody} that gives the event loop back every
 * {@link REDACTION_SLICE_MS} ms, so a 32 MiB body of many small strings no longer
 * freezes every other session's streams for tens of seconds. Same rules, same
 * order, same placeholder table: the result is byte-identical to the sync one (a
 * differential test holds it to that). Fail closed: a throw inside any slice
 * rejects the promise, and an abort rejects with {@link RedactionAborted}; neither
 * ever returns unredacted content.
 *
 * The unsliceable steps (a `JSON.stringify` of the body for the token estimate
 * before the walk and of the result after it, and one single very long string) are
 * separated by yields so they never run back to back.
 */
export async function redactRequestBodyAsync(
  body: unknown,
  options: RedactBodyAsyncOptions = {},
): Promise<RedactBodyResult> {
  const { signal } = options;
  const sliceMs = options.sliceMs ?? REDACTION_SLICE_MS;
  const pacer = options.pacer ?? new RedactionPacer(signal);
  pacer.throwIfAborted();
  await pacer.pause();
  const tokensBefore = estimateTokens(JSON.stringify(body) ?? "");
  await pacer.pause();
  const walk = new SlicedWalk(body, new PlaceholderTable());
  while (!walk.run(sliceMs)) await pacer.yieldNow();
  if (walk.count === 0) {
    return { value: walk.value, count: 0, delta: { tokensBefore, tokensAfter: tokensBefore } };
  }
  await pacer.pause();
  const json = JSON.stringify(walk.value);
  return {
    value: walk.value,
    count: walk.count,
    delta: { tokensBefore, tokensAfter: estimateTokens(json ?? "") },
    ...(json !== undefined ? { json } : {}),
  };
}
