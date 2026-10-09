/**
 * Review fixes for team-layer-everywhere.
 *
 *  1. A team may only TIGHTEN (USER decision P4). Interim floor: four keys are
 *     denied outright, two booleans may only be forced to false.
 *  2. A hostile row key (`proxy.constructor`, `__proto__`, ...) must be an
 *     unknown key, never a throw, and never touch Object.prototype.
 *  3. The reason a linked team's layer is NOT applied reaches every surface.
 *  4. The team cache is written atomically.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMcpServeSettings } from "../../../src/cli/commands/mcp-serve.js";
import { getConfig, listConfig } from "../../../src/cli/config.js";
import { collectStatus } from "../../../src/cli/status-collect.js";
import { collectControlSurface } from "../../../src/config/control-surface.js";
import { loadEffectiveConfig } from "../../../src/config/index.js";
import {
  readTeamLayerCache,
  translateTeamRows,
  writeTeamLayerCache,
} from "../../../src/portal/index.js";
import { VERSION } from "../../../src/version.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-hardening-");
const ORG = "acme-co";

type Row = { key: string; value: unknown; enforced: boolean };

async function project(opts: {
  rows?: Row[];
  linked?: boolean;
  userSettings?: object;
  projectTeam?: object;
}): Promise<{ userDir: string; projectDir: string }> {
  const userDir = path.join(await newTempDir(), ".golem");
  const projectDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await mkdir(userDir, { recursive: true });
  const team = opts.projectTeam ?? { org_id: ORG };
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify(opts.linked === false ? {} : { team }),
  );
  if (opts.userSettings !== undefined) {
    await writeFile(path.join(userDir, "settings.json"), JSON.stringify(opts.userSettings));
  }
  if (opts.rows !== undefined) {
    await writeTeamLayerCache(userDir, {
      org_id: ORG,
      fetched_at: new Date().toISOString(),
      settings: opts.rows,
    });
  }
  return { userDir, projectDir };
}

const load = (p: { userDir: string; projectDir: string }) =>
  loadEffectiveConfig({ projectDir: p.projectDir, userDir: p.userDir, env: {} });

describe("hostile row keys", () => {
  const KEYS = [
    "proxy.constructor",
    "proxy.toString",
    "proxy.valueOf",
    "proxy.hasOwnProperty",
    "proxy.__proto__",
    "constructor.x",
    "__proto__.polluted",
  ];

  it.each(KEYS)("%s is an unknown key: no throw, no effect, no pollution", async (key) => {
    const p = await project({
      rows: [
        { key, value: "x", enforced: true },
        { key: "ui.pet", value: false, enforced: true },
      ],
    });
    const config = await load(p);
    // The hostile row is a plain unknown key: it must not cost the team its
    // legitimate tightening in the same payload, and the layer is not skipped.
    expect(config.settings.ui.pet).toBe(false);
    expect(config.provenance["ui.pet"]?.layer).toBe("team");
    expect(config.warnings.some((w) => w.includes("SKIPPED"))).toBe(false);
    expect(config.settings.proxy.upstream_base_url).toBe("https://api.anthropic.com");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(config.settings.proxy)).toBe(Object.prototype);
    expect(Object.keys(config.settings.proxy)).not.toContain(key.split(".")[1]);
  });

  it("translateTeamRows drops __proto__ as a leaf", () => {
    const out = translateTeamRows([{ key: "proxy.__proto__", value: { x: 1 }, enforced: true }]);
    expect(out.skipped.map((s) => s.key)).toContain("proxy.__proto__");
    expect(Object.getPrototypeOf((out.settings as Record<string, unknown>).proxy ?? {})).toBe(
      Object.prototype,
    );
  });
});

describe("the team notice reaches every surface", () => {
  const NOTICE = /no cached team settings/;

  async function linkedWithoutCache() {
    return await project({});
  }

  it("is in the effective warnings", async () => {
    const config = await load(await linkedWithoutCache());
    expect(config.warnings.some((w) => NOTICE.test(w))).toBe(true);
  });

  it("is reported by golem config get and list", async () => {
    const p = await linkedWithoutCache();
    const opts = { projectDir: p.projectDir, userDir: p.userDir, env: {} };
    expect((await getConfig("telemetry.enabled", opts)).warnings?.some((w) => NOTICE.test(w))).toBe(
      true,
    );
    expect((await listConfig(opts)).warnings?.some((w) => NOTICE.test(w))).toBe(true);
  });

  it("is reported by the TUI/control surface and status", async () => {
    const p = await linkedWithoutCache();
    const s = await collectControlSurface({
      projectDir: p.projectDir,
      userDir: p.userDir,
      env: {},
      version: VERSION,
    });
    expect(s.warnings.some((w) => NOTICE.test(w))).toBe(true);
    const r = await collectStatus({
      projectDir: p.projectDir,
      userDir: p.userDir,
      env: {},
      version: VERSION,
      probeTimeoutMs: 1,
    });
    expect(r.warnings.some((w) => NOTICE.test(w))).toBe(true);
  });

  it("is reported by the MCP server", async () => {
    const p = await linkedWithoutCache();
    const seen: string[] = [];
    await readMcpServeSettings(p.projectDir, p.userDir, (w) => seen.push(w));
    expect(seen.some((w) => NOTICE.test(w))).toBe(true);
  });

  it("covers sync-off and a portal denial too", async () => {
    const off = await project({
      projectTeam: { org_id: ORG, sync: false },
      rows: [{ key: "telemetry.enabled", value: false, enforced: true }],
    });
    expect((await load(off)).warnings.some((w) => /team\.sync.*off/.test(w))).toBe(true);

    const denied = await project({});
    await writeTeamLayerCache(denied.userDir, {
      org_id: ORG,
      fetched_at: new Date().toISOString(),
      settings: [{ key: "telemetry.enabled", value: false, enforced: true }],
      denied: {
        at: new Date().toISOString(),
        code: "subscription_required",
        status: 402,
        detail: "lapsed",
      },
    });
    const c = await load(denied);
    expect(c.settings.telemetry.enabled).toBe(true);
    expect(c.warnings.some((w) => /denied this team/.test(w))).toBe(true);
  });

  it("says nothing for an unlinked project", async () => {
    const c = await load(await project({ linked: false }));
    expect(c.warnings.some((w) => /team/i.test(w))).toBe(false);
  });
});

describe("the team cache is written atomically", () => {
  it("a reader never sees a torn file while a sync rewrites it, and no temp file is left", async () => {
    const userDir = await newTempDir();
    const mk = (n: number) => ({
      org_id: ORG,
      fetched_at: new Date(1_700_000_000_000 + n).toISOString(),
      // Large enough that a non-atomic write spans several chunks.
      settings: Array.from({ length: 400 }, (_, i) => ({
        key: `ui.pet`,
        value: i % 2 === 0,
        enforced: false,
      })),
    });
    await writeTeamLayerCache(userDir, mk(0));
    let done = false;
    const writer = (async () => {
      for (let i = 1; i <= 60; i += 1) await writeTeamLayerCache(userDir, mk(i));
      done = true;
    })();
    let torn = 0;
    while (!done) {
      if ((await readTeamLayerCache(userDir, ORG)) === null) torn += 1;
      // Pace the reader: on Windows a rename over a file that is open for reading
      // fails with EPERM, so a reader that never yields can starve the writer past
      // the rename retry budget. A real reader opens the cache once per call.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await writer;
    expect(torn).toBe(0);
    expect((await readdir(path.join(userDir, "teams"))).filter((n) => n.endsWith(".tmp"))).toEqual(
      [],
    );
  });
});
