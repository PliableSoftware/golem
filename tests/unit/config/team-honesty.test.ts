/**
 * Fourth-review fixes: `team.applied` and the warnings must tell the truth.
 *
 *  1. A skipped layer (an invalid value) means team policy is NOT in force, and
 *     every surface says so; `applied` is empty.
 *  2. The skip warning never echoes the team's value.
 *  3. A member with no cap (0) accepts a positive team cap as a tightening.
 *  4. A team row the member's own setting beats is "overridden", not applied.
 *  5. repo_map / syntax_aware_chunking are false-only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMcpServeSettings } from "../../../src/cli/commands/mcp-serve.js";
import { getConfig, listConfig } from "../../../src/cli/config.js";
import { collectStatus } from "../../../src/cli/status-collect.js";
import { collectControlSurface } from "../../../src/config/control-surface.js";
import { loadEffectiveConfig } from "../../../src/config/index.js";
import { teamRule } from "../../../src/config/team-policy.js";
import { writeTeamLayerCache } from "../../../src/portal/index.js";
import { VERSION } from "../../../src/version.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-honesty-");
const ORG = "acme-co";
type Row = { key: string; value: unknown; enforced: boolean };

async function project(rows: Row[], userSettings?: object, projectSettings?: object) {
  const userDir = path.join(await newTempDir(), ".golem");
  const projectDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await mkdir(userDir, { recursive: true });
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify({ team: { org_id: ORG }, ...projectSettings }),
  );
  if (userSettings !== undefined) {
    await writeFile(path.join(userDir, "settings.json"), JSON.stringify(userSettings));
  }
  await writeTeamLayerCache(userDir, {
    org_id: ORG,
    fetched_at: new Date().toISOString(),
    settings: rows,
  });
  return { userDir, projectDir };
}
const load = (p: { userDir: string; projectDir: string }) =>
  loadEffectiveConfig({ projectDir: p.projectDir, userDir: p.userDir, env: {} });

describe("a skipped team layer is reported as NOT in force", () => {
  const rows: Row[] = [
    { key: "compression.level", value: "bogus", enforced: true },
    { key: "ui.pet", value: false, enforced: true },
    { key: "telemetry.enabled", value: false, enforced: false },
  ];
  const NOT_IN_FORCE = /team policy is NOT in force/;

  it("reports applied EMPTY and flags the skip", async () => {
    const c = await load(await project(rows));
    expect(c.teamSkipped).toBe(true);
    expect(c.team.applied).toEqual([]);
    expect(c.settings.ui.pet).toBe(true);
    expect(c.warnings.some((w) => NOT_IN_FORCE.test(w))).toBe(true);
  });

  it("is surfaced by config, status, the TUI/control surface and the MCP server", async () => {
    const p = await project(rows);
    const opts = { projectDir: p.projectDir, userDir: p.userDir, env: {} };
    expect((await getConfig("ui.pet", opts)).warnings?.some((w) => NOT_IN_FORCE.test(w))).toBe(
      true,
    );
    expect((await listConfig(opts)).warnings?.some((w) => NOT_IN_FORCE.test(w))).toBe(true);
    const status = await collectStatus({ ...opts, version: VERSION, probeTimeoutMs: 1 });
    expect(status.warnings.some((w) => NOT_IN_FORCE.test(w))).toBe(true);
    const surface = await collectControlSurface({ ...opts, version: VERSION });
    expect(surface.warnings.some((w) => NOT_IN_FORCE.test(w))).toBe(true);
    const seen: string[] = [];
    await readMcpServeSettings(p.projectDir, p.userDir, (w) => seen.push(w));
    expect(seen.some((w) => NOT_IN_FORCE.test(w))).toBe(true);
  });

  it("does not claim a clean layer as skipped", async () => {
    const c = await load(await project([{ key: "ui.pet", value: false, enforced: true }]));
    expect(c.teamSkipped).toBe(false);
    expect(c.team.applied).toEqual(["ui.pet (enforced)"]);
  });
});

describe("the skip warning never echoes the team's value", () => {
  // Assembled at runtime: no literal credential in the repo.
  const PASSWORD = ["hunt", "er2"].join("");
  const URL_WITH_PASSWORD = `https://admin:${PASSWORD}@evil.example/x`;
  const API_KEY = ["sk", "ant", "api03", "secretsecretsecret"].join("-");
  const leaks = (v: unknown): boolean => {
    const text = JSON.stringify(v);
    return text.includes(PASSWORD) || text.includes(API_KEY) || text.includes("evil.example");
  };

  it.each([
    ["ui.color", URL_WITH_PASSWORD],
    ["compression.level", API_KEY],
    ["ui.color", API_KEY],
  ])("%s with a secret-shaped value skips the layer and prints no value", async (key, value) => {
    const p = await project([{ key, value, enforced: true }]);
    const c = await load(p);
    const skip = c.warnings.filter((w) => w.includes("team layer SKIPPED"));
    expect(skip).toHaveLength(1);
    expect(skip[0]).toContain(`"${key}"`);
    expect(skip[0]).toMatch(/invalid value/);
    // (`team.teamLayer` is the in-memory payload and is never printed; the reported fields are.)
    expect(leaks([c.warnings, c.team.applied, c.team.skipped, c.team.notice, c.refused])).toBe(
      false,
    );

    const status = await collectStatus({
      projectDir: p.projectDir,
      userDir: p.userDir,
      env: {},
      version: VERSION,
      probeTimeoutMs: 1,
    });
    expect(leaks(status)).toBe(false);
    const seen: string[] = [];
    await readMcpServeSettings(p.projectDir, p.userDir, (w) => seen.push(w));
    expect(leaks(seen)).toBe(false);
  });

  it("does not echo !important entries beyond the key", async () => {
    // Importance only travels as dotted keys of settings the layer sets.
    const p = await project([{ key: "ui.color", value: URL_WITH_PASSWORD, enforced: true }]);
    const c = await load(p);
    expect(leaks(c.warnings)).toBe(false);
  });

  it("a member's OWN invalid value still shows the detail (it is their own file)", async () => {
    const p = await project([], { ui: { color: "purple" } });
    await expect(load(p)).rejects.toThrow(/purple|invalid/i);
  });
});

describe("knowledge.auto_index_max_files with no member cap", () => {
  const key = "knowledge.auto_index_max_files";
  it("accepts a positive team cap when the member's own value is 0 (a tightening)", async () => {
    const c = await load(
      await project([{ key, value: 25, enforced: true }], {
        knowledge: { auto_index_max_files: 0 },
      }),
    );
    expect(c.settings.knowledge.auto_index_max_files).toBe(25);
    expect(c.provenance[key]?.layer).toBe("team");
    expect(c.warnings.some((w) => w.includes("REFUSED"))).toBe(false);
    expect(c.team.applied.some((a) => a.startsWith(key))).toBe(true);
  });

  it("still refuses 0 against a real cap, and a higher number", async () => {
    for (const value of [0, 51]) {
      const c = await load(await project([{ key, value, enforced: true }]));
      expect(c.settings.knowledge.auto_index_max_files).toBe(50);
      expect(c.warnings.some((w) => w.includes("REFUSED") && w.includes(key))).toBe(true);
    }
  });
});

describe("a team row the member's own setting beats is overridden, not applied", () => {
  it("user! over team!", async () => {
    const p = await project([{ key: "ui.pet", value: false, enforced: true }], {
      ui: { pet: true },
      "!important": ["ui.pet"],
    });
    const c = await load(p);
    expect(c.settings.ui.pet).toBe(true);
    expect(c.team.applied).toEqual([]);
    expect(c.team.skipped.find((s) => s.key === "ui.pet")?.reason).toMatch(
      /OVERRIDDEN by your user/,
    );
  });

  it("a project value over a normal team row", async () => {
    const p = await project([{ key: "ui.pet", value: false, enforced: false }], undefined, {
      ui: { pet: true },
    });
    const c = await load(p);
    expect(c.settings.ui.pet).toBe(true);
    expect(c.team.applied).toEqual([]);
    expect(c.team.skipped.find((s) => s.key === "ui.pet")?.reason).toMatch(
      /OVERRIDDEN by your project/,
    );
  });

  it("an un-beaten row stays applied", async () => {
    const c = await load(await project([{ key: "ui.pet", value: false, enforced: true }]));
    expect(c.team.applied).toEqual(["ui.pet (enforced)"]);
  });
});

describe("indexing and chunking switches are false-only", () => {
  it.each(["knowledge.repo_map_enabled", "knowledge.syntax_aware_chunking"])("%s", async (key) => {
    expect(teamRule(key)).toBe("false-only");
    const on = await load(await project([{ key, value: true, enforced: true }]));
    expect(on.warnings.some((w) => w.includes("REFUSED") && w.includes(key))).toBe(true);
    const off = await load(await project([{ key, value: false, enforced: true }]));
    expect(off.provenance[key]?.layer).toBe("team");
  });
});
