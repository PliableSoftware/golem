/**
 * The team policy table (USER decision P4: a team may only TIGHTEN).
 *
 * Default-deny: every leaf of the settings schema must carry a class in
 * TEAM_POLICY, so adding a key forces a decision. Each class is then exercised
 * through the real loader, per key, so a table edit that loosens something is
 * caught by the behaviour and not only by the data.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadEffectiveConfig,
  REMOTE_DENIED_SETTINGS,
} from "../../../src/config/index.js";
import { allLeafPaths } from "../../../src/config/schema.js";
import {
  REMOTE_FALSE_ONLY_SETTINGS,
  TEAM_POLICY,
  type TeamRule,
  teamRule,
} from "../../../src/config/team-policy.js";
import { translateTeamRows, writeTeamLayerCache } from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-policy-");
const ORG = "acme-co";

type Row = { key: string; value: unknown; enforced: boolean };

async function project(opts: { rows: Row[]; userSettings?: object }) {
  const userDir = path.join(await newTempDir(), ".golem");
  const projectDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await mkdir(userDir, { recursive: true });
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify({ team: { org_id: ORG } }),
  );
  if (opts.userSettings !== undefined) {
    await writeFile(path.join(userDir, "settings.json"), JSON.stringify(opts.userSettings));
  }
  await writeTeamLayerCache(userDir, {
    org_id: ORG,
    fetched_at: new Date().toISOString(),
    settings: opts.rows,
  });
  return { userDir, projectDir };
}

const load = (p: { userDir: string; projectDir: string }) =>
  loadEffectiveConfig({ projectDir: p.projectDir, userDir: p.userDir, env: {} });

const split = (dotted: string): [string, string] => dotted.split(".") as [string, string];
const read = (settings: unknown, dotted: string): unknown => {
  const [s, k] = split(dotted);
  return (settings as Record<string, Record<string, unknown>>)[s]?.[k];
};
/** Optional keys have no default; give a schema-valid sample for them. */
const SAMPLES: Record<string, unknown> = { "proxy.idle_timeout_ms": 60_000 };
const defaultOf = (dotted: string): unknown => read(DEFAULT_SETTINGS, dotted) ?? SAMPLES[dotted];
const keysOf = (rule: TeamRule): string[] =>
  Object.entries(TEAM_POLICY)
    .filter(([, r]) => r === rule)
    .map(([k]) => k);
const refusedFor = (warnings: readonly string[], key: string): boolean =>
  warnings.some((w) => w.includes("REFUSED") && w.includes(`"${key}"`));

describe("the table is total", () => {
  it("classifies EVERY leaf key of the schema, and nothing else", () => {
    const leaves = [...allLeafPaths()].sort();
    const classified = Object.keys(TEAM_POLICY).sort();
    const unclassified = leaves.filter((k) => !classified.includes(k));
    const stale = classified.filter((k) => !leaves.includes(k));
    expect(unclassified, "a new key needs a team class in src/config/team-policy.ts").toEqual([]);
    expect(stale, "classified keys that are no longer in the schema").toEqual([]);
  });

  it("denies a key that is not in the table", () => {
    expect(teamRule("proxy.something_new")).toBe("denied");
    expect(teamRule("constructor")).toBe("denied");
    expect(teamRule("toString")).toBe("denied");
  });

  it("derives the exported sets from the table", () => {
    expect([...REMOTE_DENIED_SETTINGS].sort()).toEqual(keysOf("denied").sort());
    expect([...REMOTE_FALSE_ONLY_SETTINGS].sort()).toEqual(keysOf("false-only").sort());
  });

  it("keeps the keys the 2026-10-09 probe showed a team could abuse OFF the settable list", () => {
    const mustNotBeSettable = [
      "knowledge.lsp_servers",
      "knowledge.lsp_enabled",
      "proxy.gateways",
      "inference.model",
      "proxy.targets",
      "proxy.upstream_provider",
      "proxy.upstream_auth_scheme",
      "proxy.upstream_base_url",
      "inference.ollama_base_url",
      "inference.providers",
      "inference.worker_targets",
      "knowledge.vector_db_url",
      "models.catalog_url",
      "inference.personas",
      "inference.coder_prompt",
      "security.unlock_window_minutes",
      "security.idle_relock_minutes",
      "security.step_up_max_age_minutes",
      "security.device_cert_days",
      "security.origination_roots",
      "snooze.enforce",
      "snooze.spawn_gate",
      "compression.headroom_config",
      "knowledge.watch_paths",
      "knowledge.wiki_dir",
      "claude.settings_scope",
      "plugins.enabled",
      "plugins.load",
      "telemetry.dashboard_lan",
      "security.write_lan",
      "security.join_injection",
    ];
    for (const k of mustNotBeSettable) expect(teamRule(k), k).not.toBe("settable");
  });
});

describe("denied keys", () => {
  it.each(keysOf("denied"))("%s is refused at either importance, naming the key", async (key) => {
    for (const enforced of [false, true]) {
      // The key's own default is always a schema-valid value, so this is purely a POLICY refusal.
      const config = await load(
        await project({ rows: [{ key, value: defaultOf(key), enforced }] }),
      );
      expect(refusedFor(config.warnings, key), config.warnings.join("\n")).toBe(true);
      // (`team.org_id` is also set by the project file here, so "not team" is the claim.)
      expect(config.provenance[key]?.layer).not.toBe("team");
      expect(config.refused).toContain(key);
    }
  });
});

describe("settable keys", () => {
  it.each(keysOf("settable"))("%s is applied from the team with team provenance", async (key) => {
    const config = await load(
      await project({ rows: [{ key, value: defaultOf(key), enforced: true }] }),
    );
    expect(config.provenance[key]?.layer).toBe("team");
    expect(config.warnings.some((w) => w.includes("REFUSED"))).toBe(false);
  });
});

describe("false-only and true-only booleans", () => {
  it.each(
    keysOf("false-only"),
  )("%s: false applies and beats the member's true; true is refused", async (key) => {
    const [section, leaf] = split(key);
    const tightened = await load(
      await project({
        userSettings: { [section]: { [leaf]: true } },
        rows: [{ key, value: false, enforced: true }],
      }),
    );
    expect(read(tightened.settings, key)).toBe(false);
    expect(tightened.provenance[key]?.layer).toBe("team");

    const loosened = await load(await project({ rows: [{ key, value: true, enforced: true }] }));
    expect(read(loosened.settings, key)).toBe(defaultOf(key));
    expect(refusedFor(loosened.warnings, key)).toBe(true);
  });

  it.each(keysOf("true-only"))("%s: true applies; false is refused", async (key) => {
    const [section, leaf] = split(key);
    const tightened = await load(
      await project({
        userSettings: { [section]: { [leaf]: false } },
        rows: [{ key, value: true, enforced: true }],
      }),
    );
    expect(read(tightened.settings, key)).toBe(true);
    expect(tightened.provenance[key]?.layer).toBe("team");

    const loosened = await load(
      await project({
        userSettings: { [section]: { [leaf]: true } },
        rows: [{ key, value: false, enforced: true }],
      }),
    );
    expect(read(loosened.settings, key)).toBe(true);
    expect(refusedFor(loosened.warnings, key)).toBe(true);
  });

  it("refuses a non-boolean for a false-only key, naming the key", async () => {
    const c = await load(
      await project({ rows: [{ key: "security.write_lan", value: "false", enforced: true }] }),
    );
    expect(c.settings.security.write_lan).toBe(false);
    expect(refusedFor(c.warnings, "security.write_lan")).toBe(true);
  });
});

describe("lower-only numbers", () => {
  it.each(keysOf("lower-only"))("%s: a team may lower it, never raise it", async (key) => {
    const base = defaultOf(key) as number;
    const lower = Math.max(1, Math.floor(base / 2));

    const lowered = await load(await project({ rows: [{ key, value: lower, enforced: true }] }));
    expect(read(lowered.settings, key)).toBe(lower);
    expect(lowered.provenance[key]?.layer).toBe("team");

    const same = await load(await project({ rows: [{ key, value: base, enforced: true }] }));
    expect(refusedFor(same.warnings, key)).toBe(false);

    const raised = await load(await project({ rows: [{ key, value: base + 1, enforced: true }] }));
    expect(read(raised.settings, key)).toBe(base);
    expect(refusedFor(raised.warnings, key)).toBe(true);
    expect(raised.refused).toContain(key);
  });

  it("names the team's value in the warning and shows a team-set security value in status with team provenance", async () => {
    const p = await project({
      rows: [
        { key: "security.unlock_window_minutes", value: 99, enforced: true },
        { key: "security.idle_relock_minutes", value: 2, enforced: true },
      ],
    });
    const c = await load(p);
    expect(
      c.warnings.some((w) => w.includes('"security.unlock_window_minutes"') && w.includes("99")),
    ).toBe(true);
    const { collectStatus } = await import("../../../src/cli/status-collect.js");
    const r = await collectStatus({
      projectDir: p.projectDir,
      userDir: p.userDir,
      env: {},
      version: "0.0.0",
      probeTimeoutMs: 1,
    });
    expect(r.config["security.idle_relock_minutes"]).toMatchObject({ value: 2, layer: "team" });
  });

  it("judges against the MEMBER's own value, not the default", async () => {
    const key = "security.unlock_window_minutes";
    const mine = 5; // already stricter than the default of 15
    const c = await load(
      await project({
        userSettings: { security: { unlock_window_minutes: mine } },
        rows: [{ key, value: 10, enforced: true }], // lower than the default, higher than mine
      }),
    );
    expect(c.settings.security.unlock_window_minutes).toBe(mine);
    expect(refusedFor(c.warnings, key)).toBe(true);
  });

  it("refuses a non-number rather than coercing it", async () => {
    const c = await load(
      await project({
        rows: [{ key: "security.device_cert_days", value: "1", enforced: true }],
      }),
    );
    expect(c.settings.security.device_cert_days).toBe(90);
    expect(refusedFor(c.warnings, "security.device_cert_days")).toBe(true);
  });
});

describe("security.origination_roots (narrow-roots)", () => {
  const key = "security.origination_roots";
  const roots = (c: Awaited<ReturnType<typeof load>>) => c.settings.security.origination_roots;
  const abs = (p: string) => path.resolve(path.sep, p);

  it("refuses [] (the loosest) and a malformed list", async () => {
    for (const value of [[], "x", [1]]) {
      const c = await load(await project({ rows: [{ key, value, enforced: true }] }));
      expect(roots(c)).toEqual([]);
      expect(refusedFor(c.warnings, key)).toBe(true);
    }
  });

  it("accepts a non-empty list when the member has none (that is a narrowing)", async () => {
    const c = await load(await project({ rows: [{ key, value: [abs("work")], enforced: true }] }));
    expect(roots(c)).toEqual([abs("work")]);
    expect(c.provenance[key]?.layer).toBe("team");
  });

  it("accepts a subset or sub-path of the member's roots, refuses anything wider or elsewhere", async () => {
    const userSettings = { security: { origination_roots: [abs("work"), abs("play")] } };
    const narrower = await load(
      await project({ userSettings, rows: [{ key, value: [abs("work/app")], enforced: true }] }),
    );
    expect(roots(narrower)).toEqual([abs("work/app")]);

    for (const value of [[abs("other")], [abs("work"), abs("other")], [abs("")]]) {
      const c = await load(await project({ userSettings, rows: [{ key, value, enforced: true }] }));
      expect(roots(c)).toEqual([abs("work"), abs("play")]);
      expect(refusedFor(c.warnings, key)).toBe(true);
    }
  });
});

describe("what the team sync reports", () => {
  it("lists a policy-refused row as REFUSED, never as applied", () => {
    const out = translateTeamRows([
      { key: "ui.pet", value: false, enforced: true },
      { key: "proxy.gateways", value: {}, enforced: true },
      { key: "security.write_lan", value: true, enforced: true },
      { key: "security.write_lan", value: false, enforced: false },
    ]);
    expect(out.applied.some((a) => a.startsWith("proxy.gateways"))).toBe(false);
    expect(out.applied).toContain("ui.pet (enforced)");
    const skipped = out.skipped.filter((s) => s.key === "proxy.gateways");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toMatch(/^REFUSED/);
    // The LAST row for write_lan is the tightening one: it is placed, and the
    // refused earlier row it replaced is not reported as refused.
    expect(out.applied).toContain("security.write_lan");
    expect(out.skipped.some((s) => s.key === "security.write_lan")).toBe(false);
  });

  it("excludes keys the loader refused against the member's value from team.applied", async () => {
    const key = "security.device_cert_days";
    const c = await load(
      await project({
        rows: [
          { key, value: 9999, enforced: true },
          { key: "ui.pet", value: false, enforced: false },
        ],
      }),
    );
    expect(c.team.applied.some((a) => a.startsWith(key))).toBe(false);
    expect(c.team.applied).toContain("ui.pet");
    expect(c.team.skipped.find((s) => s.key === key)?.reason).toMatch(/REFUSED/);
  });
});
