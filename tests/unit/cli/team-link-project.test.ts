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
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  type BindOutcome,
  bindExitCode,
  bindProjectTeam,
  describePortalProjectOutcome,
  linkFlagError,
  linkJsonPayload,
  type PortalProjectOutcome,
  promptForOrg,
  promptForPortalProject,
} from "../../../src/cli/commands/team.js";
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
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: true,
        portalUrl: API,
        listProjects: portal(status(404)).listProjects,
        pickProject: pick(null).fn,
      }),
    );
    expect(await team(dir)).toMatchObject({ project: "web-app" });
    expect(out.portalProject).toMatchObject({ kind: "projects_unavailable", keptSlug: "web-app" });
    const text = describePortalProjectOutcome(out.portalProject);
    expect(text).toContain("web-app");
    expect(text).not.toMatch(/default (portal project )?applies/);
  });

  it("an unknown --project on the same team reports the kept slug, not the default", async () => {
    const dir = await newTempDir();
    await seed(dir, { team: { org_id: "org_a", project: "web-app" } });
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: false,
        portalUrl: API,
        project: "nope",
        listProjects: portal(ok).listProjects,
      }),
    );
    expect(out.portalProject).toMatchObject({ kind: "unknown_project", keptSlug: "web-app" });
    expect(describePortalProjectOutcome(out.portalProject)).toContain("web-app");
  });

  it("a portal that never answers ends as projects_unavailable and the team still links", async () => {
    const dir = await newTempDir();
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const client = createPortalClient({
      apiBaseUrl: API,
      clientId: "c",
      metadata: async () => META,
      tokens: {
        read: async () => TOKENS,
        write: async () => ({ backend: "keychain", label: "t", protection: "os-keychain" }),
        clear: async () => [],
      },
      fetchImpl: hang,
      now: () => 1,
    });
    const out = bound(
      await bindProjectTeam({
        dir,
        identity: identity(["org_a"]),
        interactive: true,
        portalUrl: API,
        listProjects: (id) => client.projects(id, 30),
        pickProject: pick("web-app").fn,
      }),
    );
    expect(await team(dir)).toMatchObject({ org_id: "org_a" });
    expect(out.portalProject).toMatchObject({ kind: "projects_unavailable" });
    expect(describePortalProjectOutcome(out.portalProject)).toMatch(/timed out/);
  });
});

/**
 * Scripted prompt streams. Each answer is fed only once the prompt asks (a line
 * that arrives while no question is pending is dropped by readline), and the
 * input ends after the last one, like a person pressing Ctrl-D.
 */
function io(input: string | null) {
  const inStream = new PassThrough();
  const outStream = new PassThrough();
  if (input === null) {
    inStream.end();
    return { input: inStream, output: outStream };
  }
  const answers = input.split("\n").slice(0, -1);
  outStream.on("data", (chunk) => {
    if (!String(chunk).includes("Choose")) return;
    setImmediate(() => {
      const next = answers.shift();
      if (next === undefined) inStream.end();
      else inStream.write(`${next}\n`);
    });
  });
  return { input: inStream, output: outStream };
}

const ENTRIES: PortalProjectEntry[] = PROJECTS;

describe("promptForPortalProject", () => {
  it("resolves null on EOF with no answer (Ctrl-D) instead of hanging", async () => {
    expect(await promptForPortalProject(ENTRIES, "default", io(null))).toBeNull();
  });

  it("Enter takes the default pick", async () => {
    expect((await promptForPortalProject(ENTRIES, "mobile", io("\n")))?.slug).toBe("mobile");
  });

  it("a number picks that entry", async () => {
    expect((await promptForPortalProject(ENTRIES, "default", io("2\n")))?.slug).toBe("web-app");
  });

  it("skip is a skip", async () => {
    expect(await promptForPortalProject(ENTRIES, "default", io("skip\n"))).toBeNull();
  });

  it("re-asks on an invalid answer, stating the range, then accepts a valid one", async () => {
    const streams = io("abc\n9\n3\n");
    let shown = "";
    streams.output.on("data", (c) => {
      shown += String(c);
    });
    expect((await promptForPortalProject(ENTRIES, "default", streams))?.slug).toBe("mobile");
    expect(shown).toContain("1-3");
  });

  it("gives up after three invalid answers", async () => {
    expect(await promptForPortalProject(ENTRIES, "default", io("x\ny\n9\n2\n"))).toBeNull();
  });
});

describe("promptForOrg", () => {
  it("resolves null on EOF instead of hanging", async () => {
    const orgs = [
      { id: "org_a", name: "A" },
      { id: "org_b", name: "B" },
    ] as PortalIdentity["organizations"];
    expect(await promptForOrg(orgs, io(null))).toBeNull();
  });
});

describe("link flags and reporting", () => {
  it("--project with --no-bind is refused", () => {
    expect(linkFlagError({ project: "web-app", bind: false })).toMatch(/--no-bind/);
  });

  it("a blank --project is an error, not silently ignored", () => {
    expect(linkFlagError({ project: "   ", bind: true })).toMatch(/--project/);
    expect(linkFlagError({ project: "", bind: true })).toMatch(/--project/);
  });

  it("no --project and a real one are fine", () => {
    expect(linkFlagError({ bind: true })).toBeNull();
    expect(linkFlagError({ project: "web-app", bind: true })).toBeNull();
  });

  const boundWith = (portalProject: PortalProjectOutcome): BindOutcome => ({
    kind: "bound",
    orgId: "org_a",
    name: "A",
    settingsFile: "f",
    entitled: true,
    movedFrom: null,
    droppedPortalProject: null,
    portalProject,
  });

  it.each([
    [{ kind: "unknown_project", requested: "x", available: ["default"] }, 2],
    [{ kind: "projects_unavailable", reason: "r", requested: "x" }, 2],
    [{ kind: "projects_unavailable", reason: "r" }, 0],
    [{ kind: "chosen", slug: "a", name: "A" }, 0],
    [{ kind: "default" }, 0],
    [{ kind: "kept", slug: "a" }, 0],
    [{ kind: "skipped" }, 0],
    [{ kind: "skipped_non_interactive" }, 0],
  ] as [PortalProjectOutcome, number][])("exit code for %j is %i", (outcome, code) => {
    expect(bindExitCode(boundWith(outcome))).toBe(code);
  });

  it("an unbound outcome is exit 2 only for ambiguous and unknown", () => {
    expect(bindExitCode({ kind: "ambiguous", candidates: [] })).toBe(2);
    expect(bindExitCode({ kind: "unknown", requested: "x" })).toBe(2);
    expect(bindExitCode({ kind: "skipped" })).toBe(0);
  });

  it.each([
    [{ kind: "chosen", slug: "web-app", name: "Web app" }, /Web app.*web-app.*team\.project/],
    [{ kind: "default" }, /default/],
    [{ kind: "kept", slug: "web-app" }, /web-app/],
    [{ kind: "skipped" }, /not chosen/],
    [{ kind: "skipped_non_interactive" }, /not chosen.*--project/],
    [
      { kind: "unknown_project", requested: "x", available: ["default", "mobile"] },
      /"x".*default, mobile/,
    ],
    [
      { kind: "projects_unavailable", reason: "old", requested: "x" },
      /old.*--project x.*NOT recorded/,
    ],
    [{ kind: "projects_unavailable", reason: "old" }, /old/],
  ] as [PortalProjectOutcome, RegExp][])("text for %j", (outcome, pattern) => {
    expect(describePortalProjectOutcome(outcome)).toMatch(pattern);
  });

  it("--json carries team.portalProject.kind and the re-link fields", () => {
    const payload = linkJsonPayload({
      stored: { label: "kc" },
      token: {},
      identity: identity(["org_a"]),
      bind: {
        ...boundWith({ kind: "default" }),
        movedFrom: "org_old",
        droppedPortalProject: "web-app",
      } as BindOutcome,
    });
    const parsed = JSON.parse(JSON.stringify(payload));
    expect(parsed.linked).toBe(true);
    expect(parsed.team.kind).toBe("bound");
    expect(parsed.team.portalProject).toEqual({ kind: "default" });
    expect(parsed.team.movedFrom).toBe("org_old");
    expect(parsed.team.droppedPortalProject).toBe("web-app");
  });
});
