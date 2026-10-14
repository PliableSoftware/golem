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
 *   `{ts, gateway, provider, target, reason, sticky}` as one JSON object.
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
  readonly target: string;
  readonly reason: string;
  readonly sticky?: boolean;
}

export interface SelectionLogOptions {
  readonly now?: () => Date;
  readonly maxBytes?: number;
  readonly keep?: number;
}

export interface SelectionLog {
  /** Fire and forget; never throws, never blocks the caller. */
  record(entry: SelectionEntry): void;
  /** Resolves once everything accepted so far has been attempted. Tests and shutdown. */
  flush(): Promise<void>;
}

/** Strip control characters, redact, cap. Total: never throws. */
export function sanitizeReason(reason: string): string {
  let text: string;
  try {
    text = redactStandaloneText(reason);
  } catch {
    return "(reason withheld)";
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return flat.length > REASON_MAX_CHARS ? `${flat.slice(0, REASON_MAX_CHARS)}…` : flat;
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
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;

  const write = async (line: string): Promise<void> => {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, line, "utf8");
      await rotateIfLarge(file, maxBytes, keep);
    } catch {
      // A log that cannot be written is not worth a request.
    }
  };

  return {
    record(entry) {
      try {
        if (pending >= SELECTION_LOG_MAX_PENDING) return;
        const line = `${JSON.stringify({
          ts: now().toISOString(),
          gateway: entry.gateway,
          provider: entry.provider,
          target: entry.target,
          reason: sanitizeReason(entry.reason),
          ...(entry.sticky === true ? { sticky: true } : {}),
        })}\n`;
        pending += 1;
        chain = chain
          .then(() => write(line))
          .finally(() => {
            pending -= 1;
          });
      } catch {
        // Observe-only.
      }
    },
    flush: () => chain.catch(() => undefined),
  };
}

async function rotateIfLarge(file: string, maxBytes: number, keep: number): Promise<void> {
  const size = (await stat(file)).size;
  if (size <= maxBytes) return;
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
