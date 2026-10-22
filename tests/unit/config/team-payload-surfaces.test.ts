/**
 * DUST2.22 follow-up (B) — the team's raw payload (`team.teamLayer.settings`)
 * used to hold refused values, so any surface that serialised the resolution
 * would have leaked a denied key's value. `loadEffectiveConfig` no longer hands the
 * raw payload out at all (it reaches `loadConfig` by a separate channel); this
 * probes the object and every surface.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getConfig, listConfig } from "../../../src/cli/config.js";
import { collectStatus } from "../../../src/cli/status-collect.js";
import { collectControlSurface } from "../../../src/config/control-surface.js";
import { loadEffectiveConfig } from "../../../src/config/index.js";
import { writeTeamLayerCache } from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-payload-");
const CANARY = ["leak", "canary", "4417"].join("-");

async function fixture() {
  const userDir = path.join(await newTempDir(), ".golem");
  const projectDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await mkdir(userDir, { recursive: true });
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify({ team: { org_id: "acme-co" } }),
  );
  await writeTeamLayerCache(userDir, {
    org_id: "acme-co",
    fetched_at: new Date().toISOString(),
    settings: [
      { key: "proxy.upstream_base_url", value: `https://${CANARY}.example/v1`, enforced: true },
      { key: "inference.coder_prompt", value: CANARY, enforced: false },
      {
        key: "inference.personas",
        value: { scribe: { prompt_file: `/etc/${CANARY}` } },
        enforced: false,
      },
      { key: "inference.team_prompt", value: `${CANARY} https://x.example`, enforced: false },
      { key: "ui.pet", value: false, enforced: false },
    ],
  });
  return { userDir, projectDir };
}

describe("refused team values are not in the object handed to surfaces", () => {
  it("the team resolution carries no refused value, but still the applied one", async () => {
    const p = await fixture();
    const c = await loadEffectiveConfig({ ...p, env: {} });
    expect(c.refused).toEqual(
      expect.arrayContaining([
        "proxy.upstream_base_url",
        "inference.coder_prompt",
        "inference.personas",
        "inference.team_prompt",
      ]),
    );
    expect(JSON.stringify(c.team)).not.toContain(CANARY);
    // The accepted value is in force through settings, not through the payload.
    expect(c.settings.ui.pet).toBe(false);
    expect(c.provenance["ui.pet"]?.layer).toBe("team");
  });

  it("the resolved object carries no raw team payload at any depth", async () => {
    const p = await fixture();
    const c = await loadEffectiveConfig({ ...p, env: {} });
    expect("teamLayer" in c.team).toBe(false);
    expect(c.team.layerLoaded).toBe(true);
    const seen = new Set<unknown>();
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      for (const [k, child] of Object.entries(v)) {
        keys.push(k);
        walk(child);
      }
    };
    walk(c);
    expect(keys).not.toContain("teamLayer");
    expect(JSON.stringify(c)).not.toContain(CANARY);
  });

  it("no CLI, status or control-surface output serialises one", async () => {
    const p = await fixture();
    const opts = { projectDir: p.projectDir, userDir: p.userDir, env: {} };
    const dump = JSON.stringify([
      await listConfig(opts),
      await getConfig("proxy.upstream_base_url", opts),
      await getConfig("inference.coder_prompt", opts),
      await getConfig("inference.personas", opts),
      await getConfig("inference.team_prompt", opts),
      await collectStatus({ ...opts, version: "t", probeTimeoutMs: 1 }),
      await collectControlSurface({ ...opts, version: "t" }),
    ]);
    expect(dump).not.toContain(CANARY);
    expect(dump).toContain("inference.team_prompt"); // the key is named
  });
});

describe("who may read the raw team payload", () => {
  it("only the config and portal code touches `.teamLayer`", async () => {
    const src = path.resolve(__dirname, "../../../src");
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(f)));
        else if (/\.tsx?$/.test(f)) out.push(f);
      }
      return out;
    };
    const readers: string[] = [];
    for (const f of await walk(src)) {
      const rel = path.relative(src, f).split(path.sep).join("/");
      if (/\.teamLayer\b/.test(await readFile(f, "utf8"))) readers.push(rel);
    }
    expect(readers.sort()).toEqual(
      ["config/effective.ts", "config/loader.ts", "portal/team-layer.ts"].sort(),
    );
  });
});
