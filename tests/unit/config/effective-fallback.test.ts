/**
 * Nothing on the team path may stop a proxy, a hook or the MCP server: if
 * applying the team layer throws ANYTHING, `loadEffectiveConfig` returns the
 * local result with a warning (ADR-0008, DUSTSEC.14).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/loader.js")>();
  return {
    ...actual,
    loadConfig: vi.fn((options: Parameters<typeof actual.loadConfig>[0]) => {
      if (options?.teamLayer !== undefined) throw new TypeError("boom from a hostile team payload");
      return actual.loadConfig(options);
    }),
  };
});

const { loadEffectiveConfig } = await import("../../../src/config/effective.js");
const { writeTeamLayerCache } = await import("../../../src/portal/index.js");
const { useTempDirs } = await import("../../helpers/tmp.js");

const newTempDir = useTempDirs("golem-effective-fallback-");

describe("loadEffectiveConfig fallback", () => {
  it("falls back to the first result with a warning when the second load throws", async () => {
    const userDir = path.join(await newTempDir(), ".golem");
    const projectDir = await newTempDir();
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".golem", "settings.json"),
      JSON.stringify({ team: { org_id: "acme-co" } }),
    );
    await writeTeamLayerCache(userDir, {
      org_id: "acme-co",
      fetched_at: new Date().toISOString(),
      settings: [{ key: "telemetry.enabled", value: false, enforced: true }],
    });

    const config = await loadEffectiveConfig({ projectDir, userDir, env: {} });

    expect(config.settings.telemetry.enabled).toBe(true);
    expect(config.team.teamLayer).toBeUndefined();
    expect(
      config.warnings.some((w) => w.includes("team layer SKIPPED") && w.includes("boom")),
    ).toBe(true);
  });
});
