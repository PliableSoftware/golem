/**
 * A `node:fs/promises` wrapper whose `rename` fails with a chosen errno a set
 * number of times and then succeeds, for the Windows-contention tests of the
 * modules that write through `replaceViaTemp` / `renameWithRetry`.
 *
 * Use from a test file:
 *
 *   vi.mock("node:fs/promises", async (orig) =>
 *     (await import("../helpers/flaky-rename.js")).wrapFs(await orig()));
 *
 * then `flakyRename.failNext(2)` and `setPlatform("win32")` in the test.
 */

import { afterEach, beforeEach } from "vitest";

export const flakyRename = {
  failures: 0,
  code: "EPERM",
  calls: 0,
  failNext(n: number, code = "EPERM"): void {
    this.failures = n;
    this.code = code;
    this.calls = 0;
  },
};

export function wrapFs<T extends { rename: (from: string, to: string) => Promise<void> }>(
  actual: T,
): T {
  return {
    ...actual,
    async rename(from: string, to: string): Promise<void> {
      flakyRename.calls++;
      if (flakyRename.failures > 0) {
        flakyRename.failures--;
        throw Object.assign(new Error(`${flakyRename.code}: simulated sharing violation`), {
          code: flakyRename.code,
        });
      }
      return actual.rename(from, to);
    },
  };
}

/** Pretend to be `platform` for the duration of each test in the calling file. */
export function useFakePlatform(): { set(platform: NodeJS.Platform): void } {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  beforeEach(() => {
    flakyRename.failNext(0);
  });
  afterEach(() => {
    if (real) Object.defineProperty(process, "platform", real);
  });
  return {
    set(platform) {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
    },
  };
}
