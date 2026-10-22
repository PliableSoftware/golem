/**
 * `bindTeam` and the portal project: the slug lives in the same committed file
 * as `team.org_id`, is validated before it is written, and never survives a move
 * to another team.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bindTeam, readProjectTeamKeys } from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-binding-portal-project");

async function seed(projectDir: string, value: unknown): Promise<void> {
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await writeFile(path.join(projectDir, ".golem", "settings.json"), JSON.stringify(value));
}

async function read(projectDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(projectDir, ".golem", "settings.json"), "utf8"));
}

describe("bindTeam with a portal project", () => {
  it("writes team.project next to team.org_id in the project file", async () => {
    const projectDir = await newTempDir();
    const result = await bindTeam({ projectDir, orgId: "org_a", portalProject: "web-app" });
    expect(await read(projectDir)).toEqual({ team: { org_id: "org_a", project: "web-app" } });
    expect(result.portalProject).toBe("set");
  });

  it("null removes team.project rather than writing the string default", async () => {
    const projectDir = await newTempDir();
    await seed(projectDir, { team: { org_id: "org_a", project: "web-app" } });
    const result = await bindTeam({ projectDir, orgId: "org_a", portalProject: null });
    expect(await read(projectDir)).toEqual({ team: { org_id: "org_a" } });
    expect(result.portalProject).toBe("cleared");
  });

  it("never writes a slug that fails the portal project slug rule", async () => {
    const projectDir = await newTempDir();
    for (const bad of ["Web App", "../x", "-lead", "a.b", ""]) {
      await expect(
        bindTeam({ projectDir, orgId: "org_a", portalProject: bad }),
        bad,
      ).rejects.toThrow(/portal project/);
    }
    // Refused before anything was written.
    await expect(readFile(path.join(projectDir, ".golem", "settings.json"))).rejects.toThrow();
  });

  it("keeps an existing team.project when re-linking the SAME team and none was chosen", async () => {
    const projectDir = await newTempDir();
    await seed(projectDir, { team: { org_id: "org_a", project: "web-app" } });
    const result = await bindTeam({ projectDir, orgId: "org_a" });
    expect(await read(projectDir)).toEqual({ team: { org_id: "org_a", project: "web-app" } });
    expect(result.portalProject).toBe("kept");
    expect(result.previousOrgId).toBe("org_a");
  });

  it("replaces org_id and drops the old team's team.project when moving teams", async () => {
    const projectDir = await newTempDir();
    await seed(projectDir, { team: { org_id: "org_a", project: "web-app" } });
    const result = await bindTeam({ projectDir, orgId: "org_b" });
    expect(await read(projectDir)).toEqual({ team: { org_id: "org_b" } });
    expect(result.portalProject).toBe("dropped");
    expect(result.previousOrgId).toBe("org_a");
    expect(result.previousPortalProject).toBe("web-app");
  });

  it("a slug chosen in this run survives a move to another team", async () => {
    const projectDir = await newTempDir();
    await seed(projectDir, { team: { org_id: "org_a", project: "web-app" } });
    await bindTeam({ projectDir, orgId: "org_b", portalProject: "mobile" });
    expect(await read(projectDir)).toEqual({ team: { org_id: "org_b", project: "mobile" } });
  });

  it("reports nothing to drop when there was no team.project", async () => {
    const projectDir = await newTempDir();
    const result = await bindTeam({ projectDir, orgId: "org_a" });
    expect(result.portalProject).toBe("unchanged");
    expect(result.previousOrgId).toBeNull();
  });
});

describe("readProjectTeamKeys", () => {
  it("reads the two keys from the project file only", async () => {
    const projectDir = await newTempDir();
    await seed(projectDir, { team: { org_id: " org_a ", project: "web-app" } });
    expect(await readProjectTeamKeys(projectDir)).toEqual({ orgId: "org_a", project: "web-app" });
  });

  it("is null/null for a missing or malformed file", async () => {
    const projectDir = await newTempDir();
    expect(await readProjectTeamKeys(projectDir)).toEqual({ orgId: null, project: null });
  });
});
