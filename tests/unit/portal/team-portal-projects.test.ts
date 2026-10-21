/**
 * `team-portal-projects` — a repo names a portal project and Golem fetches that
 * portal project's settings. One named test per row of the task's failure table.
 *
 * A portal project is NOT the `project` settings origin (a repo's own
 * `.golem/settings.json`): the two never share a word in code or user text.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/config/schema.js";
import {
  fetchTeamSettings,
  type PortalClient,
  readTeamBinding,
  readTeamLayerCache,
  resetPortalProjectWarnings,
  resolveTeamLayerForProject,
  syncTeamLayer,
  type TeamBinding,
  type TeamSettings,
  teamCachePath,
  teamSettingsPath,
  writeTeamLayerCache,
} from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-portal-projects-");
const ORG = "org_3IojJexample";
const UNLINKED: TeamSettings = { org_id: "", portal_url: "", sync: true, skills: true };

const linked = (overrides: Partial<TeamSettings> = {}): TeamSettings => ({
  ...UNLINKED,
  org_id: ORG,
  ...overrides,
});
const binding = (overrides: Partial<TeamBinding> = {}): TeamBinding => ({
  orgId: ORG,
  portalUrl: "",
  sync: true,
  skills: true,
  ...overrides,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fakeClient(handler: (p: string) => Response | Promise<Response>) {
  const request = vi.fn(async (p: string) => await handler(p));
  const client: PortalClient = {
    request: request as unknown as PortalClient["request"],
    me: async () => {
      throw new Error("not part of this path");
    },
    stats: { requests: 0, refreshAttempts: 0, reauthorizations: 0 },
  };
  return { client, request };
}

const rows = (value: boolean) => ({ settings: [{ key: "ui.pet", value, enforced: false }] });

beforeEach(() => resetPortalProjectWarnings());

describe("portal project failure table: key not set", () => {
  it("requests the existing settings endpoint, byte-identical, and resolves to the default project", async () => {
    const { client, request } = fakeClient(() => json(rows(true)));
    const result = await syncTeamLayer({ binding: binding(), userDir: await newTempDir(), client });
    const requested = request.mock.calls[0]?.[0] as string;
    expect(requested).toBe(teamSettingsPath(ORG));
    expect(requested).not.toContain("/projects/");
    expect(result.project).toEqual({ kind: "default" });
    expect(result.projectWarning).toBeUndefined();
  });
});

describe("portal project failure table: project found", () => {
  it("requests the portal project's settings path and uses what it returns", async () => {
    const { client, request } = fakeClient(() => json(rows(false)));
    const userDir = await newTempDir();
    const result = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(request.mock.calls[0]?.[0]).toContain(`/api/v1/orgs/${ORG}/projects/payments/settings?`);
    expect(result.project).toEqual({ kind: "found", slug: "payments" });
    expect(result.teamLayer?.settings).toMatchObject({ ui: { pet: false } });
    expect(result.projectWarning).toBeUndefined();
  });

  it("encodes the slug into the path rather than trusting it", () => {
    expect(teamSettingsPath(ORG, "v1", "a b")).toContain("/projects/a%20b/settings");
  });
});

describe.each([
  "not_found",
  "archived",
] as const)("portal project failure table: project: %s", (marker) => {
  it("uses the data returned (the default project's) and warns once, naming the slug", async () => {
    const { client } = fakeClient(() => json({ ...rows(true), project: marker }));
    const userDir = await newTempDir();
    const first = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(first.project).toEqual({ kind: "fallback", slug: "payments", reason: marker });
    expect(first.teamLayer?.settings).toMatchObject({ ui: { pet: true } });
    expect(first.projectWarning).toContain("payments");
    expect(first.projectWarning).toContain("portal project");
    expect(first.projectWarning).toContain(marker === "archived" ? "archived" : "not found");

    // Once per slug per session: the second sync still resolves as a fallback
    // (status needs the reason) but does not warn again.
    const second = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(second.project).toEqual({ kind: "fallback", slug: "payments", reason: marker });
    expect(second.projectWarning).toBeUndefined();
  });

  it("warns separately for a different slug", async () => {
    const { client } = fakeClient(() => json({ ...rows(true), project: marker }));
    const userDir = await newTempDir();
    await syncTeamLayer({ binding: binding({ project: "one" }), userDir, client });
    const other = await syncTeamLayer({ binding: binding({ project: "two" }), userDir, client });
    expect(other.projectWarning).toContain("two");
  });

  it("is remembered in the cache so the offline read path can say why", async () => {
    const { client } = fakeClient(() => json({ ...rows(true), project: marker }));
    const userDir = await newTempDir();
    await syncTeamLayer({ binding: binding({ project: "payments" }), userDir, client });
    const cache = await readTeamLayerCache(userDir, ORG, { project: "payments" });
    expect(cache?.project).toBe("payments");
    expect(cache?.project_state).toBe(marker);
  });
});

describe("portal project failure table: caller not in the team / no seat / lapsed", () => {
  it.each([
    402, 403,
  ])("%i keeps the existing refusal: no layer, no cache served, no project fallback", async (status) => {
    const userDir = await newTempDir();
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "payments",
      fetched_at: new Date().toISOString(),
      settings: [{ key: "ui.pet", value: true, enforced: false }],
    });
    const { client, request } = fakeClient(() => json({ code: "subscription_required" }, status));
    const result = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(result.disposition.kind).toBe("not_entitled");
    expect(result.teamLayer).toBeUndefined();
    expect(result.projectWarning).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    // The refusal is stamped on THIS portal project's cache.
    expect((await readTeamLayerCache(userDir, ORG, { project: "payments" }))?.denied).toBeDefined();
  });
});

describe("portal project failure table: portal unreachable or 5xx", () => {
  it.each([
    ["offline", () => Promise.reject(new TypeError("fetch failed"))],
    ["5xx", () => json({}, 503)],
  ])("%s serves THIS portal project's last known good", async (_label, handler) => {
    const userDir = await newTempDir();
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "payments",
      fetched_at: new Date().toISOString(),
      settings: [{ key: "ui.pet", value: false, enforced: false }],
    });
    const { client } = fakeClient(handler as () => Promise<Response>);
    const result = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(result.fromCache).toBe(true);
    expect(result.teamLayer?.settings).toMatchObject({ ui: { pet: false } });
  });

  it("NEVER serves a different portal project's cache, nor the default project's", async () => {
    const userDir = await newTempDir();
    const stamp = new Date().toISOString();
    const row = [{ key: "ui.pet", value: true, enforced: false }];
    await writeTeamLayerCache(userDir, { org_id: ORG, fetched_at: stamp, settings: row });
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "other",
      fetched_at: stamp,
      settings: row,
    });
    const { client } = fakeClient(() => json({}, 503));
    const sync = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(sync.teamLayer).toBeUndefined();
    expect(sync.fromCache).toBe(false);

    const read = await resolveTeamLayerForProject({
      team: linked({ project: "payments" }),
      userDir,
    });
    expect(read.teamLayer).toBeUndefined();
  });

  it("keys caches per portal project on disk, leaving the default project's path unchanged", async () => {
    const userDir = await newTempDir();
    expect(teamCachePath(userDir, ORG)).toBe(path.join(userDir, "teams", `${ORG}.json`));
    const a = teamCachePath(userDir, ORG, "alpha");
    const b = teamCachePath(userDir, ORG, "beta");
    expect(new Set([a, b, teamCachePath(userDir, ORG)]).size).toBe(3);
    expect(path.dirname(a)).toBe(path.join(userDir, "teams"));
    await mkdir(path.dirname(a), { recursive: true });
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "alpha",
      fetched_at: "x",
      settings: [],
    });
    expect(await readdir(path.dirname(a))).toEqual([path.basename(a)]);
  });

  it("the offline read path resolves each repo against its own portal project's cache", async () => {
    const userDir = await newTempDir();
    const stamp = new Date().toISOString();
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "payments",
      fetched_at: stamp,
      settings: [{ key: "ui.pet", value: false, enforced: false }],
    });
    const hit = await resolveTeamLayerForProject({
      team: linked({ project: "payments" }),
      userDir,
    });
    expect(hit.teamLayer?.settings).toMatchObject({ ui: { pet: false } });
    const miss = await resolveTeamLayerForProject({ team: linked(), userDir });
    expect(miss.teamLayer).toBeUndefined();
  });
});

describe("portal project failure table: other 4xx", () => {
  it.each([400, 404, 409, 422, 429])("%i is sent once and never retried", async (status) => {
    const { client, request } = fakeClient(() => json({ code: "whatever" }, status));
    const result = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir: await newTempDir(),
      client,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.teamLayer).toBeUndefined();
    expect(result.notice).toBeTruthy();
  });

  it("does not fall back to another portal project's data on a bare 404", async () => {
    const userDir = await newTempDir();
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      fetched_at: new Date().toISOString(),
      settings: [{ key: "ui.pet", value: true, enforced: false }],
    });
    const { client } = fakeClient(() => json({ error: "no route" }, 404));
    const result = await syncTeamLayer({
      binding: binding({ project: "payments" }),
      userDir,
      client,
    });
    expect(result.fromCache).toBe(false);
    expect(result.teamLayer).toBeUndefined();
  });
});

describe("portal project failure table: team.project set but no team.org_id", () => {
  it("performs zero portal I/O and reads no cache", async () => {
    expect(readTeamBinding(linked({ org_id: "", project: "payments" })).kind).toBe("unlinked");
    const userDir = await newTempDir();
    const result = await resolveTeamLayerForProject({
      team: linked({ org_id: "", project: "payments" }),
      userDir,
    });
    expect(result.teamLayer).toBeUndefined();
    expect(result.notice).toBeUndefined();
    // Nothing was created under the user dir either.
    expect(await readdir(userDir)).toEqual([]);
  });

  it("fetchTeamSettings is never reached: the binding has no org to build a path from", () => {
    const state = readTeamBinding(linked({ org_id: "  ", project: "payments" }));
    expect(state.kind).toBe("unlinked");
  });
});

describe("the team.project setting", () => {
  it("defaults to empty in the published settings and is a string leaf", () => {
    expect((DEFAULT_SETTINGS.team as { project?: string }).project).toBe("");
  });

  it("rejects a slug that is not safe to put in a URL path or a file name", () => {
    for (const bad of ["../x", "a/b", "a.b", "a b", "-lead", "x".repeat(65), "Payments", "a_b"]) {
      const state = readTeamBinding(linked({ project: bad }));
      expect(state.kind).toBe("linked");
      if (state.kind === "linked") {
        expect(state.binding.project ?? "").toBe("");
        expect(state.binding.projectRejected).toContain("portal project");
      }
    }
  });

  it("trims and accepts a normal slug", () => {
    const state = readTeamBinding(linked({ project: " payments-2 " }));
    expect(state.kind === "linked" && state.binding.project).toBe("payments-2");
  });

  it("fetchTeamSettings reports the marker", async () => {
    const { client } = fakeClient(() => json({ ...rows(true), project: "archived" }));
    const fetched = await fetchTeamSettings(client, ORG, undefined, "p");
    expect(fetched.project).toEqual({ kind: "fallback", slug: "p", reason: "archived" });
  });
});

describe("review fixes", () => {
  it("a 402 on one repo's sync withdraws policy for every repo in that org", async () => {
    const userDir = await newTempDir();
    const stamp = new Date().toISOString();
    const row = [{ key: "ui.pet", value: true, enforced: false }];
    await writeTeamLayerCache(userDir, { org_id: ORG, fetched_at: stamp, settings: row });
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "a",
      fetched_at: stamp,
      settings: row,
    });
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      project: "z",
      fetched_at: stamp,
      settings: row,
    });
    await writeTeamLayerCache(userDir, { org_id: "org_other", fetched_at: stamp, settings: row });
    const { client } = fakeClient(() => json({ code: "subscription_required" }, 402));
    await syncTeamLayer({ binding: binding({ project: "a" }), userDir, client });

    const b = await resolveTeamLayerForProject({ team: linked(), userDir });
    expect(b.teamLayer).toBeUndefined();
    expect(b.notice).toContain("denied");
    const z = await resolveTeamLayerForProject({ team: linked({ project: "z" }), userDir });
    expect(z.teamLayer).toBeUndefined();
    // Another org is untouched.
    const other = await resolveTeamLayerForProject({
      team: linked({ org_id: "org_other" }),
      userDir,
    });
    expect(other.teamLayer).toBeDefined();
  });

  it("readTeamLayerCache rejects a cache whose project field does not match the requested slug", async () => {
    const userDir = await newTempDir();
    const file = teamCachePath(userDir, ORG, "alpha");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ org_id: ORG, project: "beta", fetched_at: "x", settings: [] }),
    );
    expect(await readTeamLayerCache(userDir, ORG, { project: "alpha" })).toBeNull();
    const defaultFile = teamCachePath(userDir, ORG);
    await writeFile(
      defaultFile,
      JSON.stringify({ org_id: ORG, project: "beta", fetched_at: "x", settings: [] }),
    );
    expect(await readTeamLayerCache(userDir, ORG)).toBeNull();
  });
});
