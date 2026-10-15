/**
 * R13.8 item 1 — the cross-project registry a device can trust.
 *
 * "Known" means "recorded", never "reachable now" — every read re-checks the
 * root live (item 6), so these tests cover both halves: the record surviving
 * a round trip, and reachability being named rather than assumed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkReachability,
  forgetKnownProject,
  listKnownProjects,
  recordKnownProject,
} from "../../../src/session/known-projects.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-known-projects-");

async function wireProject(dir: string): Promise<void> {
  await mkdir(path.join(dir, ".golem"), { recursive: true });
  await writeFile(path.join(dir, ".golem", "settings.json"), "{}\n", "utf8");
  await mkdir(path.join(dir, ".claude"), { recursive: true });
}

describe("recordKnownProject / listKnownProjects", () => {
  it("records a project and lists it back, newest lastSeenAt first", async () => {
    const userDir = await newTempDir();
    const projectA = await newTempDir();
    const projectB = await newTempDir();
    await wireProject(projectA);
    await wireProject(projectB);

    await recordKnownProject(projectA, { nowIso: "2026-09-01T00:00:00.000Z", userDir });
    await recordKnownProject(projectB, { nowIso: "2026-09-02T00:00:00.000Z", userDir });

    const listed = await listKnownProjects(userDir);
    expect(listed.map((p) => p.root)).toStrictEqual([
      path.resolve(projectB),
      path.resolve(projectA),
    ]);
    expect(listed[0]?.reachability).toStrictEqual({ status: "ok" });
  });

  it("touching an existing root updates lastSeenAt but keeps firstSeenAt", async () => {
    const userDir = await newTempDir();
    const project = await newTempDir();
    await wireProject(project);

    await recordKnownProject(project, { nowIso: "2026-09-01T00:00:00.000Z", userDir });
    await recordKnownProject(project, { nowIso: "2026-09-05T00:00:00.000Z", userDir });

    const [entry] = await listKnownProjects(userDir);
    expect(entry?.firstSeenAt).toBe("2026-09-01T00:00:00.000Z");
    expect(entry?.lastSeenAt).toBe("2026-09-05T00:00:00.000Z");
  });

  it("defaults the label to the root's own basename", async () => {
    const userDir = await newTempDir();
    const project = await newTempDir();
    await wireProject(project);
    await recordKnownProject(project, { nowIso: "2026-09-01T00:00:00.000Z", userDir });
    const [entry] = await listKnownProjects(userDir);
    expect(entry?.label).toBe(path.basename(project));
  });

  it("forgetKnownProject removes the record and says whether there was one", async () => {
    const userDir = await newTempDir();
    const project = await newTempDir();
    await wireProject(project);
    await recordKnownProject(project, { nowIso: "2026-09-01T00:00:00.000Z", userDir });

    expect(await forgetKnownProject(project, userDir)).toBe(true);
    expect(await forgetKnownProject(project, userDir)).toBe(false);
    expect(await listKnownProjects(userDir)).toHaveLength(0);
  });

  it("an empty registry lists as empty, not an error", async () => {
    const userDir = await newTempDir();
    expect(await listKnownProjects(userDir)).toStrictEqual([]);
  });
});

describe("checkReachability — item 6: name what is missing, never silent", () => {
  it("a root that does not exist on this machine is unreachable, and says so", () => {
    const missing = path.join(process.platform === "win32" ? "Z:\\" : "/", "no-such-golem-root");
    const result = checkReachability(missing);
    expect(result.status).toBe("unreachable");
    if (result.status === "unreachable") {
      expect(result.reason).toContain(missing);
    }
  });

  it("a root that exists but was never `golem init`-ed is not_wired", async () => {
    const dir = await newTempDir();
    const result = checkReachability(dir);
    expect(result.status).toBe("not_wired");
    if (result.status === "not_wired") {
      expect(result.reason).toContain(".golem/settings.json");
    }
  });

  it("a root with .golem/settings.json but no .claude/ is still not_wired", async () => {
    const dir = await newTempDir();
    await mkdir(path.join(dir, ".golem"), { recursive: true });
    await writeFile(path.join(dir, ".golem", "settings.json"), "{}\n", "utf8");
    const result = checkReachability(dir);
    expect(result.status).toBe("not_wired");
    if (result.status === "not_wired") {
      expect(result.reason).toContain(".claude");
    }
  });

  it("a fully wired root is ok", async () => {
    const dir = await newTempDir();
    await wireProject(dir);
    expect(checkReachability(dir)).toStrictEqual({ status: "ok" });
  });

  it("listKnownProjects flags a since-removed root rather than hiding it", async () => {
    const userDir = await newTempDir();
    const project = await newTempDir();
    await wireProject(project);
    await recordKnownProject(project, { nowIso: "2026-09-01T00:00:00.000Z", userDir });

    // Un-wire it after recording — the record is stale, and must be named as such.
    await import("node:fs/promises").then(({ rm }) =>
      rm(path.join(project, ".golem"), { recursive: true, force: true }),
    );

    const [entry] = await listKnownProjects(userDir);
    expect(entry?.reachability.status).toBe("not_wired");
  });
});
