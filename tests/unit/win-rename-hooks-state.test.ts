import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { flakyRename, useFakePlatform } from "../helpers/flaky-rename.js";
import { useTempDirs } from "../helpers/tmp.js";

vi.mock("node:fs/promises", async (orig) =>
  (await import("../helpers/flaky-rename.js")).wrapFs(await orig()),
);

import { readDelegationLedger, writeDelegationLedger } from "../../src/hooks/delegation-ledger.js";
import { readSnoozeNudgeState, writeSnoozeNudgeState } from "../../src/hooks/snooze-nudge.js";
import { readSpawnGateState, writeSpawnGateState } from "../../src/hooks/spawn-gate.js";
import { readServedModel, writeServedModel } from "../../src/proxy/served-model.js";

const tmp = useTempDirs("golem-win-rename-hooks-");
const platform = useFakePlatform();

async function leftovers(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else if (e.name.endsWith(".tmp")) out.push(e.name);
    }
  };
  await walk(dir);
  return out;
}

const writers: ReadonlyArray<readonly [string, (dir: string) => Promise<void>]> = [
  ["spawn-gate", async (d) => writeSpawnGateState(d, await readSpawnGateState(d))],
  ["delegation-ledger", async (d) => writeDelegationLedger(d, await readDelegationLedger(d))],
  ["snooze-nudge", async (d) => writeSnoozeNudgeState(d, await readSnoozeNudgeState(d))],
  [
    "served-model",
    async (d) =>
      writeServedModel(d, { model: "m", servedAtIso: "2026-10-09T00:00:00.000Z", accountId: null }),
  ],
];

describe("hook and proxy state files ride out a Windows rename sharing violation", () => {
  for (const [name, write] of writers) {
    it(`${name}: EPERM twice then success does not throw (win32)`, async () => {
      const dir = await tmp();
      platform.set("win32");
      flakyRename.failNext(2);
      await expect(write(dir)).resolves.toBeUndefined();
      expect(flakyRename.calls).toBe(3);
      expect(await leftovers(dir)).toEqual([]);
    });

    it(`${name}: EPERM still throws off win32 and cleans the temp`, async () => {
      const dir = await tmp();
      platform.set("linux");
      flakyRename.failNext(1);
      await expect(write(dir)).rejects.toMatchObject({ code: "EPERM" });
      expect(flakyRename.calls).toBe(1);
      expect(await leftovers(dir)).toEqual([]);
    });
  }

  it("served-model reads back what the retried write stored", async () => {
    const dir = await tmp();
    platform.set("win32");
    flakyRename.failNext(2, "EBUSY");
    await writeServedModel(dir, {
      model: "kimi",
      servedAtIso: "2026-10-09T00:00:00.000Z",
      accountId: null,
    });
    expect((await readServedModel(dir))?.model).toBe("kimi");
  });
});
