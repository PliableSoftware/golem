/**
 * A sharing violation on the team cache is NOT "no policy": reading it as absent
 * would silently drop every tightening the team set. Only ENOENT is absence.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const busy = { remaining: 0, code: "EBUSY" };

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      if (
        busy.remaining > 0 &&
        String(args[0]).endsWith(".json") &&
        String(args[0]).includes("teams")
      ) {
        busy.remaining -= 1;
        throw Object.assign(new Error(`${busy.code}: resource busy or locked`), {
          code: busy.code,
        });
      }
      return actual.readFile(...args);
    }),
  };
});

const { readTeamLayerCache, writeTeamLayerCache } = await import("../../../src/portal/index.js");
const { loadEffectiveConfig } = await import("../../../src/config/index.js");
const { useTempDirs } = await import("../../helpers/tmp.js");

const newTempDir = useTempDirs("golem-team-cache-read-");
const ORG = "acme-co";
const cache = {
  org_id: ORG,
  fetched_at: new Date().toISOString(),
  settings: [{ key: "ui.pet", value: false, enforced: true }],
};

describe("readTeamLayerCache", () => {
  it("returns null for a missing file (ENOENT) and only then", async () => {
    const userDir = await newTempDir();
    expect(await readTeamLayerCache(userDir, ORG)).toBeNull();
  });

  it("retries a transient sharing violation on win32 and then reads the policy", async () => {
    const userDir = await newTempDir();
    await writeTeamLayerCache(userDir, cache);
    busy.remaining = 3;
    const got = await readTeamLayerCache(userDir, ORG, { platform: "win32", delayMs: 1 });
    expect(got?.settings).toHaveLength(1);
    expect(busy.remaining).toBe(0);
  });

  it.each(["EBUSY", "EACCES", "EPERM"])("throws, never null, when %s persists", async (code) => {
    const userDir = await newTempDir();
    await writeTeamLayerCache(userDir, cache);
    busy.code = code;
    busy.remaining = 1000;
    await expect(
      readTeamLayerCache(userDir, ORG, { platform: "win32", tries: 3, delayMs: 1 }),
    ).rejects.toMatchObject({ code });
    busy.remaining = 0;
    busy.code = "EBUSY";
  });

  it("does not retry a permission error off win32 (it is a real error there) but still throws", async () => {
    const userDir = await newTempDir();
    await writeTeamLayerCache(userDir, cache);
    busy.code = "EACCES";
    busy.remaining = 1000;
    await expect(
      readTeamLayerCache(userDir, ORG, { platform: "linux", delayMs: 1 }),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(busy.remaining).toBe(999);
    busy.remaining = 0;
    busy.code = "EBUSY";
  });
});

describe("an unreadable cache is loud, not 'no policy'", () => {
  it("loadEffectiveConfig reports TEAM POLICY NOT APPLIED with a teamFailure", async () => {
    const userDir = path.join(await newTempDir(), ".golem");
    const projectDir = await newTempDir();
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".golem", "settings.json"),
      JSON.stringify({ team: { org_id: ORG } }),
    );
    await writeTeamLayerCache(userDir, cache);
    busy.code = "EACCES";
    busy.remaining = 1000;
    try {
      const config = await loadEffectiveConfig({ projectDir, userDir, env: {} });
      expect(config.teamFailure).toMatch(/TEAM POLICY NOT APPLIED/);
      expect(config.warnings.some((w) => w.includes("TEAM POLICY NOT APPLIED"))).toBe(true);
      // It did not pretend there was simply no cache.
      expect(config.warnings.some((w) => /no cached team settings/.test(w))).toBe(false);
    } finally {
      busy.remaining = 0;
      busy.code = "EBUSY";
    }
  });
});
