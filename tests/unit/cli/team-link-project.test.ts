/**
 * `golem team link` and the portal project picker.
 *
 * The portal is a fake `fetch` serving the shape in the portal's
 * `docs/api-contract.md` (Projects), so nothing here depends on the real portal.
 * The invariant under test throughout: the project list can never stop the team
 * link, and a link that records the team but not the portal project says so.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type BindOutcome, bindProjectTeam } from "../../../src/cli/commands/team.js";
import {
  type AuthorizationServerMetadata,
  createPortalClient,
  type FetchLike,
  type PortalIdentity,
  type PortalProjectEntry,
  type PortalTokenSet,
} from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-link-project");

const ISSUER = "https://clerk.example.test";
const API = "https://portal.example.test";
const META: AuthorizationServerMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
};
const TOKENS: PortalTokenSet = {
  issuer: ISSUER,
  client_id: "c",
  api_origin: API,
  issuer_origin: ISSUER,
  access_token: "at",
  refresh_token: "rt",
  token_type: "Bearer",
  obtained_at: 1,
};

const PROJECTS = [
  { slug: "default", name: "Default", description: "", default: true },
  { slug: "web-app", name: "Web app", description: "The site", default: false },
  { slug: "mobile", name: "Mobile", description: "", default: false },
];

type Fake = (orgId: string) => Response | Promise<Response> | never;

function portal(handler: Fake) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    const m = /\/api\/v1\/orgs\/([^/]+)\/projects$/.exec(url);
    if (m?.[1] === undefined) return new Response("{}", { status: 404 });
    return handler(m[1]);
  };
  const client = createPortalClient({
    apiBaseUrl: API,
    clientId: "c",
    metadata: async () => META,
    tokens: {
      read: async () => TOKENS,
      write: async () => ({ backend: "keychain", label: "t", protection: "os-keychain" }),
      clear: async () => [],
    },
    fetchImpl,
    now: () => 1,
  });
  return { calls, listProjects: (id: string) => client.projects(id) };
}

const ok = () => new Response(JSON.stringify({ projects: PROJECTS }), { status: 200 });
const status = (n: number) => () => new Response(JSON.stringify({ error: "x" }), { status: n });

const identity = (orgIds: string[]): PortalIdentity => ({
  user: { id: "u", email: undefined },
  auth: undefined,
  organizations: orgIds.map((id) => ({ id, name: id }) as PortalIdentity["organizations"][number]),
});

async function seed(dir: string, value: unknown): Promise<void> {
  await mkdir(path.join(dir, ".golem"), { recursive: true });
  await writeFile(path.join(dir, ".golem", "settings.json"), JSON.stringify(value));
}
async function team(dir: string): Promise<Record<string, unknown>> {
  const file = JSON.parse(await readFile(path.join(dir, ".golem", "settings.json"), "utf8"));
  return file.team;
}

function pick(slug: string | null) {
  const asked: { entries: string[]; defaultSlug: string }[] = [];
  const fn = async (entries: readonly PortalProjectEntry[], defaultSlug: string) => {
    asked.push({ entries: entries.map((e) => e.slug), defaultSlug });
    return slug === null ? null : (entries.find((e) => e.slug === slug) ?? null);
  };
  return { asked, fn };
}

function bound(outcome: BindOutcome) {
  if (outcome.kind !== "bound") throw new Error(`expected bound, got ${outcome.kind}`);
  return outcome;
}

describe("interactive picker", () => {
  it("lists the team's portal projects and writes team.project for the one picked", async () => {
    const dir = await newTempDir();
    const fake = portal(ok);
    const p = pick("web-app");
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: true,
        portalUrl: API,
        listProjects: fake.listProjects,
        pickProject: p.fn,
      }),
    );
    expect(p.asked[0]?.entries).toEqual(["default", "web-app", "mobile"]);
    expect(await team(dir)).toMatchObject({ org_id: "org_a", project: "web-app" });
    expect(out.portalProject).toEqual({ kind: "chosen", slug: "web-app", name: "Web app" });
  });

  it("a default pick writes no team.project key", async () => {
    const dir = await newTempDir();
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: true,
        portalUrl: API,
        listProjects: portal(ok).listProjects,
        pickProject: pick("default").fn,
      }),
    );
    expect(await team(dir)).not.toHaveProperty("project");
    expect(out.portalProject).toEqual({ kind: "default" });
  });

  it("offers the existing slug as the default pick when re-linking the same team", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "mobile" } });
    const p = pick("mobile");
    await bindProjectTeam({
      dir,
      identity: identity(["org_a"]),
      interactive: true,
      portalUrl: API,
      listProjects: portal(ok).listProjects,
      pickProject: p.fn,
    });
    expect(p.asked[0]?.defaultSlug).toBe("mobile");
  });

  it("offers the portal's default project as the default pick for a new or moved team", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "mobile" } });
    const p = pick("default");
    await bindProjectTeam({
      dir,
      identity: identity(["org_b"]),
      interactive: true,
      portalUrl: API,
      listProjects: portal(ok).listProjects,
      pickProject: p.fn,
    });
    expect(p.asked[0]?.defaultSlug).toBe("default");
  });

  it("declining the picker records the team and says the portal project was not chosen", async () => {
    const dir = await newTempDir();
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: true,
        portalUrl: API,
        listProjects: portal(ok).listProjects,
        pickProject: pick(null).fn,
      }),
    );
    expect(await team(dir)).toMatchObject({ org_id: "org_a" });
    expect(out.portalProject.kind).toBe("skipped");
  });
});

describe("--project", () => {
  const run = (dir: string, project: string, handler: Fake = ok) =>
    bindProjectTeam({
      dir,
      identity: identity(["org_a"]),
      interactive: false,
      portalUrl: API,
      project,
      listProjects: portal(handler).listProjects,
    });

  it("a known slug skips the prompt and is written", async () => {
    const dir = await newTempDir();
    const out = bound(await run(dir, "web-app"));
    expect(await team(dir)).toMatchObject({ project: "web-app" });
    expect(out.portalProject).toMatchObject({ kind: "chosen", slug: "web-app" });
  });

  it("an unknown slug is refused with the valid ones, and the team is still linked", async () => {
    const dir = await newTempDir();
    const out = bound(await run(dir, "web-ap"));
    expect(out.portalProject).toEqual({
      kind: "unknown_project",
      requested: "web-ap",
      available: ["default", "web-app", "mobile"],
    });
    expect(await team(dir)).toMatchObject({ org_id: "org_a" });
    expect(await team(dir)).not.toHaveProperty("project");
  });

  it("default removes team.project instead of writing the string", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "mobile" } });
    const out = bound(await run(dir, "default"));
    expect(await team(dir)).not.toHaveProperty("project");
    expect(out.portalProject).toEqual({ kind: "default" });
  });

  it("a slug that fails the slug rule is never written, even if the portal listed it", async () => {
    const dir = await newTempDir();
    const out = bound(await run(dir, "../etc"));
    expect(out.portalProject.kind).toBe("unknown_project");
    expect(await team(dir)).not.toHaveProperty("project");
  });

  it("an unavailable list does not apply the slug and says so", async () => {
    const dir = await newTempDir();
    const out = bound(await run(dir, "web-app", status(404)));
    expect(out.portalProject).toMatchObject({ kind: "projects_unavailable", requested: "web-app" });
    expect(await team(dir)).toMatchObject({ org_id: "org_a" });
    expect(await team(dir)).not.toHaveProperty("project");
  });
});

describe("re-link", () => {
  it("to another team replaces org_id and never leaves the old team.project behind", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "web-app" } });
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_b"]),
        interactive: false,
        portalUrl: API,
        listProjects: portal(ok).listProjects,
      }),
    );
    expect(await team(dir)).toMatchObject({ org_id: "org_b" });
    expect(await team(dir)).not.toHaveProperty("project");
    expect(out.movedFrom).toBe("org_a");
    expect(out.droppedPortalProject).toBe("web-app");
  });

  it("to the same team keeps team.project when nothing was chosen", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "web-app" } });
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: false,
        portalUrl: API,
        listProjects: portal(ok).listProjects,
      }),
    );
    expect(await team(dir)).toMatchObject({ project: "web-app" });
    expect(out.portalProject).toEqual({ kind: "kept", slug: "web-app" });
    expect(out.movedFrom).toBeNull();
  });
});

describe("non-interactive", () => {
  it("never prompts, never calls the portal list, and reports a stable state", async () => {
    const dir = await newTempDir();
    const fake = portal(ok);
    const p = pick("web-app");
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: false,
        portalUrl: API,
        listProjects: fake.listProjects,
        pickProject: p.fn,
      }),
    );
    expect(p.asked).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(out.portalProject).toEqual({ kind: "skipped_non_interactive" });
    expect(await team(dir)).toMatchObject({ org_id: "org_a" });
  });
});

describe("a project list that cannot be had never stops the team link", () => {
  const cases: [string, Fake][] = [
    ["404", status(404)],
    ["500", status(500)],
    ["503", status(503)],
    ["402", status(402)],
    ["403", status(403)],
    [
      "network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ];
  it.each(cases)("%s", async (_name, handler) => {
    const dir = await newTempDir();
    const p = pick("web-app");
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: true,
        portalUrl: API,
        listProjects: portal(handler).listProjects,
        pickProject: p.fn,
      }),
    );
    expect(p.asked).toEqual([]);
    expect(await team(dir)).toMatchObject({ org_id: "org_a" });
    expect(await team(dir)).not.toHaveProperty("project");
    expect(out.portalProject.kind).toBe("projects_unavailable");
    if (out.portalProject.kind === "projects_unavailable") {
      expect(out.portalProject.reason.length).toBeGreaterThan(0);
    }
  });

  it("keeps the existing slug of the same team when the list is unavailable", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "web-app" } });
    await bindProjectTeam({
      dir,
      identity: identity(["org_a"]),
      interactive: true,
      portalUrl: API,
      listProjects: portal(status(404)).listProjects,
      pickProject: pick(null).fn,
    });
    expect(await team(dir)).toMatchObject({ project: "web-app" });
  });
});
