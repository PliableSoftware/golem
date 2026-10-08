/**
 * A small cross-process lock for the hook state files that are read, decided on
 * and written back (`spawn-gate.json`, `delegations.json`). Their writes are
 * atomic (temp + rename), but that only stops torn files: two hook processes that
 * both load before either saves still lose one update. The lock covers the whole
 * load -> decide -> save.
 *
 * `<file>.lock` is created exclusively (`wx`, `O_EXCL`/`CREATE_NEW`). A lock older
 * than {@link STALE_LOCK_MS} belongs to a crashed holder and is broken. If the lock
 * cannot be had within {@link ACQUIRE_TIMEOUT_MS} the work runs unlocked: these are
 * called from hooks on the critical path of a tool call, and wedging the session
 * over a bookkeeping file is worse than a rare lost update.
 */

import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const STALE_LOCK_MS = 10_000;
const ACQUIRE_TIMEOUT_MS = 5_000;
const RETRY_MS = 10;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** In-process queue per lock path, so same-process callers never spin on the file. */
const inProcessTail = new Map<string, Promise<unknown>>();

async function acquire(lockFile: string): Promise<boolean> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") return false;
    }
    try {
      const { mtimeMs } = await stat(lockFile);
      if (Date.now() - mtimeMs > STALE_LOCK_MS) {
        await unlink(lockFile).catch(() => undefined);
        continue;
      }
    } catch {
      continue; // released between our create and stat — try again at once
    }
    if (Date.now() >= deadline) return false;
    await sleep(RETRY_MS);
  }
}

/** Run `fn` holding the lock for `file`. The result and any throw pass through. */
export async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = `${file}.lock`;
  const prior = inProcessTail.get(lockFile) ?? Promise.resolve();
  const run = prior.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const held = await acquire(lockFile);
    try {
      return await fn();
    } finally {
      if (held) await unlink(lockFile).catch(() => undefined);
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
