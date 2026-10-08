/**
 * DUST3.4 — `golem gateway use` / `golem target use` restart must go through the
 * shared restart helper: a busy port is reported, and the RUNNING intent is
 * recorded so a later SessionStart does not resurrect an old bypass/stopped state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDirs } from "../helpers/tmp.js";

const daemon = vi.hoisted(() => ({
  portFree: true,
  started: 0,
}));

vi.mock("../../src/cli/proxy-daemon.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/proxy-daemon.js")>();
  return {
    ...actual,
    portInUse: async () => true,
    stopProxy: async () => undefined,
    waitForPortFree: async () => daemon.portFree,
    startDetached: async () => {
      daemon.started += 1;
      return 4242;
    },
  };
});

import { selectTarget } from "../../src/cli/commands/select-target.js";
import { readProxyDesired, writeProxyDesired } from "../../src/cli/proxy-state.js";

const newTempDir = useTempDirs("golem-select-target");

let dir: string;

beforeEach(async () => {
  dir = await newTempDir();
  daemon.portFree = true;
  daemon.started = 0;
  await writeProxyDesired(dir, "bypass", new Date().toISOString());
});

describe("selectTarget --restart", () => {
  it("reports a port that never frees instead of starting a second proxy", async () => {
    daemon.portFree = false;
    await expect(selectTarget(dir, null, { restart: true, yes: true })).rejects.toThrow(
      /still in use/,
    );
    expect(daemon.started).toBe(0);
  });

  it("records the running intent after a restart", async () => {
    const out = await selectTarget(dir, null, { restart: true, yes: true });
    expect(out).toContain("pid 4242");
    expect(await readProxyDesired(dir)).toBe("running");
  });
});
