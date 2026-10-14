/**
 * `src/plugins/safe-text.ts` — turn third-party error text into something safe
 * to log or print (DUST2.11).
 *
 * Plugin code controls the text of every error it throws, and that text ends up
 * in `proxy.log` and in `golem plugin` output. Two rules, both load-bearing:
 *
 *  - REDACT THE WHOLE TEXT, THEN TRUNCATE. Cutting first and redacting second
 *    lets a secret that straddles the cut shrink below its rule's minimum length
 *    and survive; redacting first also shortens earlier secrets, which would
 *    drag a pre-cut boundary across a later one.
 *  - Never throw. `Object.create(null)`, a throwing `message` getter or a
 *    throwing `toString` land on a constant fallback.
 */

import { redactStandaloneText } from "../pipeline/redaction.js";

/** Longest error text kept in a fault reason, problem or log line. */
export const MAX_REASON_CHARS = 300;
/** Text longer than this is not scanned at all (redaction is linear but not free). */
export const MAX_SCAN_CHARS = 64 * 1024;

const FALLBACK = "(unprintable error)";

/**
 * Redact all of `text`, then keep at most {@link MAX_REASON_CHARS}. If the cut
 * lands inside a whitespace-delimited token, that partial token is dropped.
 */
export function redactForLog(text: string): string {
  try {
    if (text.length > MAX_SCAN_CHARS) return `(${text.length} chars of error text omitted)`;
    const redacted = redactStandaloneText(text);
    if (redacted.length <= MAX_REASON_CHARS) return redacted;
    let cut = redacted.slice(0, MAX_REASON_CHARS);
    const next = redacted[MAX_REASON_CHARS] as string;
    if (!/\s/.test(next)) {
      const lastSpace = cut.search(/\s\S*$/);
      cut = lastSpace < 0 ? "" : cut.slice(0, lastSpace);
    }
    return `${cut.trimEnd()}...`;
  } catch {
    return FALLBACK;
  }
}

/** Anything a plugin threw, as short redacted text. Cannot throw. */
export function describeThrown(err: unknown): string {
  try {
    const raw = err instanceof Error ? err.message : String(err);
    return redactForLog(typeof raw === "string" ? raw : String(raw));
  } catch {
    return FALLBACK;
  }
}
