/**
 * DUST2.16 (r004): `default!` is honoured as a floor.
 *
 * The real registry is empty, so the resolver is exercised through the
 * `defaultImportant` seam and the surfaces through a mock of the registry
 * module. The invariants on what may ever be IN the registry are asserted
 * against the real module.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyControl, collectControlSurface } from "../../../src/config/control-surface.js";
import { loadConfig } from "../../../src/config/loader.js";
import { useTempDirs } from "../../helpers/tmp.js";

const KEY = "knowledge.rerank_enabled";

vi.mock("../../../src/config/default-floor.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/config/default-floor.js")>();
  return { ...real, DEFAULT_IMPORTANT_KEYS: new Set(["knowledge.rerank_enabled"]) };
});

const newTempDir = useTempDirs("golem-default-floor-");
let projectDir: string;
let userDir: string;

beforeEach(async () => {
  projectDir = await newTempDir();
  userDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
});

const write = (file: string, body: unknown) => writeFile(file, JSON.stringify(body), "utf8");
const projectFile = () => path.join(projectDir, ".golem", "settings.json");
const localFile = () => path.join(projectDir, ".golem", "settings.local.json");
const userFile = () => path.join(userDir, "settings.json");

describe("default! in the resolver", () => {
  it("beats every origin, including important declarations and the environment", async () => {
    await write(userFile(), { knowledge: { rerank_enabled: true }, "!important": [KEY] });
    await write(projectFile(), { knowledge: { rerank_enabled: true }, "!important": [KEY] });
    await write(localFile(), { knowledge: { rerank_enabled: true }, "!important": [KEY] });
    const config = await loadConfig({
      projectDir,
      userDir,
      env: { GOLEM_KNOWLEDGE_RERANK_ENABLED: "true" },
      overrides: { knowledge: { rerank_enabled: true } },
      defaultImportant: new Set([KEY]),
    });
    expect(config.settings.knowledge.rerank_enabled).toBe(false);
    expect(config.provenance[KEY]).toEqual({ layer: "default", important: true });
    const said = config.warnings.filter((w) => w.includes(KEY) && w.includes("default!"));
    // one per origin that tried: user, project, local, override, env
    expect(said).toHaveLength(5);
  });

  it("changes nothing when no origin declares the key", async () => {
    const config = await loadConfig({
      projectDir,
      userDir,
      env: {},
      defaultImportant: new Set([KEY]),
    });
    expect(config.settings.knowledge.rerank_enabled).toBe(false);
    expect(config.provenance[KEY]).toEqual({ layer: "default", important: true });
    expect(config.warnings.filter((w) => w.includes("default!"))).toEqual([]);
  });

  it("is a no-op for the empty registry: provenance is byte-identical to before", async () => {
    await write(userFile(), { knowledge: { rerank_enabled: true } });
    const config = await loadConfig({ projectDir, userDir, env: {}, defaultImportant: new Set() });
    expect(config.settings.knowledge.rerank_enabled).toBe(true);
    expect(config.provenance[KEY]).toEqual({ layer: "user", source: userFile() });
  });

  it("never prints what a team sent for a pinned key", async () => {
    const config = await loadConfig({
      projectDir,
      userDir,
      env: {},
      teamLayer: {
        settings: { knowledge: { rerank_enabled: false } },
        source: "acme",
      },
      defaultImportant: new Set([KEY]),
    });
    expect(config.settings.knowledge.rerank_enabled).toBe(false);
    // The team's value for a pinned key is ignored, and the line that says so
    // names the origin and the key only — no value of any kind.
    const line = config.warnings.find((w) => w.startsWith("acme:") && w.includes(KEY));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\b(true|false)\b/);
  });

  it("rejects a registry entry that would not be a floor", async () => {
    const bad = [
      "proxy.bypass_all", // CLI-only, denied
      "proxy.port", // no stricter direction
      "compression.level", // a number: no verifiable strict value
      "telemetry.enabled", // not a team-policy direction at all
      "knowledge.nope", // not a key
    ];
    for (const key of bad) {
      await expect(
        loadConfig({ projectDir, userDir, env: {}, defaultImportant: new Set([key]) }),
      ).rejects.toThrow(/invalid default! floor entry/);
    }
  });
});

describe("default! on every surface", () => {
  it("renders the control locked by Golem itself, with no recourse to offer", async () => {
    await write(projectFile(), { knowledge: { rerank_enabled: true } });
    const surface = await collectControlSurface({
      projectDir,
      userDir,
      version: "t",
      env: {},
      probeTimeoutMs: 20,
      localProbe: async () => ({ reachable: false }),
    });
    const control = surface.groups
      .flatMap((g) => g.controls)
      .find((c) => c.id === `setting:${KEY}`);
    expect(control?.value).toBe(false);
    expect(control?.layer).toBe("default");
    expect(control?.locked).toContain("Golem itself");
    expect(control?.locked).toContain("No origin can override it.");
    expect(control?.writableScopes).toEqual([]);
  });

  it("says a write was overruled by default!", async () => {
    const result = await applyControl(`setting:${KEY}`, true, "project", {
      projectDir,
      userDir,
      version: "t",
      env: {},
    });
    expect(result.overridden).toContain("default!");
    expect(result.value).toBe(false);
  });
});

describe("what may ever be in the real registry", () => {
  it("passes its own validation and never contains proxy.bypass_all", async () => {
    const real = await vi.importActual<typeof import("../../../src/config/default-floor.js")>(
      "../../../src/config/default-floor.js",
    );
    expect(() => real.assertFloor(real.DEFAULT_IMPORTANT_KEYS)).not.toThrow();
    expect(real.DEFAULT_IMPORTANT_KEYS.has("proxy.bypass_all")).toBe(false);
  });
});
