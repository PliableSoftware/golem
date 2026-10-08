/**
 * Windows filesystem contention, in one place.
 *
 * On Windows an exclusive create (`open(path, "wx")`) on a file another handle
 * holds open, or that is pending delete or mid-rename, fails with EPERM, EACCES
 * or EBUSY — NOT EEXIST — and a `rename` over a destination with an open handle
 * (antivirus, an indexer, a reader) fails with the same codes. Both are
 * transient. On POSIX the same codes mean a real permission problem, so they are
 * only ever retried on win32.
 *
 * `platform`, `rename` and `sleep` are injectable so the Windows behaviour is
 * unit-testable on any host; production callers pass nothing.
 */

import { rename as fsRename } from "node:fs/promises";

const WIN_CONTENTION_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"]);

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * Did an exclusive create fail because someone else holds the lock? EEXIST
 * everywhere; EPERM/EACCES/EBUSY too, on win32 only.
 */
export function isLockContention(err: unknown, platform: NodeJS.Platform = process.platform) {
  const code = codeOf(err);
  if (code === "EEXIST") return true;
  return platform === "win32" && code !== undefined && WIN_CONTENTION_CODES.has(code);
}

/** Is this rename failure a transient Windows sharing violation worth retrying? */
export function isRenameRetryable(err: unknown, platform: NodeJS.Platform = process.platform) {
  const code = codeOf(err);
  return platform === "win32" && code !== undefined && WIN_CONTENTION_CODES.has(code);
}

export interface RenameRetryOptions {
  /** Defaults to `process.platform`. Retries happen on win32 only. */
  readonly platform?: NodeJS.Platform;
  /** Total attempts, first included. Default 10. */
  readonly tries?: number;
  /** Pause between attempts. Default 50ms, so ~450ms across the default 10 tries. */
  readonly delayMs?: number;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * `rename` that rides out a Windows sharing violation with a short bounded
 * backoff. The last error is rethrown unwrapped; any other error, or any error
 * off win32, is thrown at once.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameRetryOptions = {},
): Promise<void> {
  const tries = Math.max(1, options.tries ?? 10);
  const delayMs = options.delayMs ?? 50;
  const doRename = options.rename ?? fsRename;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (err) {
      if (attempt >= tries || !isRenameRetryable(err, options.platform)) throw err;
    }
    await sleep(delayMs);
  }
}
