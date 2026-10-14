/**
 * DUST2.17 — the durable record of which upstream each proxied request went to.
 *
 * ADR-0003 invariant 5 says every (request -> target, why) selection is
 * attributable. The only record was a stderr line in `.golem/proxy.log`, written
 * only with more than one target configured and truncated on every daemon start.
 * This log is written for EVERY request, single-target included, under
 * `.golem/state/` where a restart leaves it alone.
 *
 * What a line holds — and nothing else:
 *   `{ts, gateway, provider, target, reason}` as one JSON object, plus an
 *   occasional `{ts, dropped}` marker when lines were shed under backpressure.
 *
 * - No URL (a route URL can carry userinfo or a `?key=` query), no header, no
 *   env value, no request body. The fields come from the resolved registry entry
 *   (ids and a provider name), never from the transport.
 * - `reason` is the one field derived from request text (a `golem/<id>` model id
 *   or the target header's value), so it is passed through the redaction stage,
 *   stripped of control characters and capped. Redaction itself is untouched.
 *
 * Bounded: past {@link SELECTION_LOG_MAX_BYTES} the live file is renamed aside
 * (renameWithRetry) and only {@link SELECTION_LOG_KEEP_ROTATED} rotated files
 * survive. Appends run on a single in-process chain off the request path;
 * every failure is swallowed, and when the chain is backed up past
 * {@link SELECTION_LOG_MAX_PENDING} further lines are dropped rather than queued.
 */

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { redactStandaloneText } from "../pipeline/redaction.js";
import { renameWithRetry } from "./win-fs-retry.js";

export const SELECTION_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const SELECTION_LOG_KEEP_ROTATED = 2;
export const SELECTION_LOG_MAX_PENDING = 1000;
const REASON_MAX_CHARS = 200;
const ROTATED_RE = /^selection-log\.(\d{13})-[^/\\]+\.jsonl$/;

export function selectionLogPath(projectDir: string): string {
  return path.join(projectDir, ".golem", "state", "selection-log.jsonl");
}

export interface SelectionEntry {
  /** The `proxy.gateways` id backing the credential, or null for the legacy/inherited path. */
  readonly gateway: string | null;
  readonly provider: string;
  /**
   * One rule for every path: the registry target id when the target has one,
   * else `gateway ?? provider`. Callers pass it already resolved.
   */
  readonly target: string;
  readonly reason: string;
}

export interface SelectionLogOptions {
  readonly now?: () => Date;
  readonly maxBytes?: number;
  readonly keep?: number;
  readonly maxPending?: number;
  /** Test seam: runs between measuring the live file and re-checking it before the rename. */
  readonly afterMeasure?: () => Promise<void>;
}

export interface SelectionLog {
  /** Fire and forget; never throws, never blocks the caller. */
  record(entry: SelectionEntry): void;
  /** Resolves once everything accepted so far has been attempted. Tests and shutdown. */
  flush(): Promise<void>;
}

/**
 * Collapse whitespace and cap BEFORE redacting, so a padded model id costs
 * O(cap) in the redaction stage, then redact. A cap that lands mid-token drops
 * that trailing fragment: half a secret must not survive redaction by being too
 * short to match. Total: never throws.
 */
export function sanitizeReason(reason: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const flat = reason.replace(/[\s\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  let capped = flat;
  let truncated = false;
  if (flat.length > REASON_MAX_CHARS) {
    truncated = true;
    capped = flat.slice(0, REASON_MAX_CHARS);
    if (flat[REASON_MAX_CHARS] !== " ") {
      const lastSpace = capped.lastIndexOf(" ");
      capped = lastSpace === -1 ? "" : capped.slice(0, lastSpace);
    }
  }
  let redacted: string;
  try {
    redacted = redactStandaloneText(capped);
  } catch {
    return "(reason withheld)";
  }
  return truncated ? `${redacted}…` : redacted;
}

/** Await `flush`, but never longer than `ms` and never rejecting: for shutdown. */
export async function flushBounded(flush: () => Promise<void>, ms = 500): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      flush().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

let lastStamp = 0;

export function createSelectionLog(
  projectDir: string,
  options: SelectionLogOptions = {},
): SelectionLog {
  const file = selectionLogPath(projectDir);
  const now = options.now ?? (() => new Date());
  const maxBytes = options.maxBytes ?? SELECTION_LOG_MAX_BYTES;
  const keep = options.keep ?? SELECTION_LOG_KEEP_ROTATED;
  const maxPending = options.maxPending ?? SELECTION_LOG_MAX_PENDING;
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let dropped = 0;

  const write = async (line: string): Promise<void> => {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, line, "utf8");
      await rotateIfLarge(file, maxBytes, keep, options.afterMeasure);
    } catch {
      // A log that cannot be written is not worth a request.
    }
  };

  const enqueue = (line: string): void => {
    pending += 1;
    chain = chain
      .then(() => write(line))
      .finally(() => {
        pending -= 1;
      });
  };

  return {
    record(entry) {
      try {
        if (pending >= maxPending) {
          dropped += 1;
          return;
        }
        const ts = now().toISOString();
        if (dropped > 0) {
          // One marker per gap, written ahead of the line that proves recovery.
          enqueue(`${JSON.stringify({ ts, dropped })}\n`);
          dropped = 0;
        }
        enqueue(
          `${JSON.stringify({
            ts,
            gateway: entry.gateway,
            provider: entry.provider,
            target: entry.target,
            reason: sanitizeReason(entry.reason),
          })}\n`,
        );
      } catch {
        // Observe-only.
      }
    },
    flush: () => chain.catch(() => undefined),
  };
}

async function statOrNull(file: string): Promise<{ size: number; ino: number } | null> {
  try {
    const st = await stat(file);
    return { size: st.size, ino: st.ino };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Same re-stat + inode guard as src/session/host-log.ts rotateIfLarge: if another
// writer rotated between measuring and renaming, do not rename the young file.
// (The two copies are a recorded follow-up, not extracted here.)
async function rotateIfLarge(
  file: string,
  maxBytes: number,
  keep: number,
  afterMeasure?: () => Promise<void>,
): Promise<void> {
  const measured = await statOrNull(file);
  if (measured === null || measured.size <= maxBytes) return;
  await afterMeasure?.();
  const nowStat = await statOrNull(file);
  if (nowStat === null || nowStat.size <= maxBytes) return;
  if (measured.ino !== 0 && nowStat.ino !== measured.ino) return;
  const dir = path.dirname(file);
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  const aside = path.join(
    dir,
    `selection-log.${String(lastStamp).padStart(13, "0")}-${process.pid}-${randomBytes(4).toString("hex")}.jsonl`,
  );
  try {
    await renameWithRetry(file, aside);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const rotated = (await readdir(dir)).filter((n) => ROTATED_RE.test(n)).sort();
  for (const name of rotated.slice(0, Math.max(0, rotated.length - keep))) {
    await unlink(path.join(dir, name)).catch(() => undefined);
  }
}
