/**
 * `team-portal-projects` — skills and `golem team status`.
 *
 * A portal project's skills land exactly where team skills land today, flat as
 * `.claude/skills/golem-team-<name>/SKILL.md`. Switching a repo between portal
 * projects removes the previous one's managed skills and touches nothing
 * outside the `golem-team-` prefix.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeProjectBinding } from "../../../src/cli/commands/team.js";
import { hashManaged } from "../../../src/cli/managed-files.js";
import { syncTeamSkills, teamSkillFile } from "../../../src/cli/team-skills.js";
import {
  resetPortalProjectWarnings,
  type TeamSettings,
  writeTeamLayerCache,
} from "../../../src/portal/index.js";
import { fetchTeamSkills } from "../../../src/portal/team-skills.js";
import { useTempDirs } from "../../helpers/tmp.js";

const ORG = "org_3IojJexample";
const UNLINKED: TeamSettings = { org_id: "", portal_url: "", sync: true, skills: true };
const linked = (o: Partial<TeamSettings> = {}): TeamSettings => ({
  ...UNLINKED,
  org_id: ORG,
  ...o,
});

const newTempDir = useTempDirs("golem-portal-projects-skills-");
let dir: string;
beforeEach(async () => {
  dir = await newTempDir();
  resetPortalProjectWarnings();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A portal that serves different skills per path, and can stamp a marker. */
function portal(byProject: Record<string, Record<string, string>>, marker?: string) {
  const calls: string[] = [];
  const transport = vi.fn(async (reqPath: string) => {
    calls.push(reqPath);
    const m = /\/projects\/([^/]+)\/skills/.exec(reqPath);
    const key = m?.[1] === undefined ? "" : decodeURIComponent(m[1]);
    const skills = byProject[key] ?? byProject[""] ?? {};
    const manifest = reqPath.includes("manifest=1");
    return json({
      ...(marker === undefined ? {} : { project: marker }),
      skills: Object.entries(skills).map(([name, content]) => ({
        name,
        ...(manifest ? {} : { content }),
        content_sha256: hashManaged(content),
      })),
    });
  });
  return { transport, calls };
}

const exists = (f: string) =>
  readFile(f, "utf8").then(
    () => true,
    () => false,
  );
const run = (team: TeamSettings, transport: ReturnType<typeof portal>["transport"]) =>
  syncTeamSkills({ projectDir: dir, team, dryRun: false, transport });

describe("portal project skills: paths", () => {
  it("requests the portal project's skills path (manifest and bodies) and writes them flat", async () => {
    const p = portal({ payments: { ledger: "pay text" } });
    await run(linked({ project: "payments" }), p.transport);
    expect(p.calls.every((c) => c.includes(`/api/v1/orgs/${ORG}/projects/payments/skills`))).toBe(
      true,
    );
    expect(await readFile(teamSkillFile(dir, "ledger"), "utf8")).toBe("pay text");
    expect(teamSkillFile(dir, "ledger")).toBe(
      path.join(dir, ".claude", "skills", "golem-team-ledger", "SKILL.md"),
    );
  });

  it("key not set: the existing skills endpoint, no /projects/ segment", async () => {
    const p = portal({ "": { a: "x" } });
    await run(linked(), p.transport);
    expect(p.calls.some((c) => c.includes("/projects/"))).toBe(false);
  });

  it("fetchTeamSkills reports the marker", async () => {
    const p = portal({ "": {} }, "not_found");
    const got = await fetchTeamSkills(p.transport, ORG, { manifest: true, project: "gone" });
    expect(got.kind === "ok" && got.project).toEqual({
      kind: "fallback",
      slug: "gone",
      reason: "not_found",
    });
  });
});

describe("portal project skills: switching", () => {
  it("removes the previous portal project's managed skills, writes the new ones, touches nothing else", async () => {
    const p = portal({
      alpha: { one: "1", shared: "s-alpha" },
      beta: { two: "2", shared: "s-beta" },
    });
    await run(linked({ project: "alpha" }), p.transport);
    expect(await exists(teamSkillFile(dir, "one"))).toBe(true);

    // Things the switch must never touch.
    const own = path.join(dir, ".claude", "skills", "my-own", "SKILL.md");
    const golems = path.join(dir, ".claude", "skills", "golem-ship", "SKILL.md");
    const settings = path.join(dir, ".golem", "settings.json");
    for (const f of [own, golems, settings]) {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, `keep ${path.basename(path.dirname(f))}`, "utf8");
    }

    const result = await run(linked({ project: "beta" }), p.transport);
    expect(await exists(teamSkillFile(dir, "one"))).toBe(false);
    expect(await readFile(teamSkillFile(dir, "two"), "utf8")).toBe("2");
    expect(await readFile(teamSkillFile(dir, "shared"), "utf8")).toBe("s-beta");
    expect(result.outcome.kind === "synced" && result.outcome.removed).toEqual(["one"]);
    for (const f of [own, golems, settings]) expect(await exists(f)).toBe(true);
  });

  it("a hand-edited skill from the previous portal project is kept and reported", async () => {
    const p = portal({ alpha: { one: "1" }, beta: { two: "2" } });
    await run(linked({ project: "alpha" }), p.transport);
    await writeFile(teamSkillFile(dir, "one"), "edited by a person", "utf8");
    const result = await run(linked({ project: "beta" }), p.transport);
    expect(await readFile(teamSkillFile(dir, "one"), "utf8")).toBe("edited by a person");
    expect(result.outcome.kind === "synced" && result.outcome.conflicts).toEqual(["one"]);
  });
});

describe.each([
  "not_found",
  "archived",
] as const)("portal project skills: project: %s", (marker) => {
  it("uses the default project's skills and warns once per slug", async () => {
    const p = portal({ "": { base: "default text" } }, marker);
    const first = await run(linked({ project: "gone" }), p.transport);
    expect(await readFile(teamSkillFile(dir, "base"), "utf8")).toBe("default text");
    expect(first.notices.join("\n")).toContain("gone");
    expect(first.notices.join("\n")).toContain("portal project");
    expect(first.outcome.kind === "synced" && first.outcome.project).toEqual({
      kind: "fallback",
      slug: "gone",
      reason: marker,
    });
    const second = await run(linked({ project: "gone" }), p.transport);
    expect(second.notices.join("\n")).not.toContain("gone");
  });
});

describe("portal project skills: failure rows", () => {
  it("no team.org_id: zero portal I/O even with team.project set", async () => {
    const p = portal({ payments: { a: "x" } });
    const readLocal = vi.fn(async () => []);
    const result = await syncTeamSkills({
      projectDir: dir,
      team: linked({ org_id: "", project: "payments" }),
      dryRun: false,
      transport: p.transport,
      readLocal,
    });
    expect(result.outcome.kind).toBe("unlinked");
    expect(p.transport).not.toHaveBeenCalled();
    expect(readLocal).not.toHaveBeenCalled();
  });

  it.each([
    402, 403,
  ])("%i drops skills as today; the project name changes nothing", async (status) => {
    const p = portal({ alpha: { one: "1" } });
    await run(linked({ project: "alpha" }), p.transport);
    const denied = vi.fn(async () => json({ code: "subscription_required" }, status));
    const result = await run(linked({ project: "alpha" }), denied);
    expect(result.outcome.kind).toBe("dropped");
    expect(await exists(teamSkillFile(dir, "one"))).toBe(false);
  });

  it("5xx keeps what is on disk", async () => {
    const p = portal({ alpha: { one: "1" } });
    await run(linked({ project: "alpha" }), p.transport);
    const down = vi.fn(async () => json({}, 503));
    const result = await run(linked({ project: "alpha" }), down);
    expect(result.outcome.kind).toBe("kept_cached");
    expect(await exists(teamSkillFile(dir, "one"))).toBe(true);
  });

  it.each([
    400, 404, 422,
  ])("%i is requested once and never retried; the existing api_error handling applies", async (status) => {
    const bad = vi.fn(async () => json({ code: "x" }, status));
    const result = await run(linked({ project: "alpha" }), bad);
    // Manifest only: no second attempt, and no body fetch.
    expect(bad).toHaveBeenCalledTimes(1);
    expect(result.outcome.kind).toBe("dropped");
  });

  it("an outage after switching does not present the previous portal project's skills as the new one's", async () => {
    const p = portal({ alpha: { one: "1" } });
    await run(linked({ project: "alpha" }), p.transport);
    const down = vi.fn(async () => json({}, 503));
    const result = await run(linked({ project: "beta" }), down);
    expect(result.outcome.kind).toBe("kept_cached");
    expect(result.notices.join("\n")).toContain("portal project alpha");
    expect(result.notices.join("\n")).toContain("portal project beta");
    // Left in place, never deleted on a transient failure.
    expect(await exists(teamSkillFile(dir, "one"))).toBe(true);
  });
});

describe("golem team status: resolved portal project", () => {
  it("names the portal project the repo asked for and that none has been fetched yet", async () => {
    const view = await describeProjectBinding(linked({ project: "payments" }), dir);
    expect(view.portalProject).toBe("payments");
    expect(view.summary).toContain("portal project payments");
  });

  it("with no portal project named, says the default project applies", async () => {
    const view = await describeProjectBinding(linked(), dir);
    expect(view.portalProject).toBeNull();
    expect(view.summary).toContain("default portal project");
  });

  it("shows the fallback reason recorded by the last sync", async () => {
    await writeTeamLayerCache(dir, {
      org_id: ORG,
      project: "payments",
      project_state: "archived",
      fetched_at: new Date().toISOString(),
      settings: [],
    });
    const view = await describeProjectBinding(linked({ project: "payments" }), dir);
    expect(view.summary).toContain("archived");
    expect(view.summary).toContain("default portal project");
    expect(view.cache).toContain("payments");
  });

  it("an unlinked repo with team.project set reports it is ignored and reads no cache", async () => {
    const view = await describeProjectBinding(linked({ org_id: "", project: "payments" }), dir);
    expect(view.linked).toBe(false);
    expect(view.cache).toBeNull();
    expect(view.summary).toContain("not linked to a team");
  });
});
