/**
 * A small cross-process lock for the hook state files that are read, decided on
 * and written back (`spawn-gate.json`, `delegations.json`). Their writes are
 * atomic (temp + rename), but that only stops torn files: two processes that
 * both load before either saves still lose one update. The lock covers the whole
 * load -> decide -> save.
 *
 * `<file>.lock` is created exclusively (`wx`, `O_EXCL`/`CREATE_NEW`) and holds a
 * unique owner token. Release unlinks only while the token is still ours, so a
 * holder that ran past the stale threshold cannot delete its successor's lock. A
 * lock older than {@link STALE_LOCK_MS} belongs to a crashed holder and is broken
 * by renaming it aside (atomic) and retrying the exclusive create, never by
 * unlinking the shared name. If the lock cannot be had within the timeout the work
 * runs unlocked with one stderr line: these run in hooks on the critical path of a
 * tool call, and wedging the session over a bookkeeping file is worse than a rare
 * lost update.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const STALE_LOCK_MS = 10_000;
const ACQUIRE_TIMEOUT_MS = 5_000;
const RETRY_MS = 10;

export interface FileLockOptions {
  /** How long to wait for the lock before running unlocked. */
  readonly timeoutMs?: number;
  /** Age past which a held lock is treated as abandoned. */
  readonly staleMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** In-process queue per lock path, so same-process callers never spin on the file. */
const inProcessTail = new Map<string, Promise<unknown>>();

type Acquired = { readonly token: string } | { readonly failure: string };

/** Move an abandoned lock aside. Atomic; the loser of a race gets ENOENT. */
async function breakStale(lockFile: string, staleMs: number): Promise<void> {
  const aside = `${lockFile}.stale-${randomUUID()}`;
  try {
    await rename(lockFile, aside);
  } catch {
    return; // someone else broke or released it, or it cannot be moved
  }
  try {
    const { mtimeMs } = await stat(aside);
    if (Date.now() - mtimeMs <= staleMs) {
      // We moved a FRESH lock (a successor created it between our stat and rename).
      // Put it back if the name is still free; if not, its holder loses mutual
      // exclusion for this one narrow race, which the unlocked fallback tolerates.
      await rename(aside, lockFile).catch(() => unlink(aside).catch(() => undefined));
      return;
    }
  } catch {
    return;
  }
  await unlink(aside).catch(() => undefined);
}

async function acquire(lockFile: string, timeoutMs: number, staleMs: number): Promise<Acquired> {
  const token = `${process.pid}-${randomUUID()}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await writeFile(lockFile, token, { flag: "wx" });
      return { token };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") return { failure: code ?? String(err) };
    }
    try {
      const { mtimeMs } = await stat(lockFile);
      if (Date.now() - mtimeMs > staleMs) await breakStale(lockFile, staleMs);
    } catch {
      // released between our create and stat — fall through to the bounded retry
    }
    // Every iteration, including after a stale-break attempt, checks the deadline
    // and sleeps: a stale lock that cannot be removed must not become a busy loop.
    if (Date.now() >= deadline) return { failure: `timed out after ${timeoutMs}ms` };
    await sleep(RETRY_MS);
  }
}

async function release(lockFile: string, token: string): Promise<void> {
  try {
    if ((await readFile(lockFile, "utf8")) !== token) return; // not ours any more
    await unlink(lockFile);
  } catch {
    // already gone
  }
}

/** Run `fn` holding the lock for `file`. The result and any throw pass through. */
export async function withFileLock<T>(
  file: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lockFile = `${file}.lock`;
  const prior = inProcessTail.get(lockFile) ?? Promise.resolve();
  const run = prior.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const got = await acquire(
      lockFile,
      options.timeoutMs ?? ACQUIRE_TIMEOUT_MS,
      options.staleMs ?? STALE_LOCK_MS,
    );
    if ("failure" in got) {
      process.stderr.write(
        `golem: state lock ${lockFile} not acquired (${got.failure}); continuing unlocked\n`,
      );
    }
    try {
      return await fn();
    } finally {
      if ("token" in got) await release(lockFile, got.token);
    }
  });
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  inProcessTail.set(lockFile, tail);
  void tail.then(() => {
    if (inProcessTail.get(lockFile) === tail) inProcessTail.delete(lockFile);
  });
  return run;
}
