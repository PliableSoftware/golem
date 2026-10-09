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

const NUMERIC_LOWER = keysOf("lower-only").filter((k) => typeof defaultOf(k) === "number");

describe("lower-only numbers", () => {
  it.each(NUMERIC_LOWER)("%s: a team may lower it, never raise it", async (key) => {
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

  it("treats a non-number as an INVALID value (layer skipped), never coercing it", async () => {
    const c = await load(
      await project({
        rows: [{ key: "security.device_cert_days", value: "1", enforced: true }],
      }),
    );
    expect(c.settings.security.device_cert_days).toBe(90);
    expect(c.warnings.some((w) => w.includes("team layer SKIPPED"))).toBe(true);
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

  it("accepts only roots that EQUAL one of the member's (the consumer does exact membership after resolving)", async () => {
    const userSettings = { security: { origination_roots: [abs("work"), abs("play")] } };
    const narrower = await load(
      await project({ userSettings, rows: [{ key, value: [abs("work")], enforced: true }] }),
    );
    expect(roots(narrower)).toEqual([abs("work")]);
    // Equal after resolving: a redundant segment is the same root.
    const same = await load(
      await project({
        userSettings,
        rows: [{ key, value: [`${abs("work")}${path.sep}.`], enforced: true }],
      }),
    );
    expect(roots(same)).toEqual([`${abs("work")}${path.sep}.`]);

    // A descendant is NOT one of the member's roots: the consumer would refuse
    // it, so it narrows nothing and is refused here. Same for anything elsewhere.
    for (const value of [
      [abs("work/app")],
      [abs("other")],
      [abs("work"), abs("other")],
      [abs("")],
    ]) {
      const c = await load(await project({ userSettings, rows: [{ key, value, enforced: true }] }));
      expect(roots(c)).toEqual([abs("work"), abs("play")]);
      expect(refusedFor(c.warnings, key)).toBe(true);
    }
  });

  it("refuses a relative entry (it would resolve against whatever cwd the process has)", async () => {
    for (const userSettings of [undefined, { security: { origination_roots: [abs("work")] } }]) {
      const c = await load(
        await project({
          ...(userSettings !== undefined && { userSettings }),
          rows: [{ key, value: ["work", abs("work")], enforced: true }],
        }),
      );
      expect(roots(c)).toEqual(userSettings === undefined ? [] : [abs("work")]);
      expect(refusedFor(c.warnings, key)).toBe(true);
    }
  });
});

describe("review round 3: classes", () => {
  const cls = (k: string) => teamRule(k);
  it("plugins.enabled is DENIED: false would switch off org redaction plugins", () => {
    expect(cls("plugins.enabled")).toBe("denied");
  });
  it("lossy compression can only be lowered or forced off", () => {
    expect(cls("compression.force_semantic_on_caching")).toBe("false-only");
    expect(cls("compression.level")).toBe("lower-only");
    expect(cls("knowledge.read_skeleton_enabled")).toBe("false-only");
  });
  it("knowledge switches that widen what is done are false-only", () => {
    for (const k of [
      "knowledge.enabled",
      "knowledge.local_answer_enabled",
      "knowledge.rerank_enabled",
    ]) {
      expect(cls(k), k).toBe("false-only");
    }
  });
  it("timeouts are denied: availability is the member's call and no floor is justified", () => {
    for (const k of [
      "proxy.request_timeout_ms",
      "proxy.connect_timeout_ms",
      "proxy.idle_timeout_ms",
      "inference.request_timeout_ms",
      "knowledge.lsp_timeout_ms",
    ]) {
      expect(cls(k), k).toBe("denied");
    }
  });
  it("brevity.level is denied: it changes request bytes and the cached prefix", () => {
    expect(cls("brevity.level")).toBe("denied");
  });
});

describe("compression.level (ordered off < 1 < 2 < 3)", () => {
  const key = "compression.level";
  const levelOf = (c: Awaited<ReturnType<typeof load>>) => c.settings.compression.level;
  const userAt = (level: string) => ({ compression: { level } });

  it.each([
    ["3", "2", true],
    ["3", "off", true],
    ["2", "1", true],
    ["2", "2", true],
    ["1", "2", false],
    ["off", "1", false],
    ["2", "3", false],
  ])("member %s, team %s -> applied: %s", async (mine, team, applies) => {
    const c = await load(
      await project({ userSettings: userAt(mine), rows: [{ key, value: team, enforced: true }] }),
    );
    expect(levelOf(c)).toBe(applies ? team : mine);
    expect(refusedFor(c.warnings, key)).toBe(!applies && true);
  });

  it("an unknown level is an INVALID value (layer skipped), not a policy refusal", async () => {
    const c = await load(await project({ rows: [{ key, value: "9", enforced: true }] }));
    expect(c.warnings.some((w) => w.includes("team layer SKIPPED"))).toBe(true);
  });
});

describe("knowledge.auto_index_max_files: 0 means no cap", () => {
  const key = "knowledge.auto_index_max_files";
  it("refuses 0 unless the member's own value is already 0", async () => {
    const c = await load(await project({ rows: [{ key, value: 0, enforced: true }] }));
    expect(c.settings.knowledge.auto_index_max_files).toBe(50);
    expect(refusedFor(c.warnings, key)).toBe(true);

    const mine0 = await load(
      await project({
        userSettings: { knowledge: { auto_index_max_files: 0 } },
        rows: [{ key, value: 0, enforced: true }],
      }),
    );
    expect(refusedFor(mine0.warnings, key)).toBe(false);
  });
});

describe("the real pass can never throw because of a member-relative refusal", () => {
  it("a value the schema rejects skips the layer even when the member's own value would have refused it first", async () => {
    // member 64 MiB, team 40000000.5: lower than the member's, so the relative
    // rule passes, but it is not an integer. Against the DEFAULTS (which is all the
    // dry run has) it was HIGHER and was refused without validation, so only the
    // real pass saw the bad value and threw.
    const p = await project({
      userSettings: { proxy: { max_request_body_bytes: 67_108_864 } },
      rows: [
        { key: "proxy.max_request_body_bytes", value: 40_000_000.5, enforced: true },
        { key: "ui.pet", value: false, enforced: true },
      ],
    });
    const c = await load(p);
    expect(c.warnings.some((w) => w.includes("team layer SKIPPED"))).toBe(true);
    expect(c.settings.proxy.max_request_body_bytes).toBe(67_108_864);
    expect(c.settings.ui.pet).toBe(true);
    expect(c.teamFailure).toBeUndefined();
  });
});

describe("a refusal never echoes a denied key's value", () => {
  // Secrets are assembled at runtime so no literal credential sits in the repo.
  const PASSWORD = ["hunt", "er2"].join("");
  const PASSWORD_URL = `https://admin:${PASSWORD}@evil.example/v1`;
  const API_KEY = ["sk", "ant", "api03", "secretsecretsecret"].join("-");
  const rows: Row[] = [
    { key: "proxy.upstream_base_url", value: PASSWORD_URL, enforced: true },
    { key: "inference.ollama_base_url", value: PASSWORD_URL, enforced: false },
    {
      key: "proxy.gateways",
      value: { x: { base_url: PASSWORD_URL, api_key: API_KEY } },
      enforced: true,
    },
    { key: "inference.coder_prompt", value: `use ${API_KEY}`, enforced: true },
    { key: "security.origination_roots", value: [`/tmp/${API_KEY}`, "relative"], enforced: true },
    { key: "ui.pet", value: false, enforced: true },
  ];
  const leaks = (text: string): boolean =>
    text.includes("hunter2") || text.includes("sk-ant") || text.includes("secretsecret");

  it("keeps the secret out of warnings, refused, skipped, status, the control surface, MCP output and translate", async () => {
    const p = await project({ rows });
    const c = await load(p);
    expect(c.refused).toContain("proxy.upstream_base_url");
    expect(c.settings.ui.pet).toBe(false); // the legitimate row still applied
    expect(leaks(JSON.stringify([c.warnings, c.refused, c.team.applied, c.team.skipped]))).toBe(
      false,
    );
    // The warning still names the KEY, so an admin knows what was refused.
    expect(refusedFor(c.warnings, "proxy.upstream_base_url")).toBe(true);

    const out = translateTeamRows(rows);
    expect(leaks(JSON.stringify([out.applied, out.skipped]))).toBe(false);

    const { collectStatus } = await import("../../../src/cli/status-collect.js");
    const status = await collectStatus({
      projectDir: p.projectDir,
      userDir: p.userDir,
      env: {},
      version: "0.0.0",
      probeTimeoutMs: 1,
    });
    expect(leaks(JSON.stringify(status))).toBe(false);

    const { collectControlSurface } = await import("../../../src/config/control-surface.js");
    const surface = await collectControlSurface({
      projectDir: p.projectDir,
      userDir: p.userDir,
      env: {},
      version: "0.0.0",
    });
    expect(leaks(JSON.stringify(surface))).toBe(false);

    const { readMcpServeSettings } = await import("../../../src/cli/commands/mcp-serve.js");
    const stderr: string[] = [];
    const settings = await readMcpServeSettings(p.projectDir, p.userDir, (w) => stderr.push(w));
    expect(leaks(stderr.join("\n"))).toBe(false);
    expect(leaks(JSON.stringify(settings))).toBe(false);
  });

  it("still prints the value for a boolean or number rule, where it is harmless", async () => {
    const c = await load(
      await project({ rows: [{ key: "security.device_cert_days", value: 9999, enforced: true }] }),
    );
    expect(
      c.warnings.some((w) => w.includes('"security.device_cert_days"') && w.includes("9999")),
    ).toBe(true);
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
