/**
 * team-layer-everywhere (USER decision G3): team policy applies on EVERY surface
 * that reads settings, through ONE loader (`loadEffectiveConfig`).
 *
 * One fixture, one table of surfaces. For each surface the same four claims:
 *
 *   1. a team-set value is visible there (and enforced: it beats the user's own
 *      NORMAL value because the team row is marked enforced);
 *   2. the REMOTE_DENIED_SETTINGS floor still drops a denied key from the team;
 *   3. an invalid team value warns, is skipped, and the surface still works;
 *   4. a project with no team binding behaves exactly as before.
 *
 * Every row exercises the surface's REAL read, not the loader: before this task
 * all of them except status read the settings WITHOUT the team layer, so each
 * "visible" claim fails on the old code.
 *
 * The home directory is redirected because hooks, the MCP server and the proxy's
 * reload resolve `~/.golem` themselves and have no `userDir` to pass.
 */

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMcpServeSettings } from "../../../src/cli/commands/mcp-serve.js";
import { getConfig, listConfig } from "../../../src/cli/config.js";
import { startPersonaWatcher } from "../../../src/cli/persona-watcher.js";
import { reloadPolicy } from "../../../src/cli/proxy-runtime.js";
import { collectStatus } from "../../../src/cli/status-collect.js";
import { collectControlSurface } from "../../../src/config/control-surface.js";
import { DEFAULT_SETTINGS, policyFromSettings } from "../../../src/config/index.js";
import { readSnoozeEnforced, readSpawnGateSettings } from "../../../src/hooks/pre-tool-use.js";
import { writeTeamLayerCache } from "../../../src/portal/index.js";
import { VERSION } from "../../../src/version.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-everywhere-");

const ORG = "acme-co";

type Row = { key: string; value: unknown; enforced: boolean };

interface Fixture {
  readonly home: string;
  readonly userDir: string;
  readonly projectDir: string;
}

/** A project, optionally linked to ORG, with a team cache holding `rows`. */
async function fixture(opts: {
  rows?: Row[];
  linked?: boolean;
  userSettings?: object;
}): Promise<Fixture> {
  const home = await newTempDir();
  const userDir = path.join(home, ".golem");
  const projectDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await mkdir(userDir, { recursive: true });
  const projectSettings = opts.linked === false ? {} : { team: { org_id: ORG } };
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify(projectSettings),
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
  return { home, userDir, projectDir };
}

let homedir: ReturnType<typeof vi.spyOn> | undefined;
beforeEach(() => {
  homedir = undefined;
});
afterEach(() => {
  homedir?.mockRestore();
});
function useHome(f: Fixture): void {
  homedir = vi.spyOn(os, "homedir").mockReturnValue(f.home);
}

/**
 * What a surface reports for one key. `warnings` is `undefined` for a surface
 * that does not expose them (a hook returns a bare value).
 */
interface Reading {
  readonly value: unknown;
  readonly layer?: string;
  readonly warnings?: readonly string[];
}

interface Surface {
  readonly name: string;
  /** The key this surface can observe, its default, and a team value that differs. */
  readonly key: string;
  readonly teamValue: unknown;
  readonly read: (f: Fixture) => Promise<Reading>;
  /** Observes `proxy.bypass_all`, so the floor is checkable here. */
  readonly floor?: (f: Fixture) => Promise<Reading>;
  /** A value of the wrong type for `key`. */
  readonly invalid: unknown;
  readonly defaultValue: unknown;
  /** The user's own NORMAL value for `key` (defaults to `defaultValue`). */
  readonly userValue?: unknown;
}

const NO_ENV = {};

const SURFACES: readonly Surface[] = [
  {
    name: "golem status",
    key: "telemetry.enabled",
    teamValue: false,
    defaultValue: true,
    invalid: "banana",
    read: async (f) => {
      const r = await collectStatus({
        projectDir: f.projectDir,
        userDir: f.userDir,
        env: NO_ENV,
        version: VERSION,
        probeTimeoutMs: 1,
      });
      const c = r.config["telemetry.enabled"];
      return { value: c?.value, ...(c !== undefined && { layer: c.layer }), warnings: r.warnings };
    },
    floor: async (f) => {
      const r = await collectStatus({
        projectDir: f.projectDir,
        userDir: f.userDir,
        env: NO_ENV,
        version: VERSION,
        probeTimeoutMs: 1,
      });
      return { value: r.config["proxy.bypass_all"]?.value, warnings: r.warnings };
    },
  },
  {
    name: "golem config (get)",
    key: "telemetry.enabled",
    teamValue: false,
    defaultValue: true,
    invalid: "banana",
    read: async (f) => {
      const r = await getConfig("telemetry.enabled", {
        projectDir: f.projectDir,
        userDir: f.userDir,
        env: NO_ENV,
      });
      return { value: r.value, layer: r.layer };
    },
    floor: async (f) => {
      const r = await getConfig("proxy.bypass_all", {
        projectDir: f.projectDir,
        userDir: f.userDir,
        env: NO_ENV,
      });
      return { value: r.value };
    },
  },
  {
    name: "golem config (list)",
    key: "telemetry.enabled",
    teamValue: false,
    defaultValue: true,
    invalid: "banana",
    read: async (f) => {
      const r = await listConfig({ projectDir: f.projectDir, userDir: f.userDir, env: NO_ENV });
      const e = r.entries.find((x) => x.key === "telemetry.enabled");
      return { value: e?.value, ...(e !== undefined && { layer: e.layer }) };
    },
  },
  {
    name: "the TUI / control surface",
    key: "telemetry.enabled",
    teamValue: false,
    defaultValue: true,
    invalid: "banana",
    read: async (f) => {
      const s = await collectControlSurface({
        projectDir: f.projectDir,
        userDir: f.userDir,
        env: NO_ENV,
        version: VERSION,
      });
      const control = s.groups
        .flatMap((g) => g.controls)
        .find((c) => c.id === "setting:telemetry.enabled");
      expect(control, "telemetry.enabled must be a control").toBeDefined();
      return {
        value: control?.value,
        ...(control !== undefined && { layer: control.layer }),
        warnings: s.warnings,
      };
    },
    floor: async (f) => {
      const s = await collectControlSurface({
        projectDir: f.projectDir,
        userDir: f.userDir,
        env: NO_ENV,
        version: VERSION,
      });
      const control = s.groups
        .flatMap((g) => g.controls)
        .find((c) => c.id === "setting:proxy.bypass_all");
      return { value: control?.value, warnings: s.warnings };
    },
  },
  {
    name: "the MCP server",
    key: "knowledge.enabled",
    teamValue: false,
    defaultValue: true,
    invalid: "banana",
    read: async (f) => {
      useHome(f);
      const s = await readMcpServeSettings(f.projectDir);
      return { value: s.knowledge.enabled };
    },
    floor: async (f) => {
      useHome(f);
      const s = await readMcpServeSettings(f.projectDir);
      return { value: s.proxy.bypass_all };
    },
  },
  {
    name: "hooks (snooze enforcement)",
    key: "snooze.enforce",
    teamValue: true,
    defaultValue: false,
    invalid: "banana",
    read: async (f) => {
      useHome(f);
      return { value: await readSnoozeEnforced(f.projectDir) };
    },
  },
  {
    name: "hooks (spawn gate)",
    key: "snooze.spawn_gate",
    teamValue: true,
    defaultValue: false,
    invalid: "banana",
    read: async (f) => {
      useHome(f);
      return { value: (await readSpawnGateSettings(f.projectDir)).enabled };
    },
  },
  {
    name: "hot-reload (proxy dial reload)",
    key: "compression.level",
    teamValue: "3",
    userValue: "2",
    defaultValue: policyFromSettings(DEFAULT_SETTINGS).compression,
    invalid: "banana",
    read: async (f) => {
      useHome(f);
      const policy = await reloadPolicy(f.projectDir, DEFAULT_SETTINGS);
      return { value: policy.compression };
    },
  },
];

/** `compression.compression` maps to a numeric policy level; compare via the same function. */
function expected(surface: Surface, v: unknown): unknown {
  if (surface.key !== "compression.level") return v;
  return policyFromSettings({
    ...DEFAULT_SETTINGS,
    compression: { ...DEFAULT_SETTINGS.compression, level: v as never },
  }).compression;
}

describe.each(SURFACES)("team layer on $name", (surface) => {
  it("shows a team-set value, enforced over the user's own", async () => {
    const f = await fixture({
      // The user set the opposite at NORMAL importance; the team row is enforced.
      userSettings: userSetting(surface.key, surface.userValue ?? surface.defaultValue),
      rows: [{ key: surface.key, value: surface.teamValue, enforced: true }],
    });
    const r = await surface.read(f);
    expect(r.value).toEqual(expected(surface, surface.teamValue));
    if (r.layer !== undefined) expect(r.layer).toBe("team");
  });

  it("warns and skips the whole layer for an invalid team value, and the surface still answers", async () => {
    const f = await fixture({
      rows: [
        // `ui.advanced` is team-settable, so a wrong TYPE there is an invalid
        // value (not a policy refusal) and skips the layer: all-or-nothing (ADR-0008).
        { key: "ui.advanced", value: "banana", enforced: true },
        // A VALID row for this surface's own key is skipped along with it.
        { key: surface.key, value: surface.teamValue, enforced: true },
      ],
    });
    const r = await surface.read(f);
    expect(r.value).toEqual(surface.defaultValue);
    if (r.warnings !== undefined) {
      expect(r.warnings.some((w) => w.includes("team layer SKIPPED"))).toBe(true);
    }
  });

  it("is unchanged for a project with no team binding", async () => {
    // A cache exists on the machine for ORG, but this project never linked.
    const f = await fixture({
      linked: false,
      rows: [{ key: surface.key, value: surface.teamValue, enforced: true }],
    });
    const r = await surface.read(f);
    expect(r.value).toEqual(surface.defaultValue);
    if (r.layer !== undefined) expect(r.layer).toBe("default");
    if (r.warnings !== undefined) {
      expect(r.warnings.some((w) => w.includes("team"))).toBe(false);
    }
  });

  if (surface.floor !== undefined) {
    const floor = surface.floor;
    it("still refuses a denied key from the team origin (REMOTE_DENIED_SETTINGS)", async () => {
      const f = await fixture({
        rows: [{ key: "proxy.bypass_all", value: true, enforced: true }],
      });
      const r = await floor(f);
      expect(r.value).toBe(false);
      if (r.warnings !== undefined) {
        expect(
          r.warnings.some((w) => w.includes("REFUSED") && w.includes("proxy.bypass_all")),
        ).toBe(true);
      }
    });
  }
});

function userSetting(dotted: string, value: unknown): object {
  const [section, key] = dotted.split(".") as [string, string];
  return { [section]: { [key]: value } };
}

describe("team layer on hot-reload (persona watcher)", () => {
  it("re-syncs when `golem team sync` rewrites the team cache", async () => {
    const f = await fixture({ rows: [{ key: "telemetry.enabled", value: false, enforced: true }] });
    let syncs = 0;
    const watcher = await startPersonaWatcher(f.projectDir, {
      userDir: f.userDir,
      pollMs: 20,
      debounceMs: 10,
      onSync: () => {
        syncs += 1;
      },
    });
    try {
      const baseline = syncs; // the immediate self-heal sync
      await new Promise((r) => setTimeout(r, 60));
      await writeTeamLayerCache(f.userDir, {
        org_id: ORG,
        fetched_at: new Date(Date.now() + 5000).toISOString(),
        settings: [
          { key: "telemetry.enabled", value: true, enforced: true },
          { key: "ui.pet", value: false, enforced: false },
        ],
      });
      await vi.waitFor(() => expect(syncs).toBeGreaterThan(baseline), {
        timeout: 3000,
        interval: 20,
      });
    } finally {
      watcher.close();
    }
  });
});
