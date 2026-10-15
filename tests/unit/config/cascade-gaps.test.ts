/**
 * DUST2.16 (r010 / r011): a pinned control is locked with its origin and
 * recourse on every surface, and a write the cascade overrules says so.
 *
 * Surfaces covered here: `golem config` get/list/set (text and JSON shapes),
 * `golem status`, the control-surface JSON that the VS Code extension reads
 * (`config schema --json`), the runtime controls, the dials, and the TUI model.
 */

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schemaPayload } from "../../../src/cli/commands/config.js";
import {
  getConfig,
  listConfig,
  renderConfigGet,
  renderConfigSet,
  setConfig,
} from "../../../src/cli/config.js";
import { setDial } from "../../../src/cli/dials.js";
import { collectStatus } from "../../../src/cli/status-collect.js";
import {
  applyControl,
  type Control,
  type ControlSurface,
  collectControlSurface,
} from "../../../src/config/control-surface.js";
import { writeTeamLayerCache } from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-cascade-gaps-");
let projectDir: string;
let userDir: string;

beforeEach(async () => {
  projectDir = await newTempDir();
  userDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
});

const write = (file: string, body: unknown) => writeFile(file, JSON.stringify(body), "utf8");
const projectFile = () => path.join(projectDir, ".golem", "settings.json");
const surfaceOpts = () => ({
  projectDir,
  userDir,
  version: "t",
  env: {},
  probeTimeoutMs: 20,
  localProbe: async () => ({ reachable: false }),
});
const shared = () => ({ projectDir, userDir, env: {} });
const find = (surface: ControlSurface, id: string): Control => {
  const c = surface.groups.flatMap((g) => g.controls).find((x) => x.id === id);
  if (c === undefined) throw new Error(`no control ${id}`);
  return c;
};
const pinLevel = () =>
  write(projectFile(), { compression: { level: "1" }, "!important": ["compression.level"] });

describe("runtime controls honour importance (r010)", () => {
  it("locks the compression dial when a repo pins it, with origin and recourse", async () => {
    await pinLevel();
    const c = find(await collectControlSurface(surfaceOpts()), "runtime:compression");
    expect(c.layer).toBe("project");
    expect(c.writableScopes).toEqual([]);
    expect(c.locked).toContain("!important");
    expect(c.locked).toContain("~/.golem/settings.json"); // the recourse
    expect(c.locked).not.toContain("settings.local.json");
  });

  it("locks the active-gateway control the same way", async () => {
    await write(projectFile(), {
      inference: { model: "foo" },
      "!important": ["inference.model"],
    });
    const c = find(await collectControlSurface(surfaceOpts()), "runtime:account");
    expect(c.locked).toContain("!important");
  });

  it("leaves it writable when nothing pins it", async () => {
    const c = find(await collectControlSurface(surfaceOpts()), "runtime:compression");
    expect(c.locked).toBeUndefined();
    expect(c.writableScopes).toEqual(["local"]);
  });
});

describe("a write the cascade overrules says so (r011)", () => {
  it("the compression dial reports the pin and the value that stays", async () => {
    await pinLevel();
    const result = await applyControl("runtime:compression", "3", "local", {
      ...shared(),
      version: "t",
    });
    expect(result.overridden).toContain("!important");
    expect(result.overridden).toContain("project");
    expect(result.value).toBe("1");
  });

  it("setDial carries the importance through", async () => {
    await pinLevel();
    const result = await setDial("compression", "3", shared());
    expect(result.overriddenBy).toEqual({
      layer: "project",
      source: projectFile(),
      important: true,
    });
  });

  it("does not call a merge-per-key write overridden because a lower layer holds other personas", async () => {
    await write(path.join(userDir, "settings.json"), {
      inference: { personas: { auditor: { discipline: "review" } } },
    });
    const result = await setConfig(
      "project",
      "inference.personas",
      JSON.stringify({ migrator: { discipline: "code" } }),
      shared(),
    );
    expect(result.overriddenBy).toBeUndefined();
  });

  it("still reports a persona field a higher layer changes", async () => {
    await write(path.join(projectDir, ".golem", "settings.local.json"), {
      inference: { personas: { migrator: { discipline: "review" } } },
    });
    const result = await setConfig(
      "project",
      "inference.personas",
      JSON.stringify({ migrator: { discipline: "code" } }),
      shared(),
    );
    expect(result.overriddenBy).toBeDefined();
  });

  it("`config set` text names the pin and the recourse", async () => {
    await pinLevel();
    const out = renderConfigSet(await setConfig("local", "compression.level", "3", shared()));
    expect(out).toContain("!important");
    expect(out).toContain(
      "note: this write has no effect — set by the repo's `.golem/settings.json`",
    );
    expect(out).toContain("~/.golem/settings.json");
  });
});

describe("pinned keys on config get / list / status / the JSON surface", () => {
  it("config get and list carry `locked` (origin + recourse) exactly when important", async () => {
    await pinLevel();
    const got = await getConfig("compression.level", shared());
    expect(got.important).toBe(true);
    expect(got.locked).toContain("repo's `.golem/settings.json`");
    expect(renderConfigGet(got)).toContain("locked: ");
    const list = await listConfig(shared());
    expect(list.entries.find((e) => e.key === "compression.level")?.locked).toBe(got.locked);
    expect(list.entries.find((e) => e.key === "brevity.level")?.locked).toBeUndefined();
    const plain = await getConfig("brevity.level", shared());
    expect(renderConfigGet(plain)).not.toContain("locked");
  });

  it("status reports the pin", async () => {
    await pinLevel();
    const report = await collectStatus({
      ...shared(),
      version: "t",
      probeTimeoutMs: 1,
    });
    const entry = report.config["compression.level"];
    expect(entry?.important).toBe(true);
    expect(entry?.locked).toContain("!important");
    expect(report.config["brevity.level"]?.locked).toBeUndefined();
  });

  it("the JSON the VS Code extension reads carries locked text and no writable scope", async () => {
    await pinLevel();
    const payload = JSON.parse(
      JSON.stringify(schemaPayload(await collectControlSurface(surfaceOpts()), false)),
    ) as { groups: { controls: Control[] }[] };
    const c = payload.groups
      .flatMap((g) => g.controls)
      .find((x) => x.id === "setting:compression.level");
    expect(c?.locked).toContain("repo's `.golem/settings.json`");
    expect(c?.writableScopes).toEqual([]);
  });
});

describe("a team value for a denied key is never echoed", () => {
  const SECRET_HOST = "leak-canary.example";

  it("stays out of warnings, refused, config get/list, status and the control JSON", async () => {
    const home = await newTempDir();
    const teamUserDir = path.join(home, ".golem");
    await mkdir(teamUserDir, { recursive: true });
    await write(projectFile(), { team: { org_id: "acme" } });
    await writeTeamLayerCache(teamUserDir, {
      org_id: "acme",
      fetched_at: new Date().toISOString(),
      settings: [
        { key: "proxy.upstream_base_url", value: `https://${SECRET_HOST}/v1`, enforced: true },
        { key: "compression.level", value: "1", enforced: true },
      ],
    });
    const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
    try {
      const opts = { projectDir, userDir: teamUserDir, env: {} };
      // The team layer is in force (so the denied key was really offered and refused)...
      const level = await getConfig("compression.level", opts);
      expect(level.layer).toBe("team");
      expect(level.important).toBe(true);
      expect(level.locked).toContain("your team");
      const url = await getConfig("proxy.upstream_base_url", opts);
      expect(url.layer).toBe("default");
      // ...and nothing that travels carries what it sent.
      const dump = JSON.stringify([
        await listConfig(opts),
        url,
        level,
        await collectStatus({ ...opts, version: "t", probeTimeoutMs: 1 }),
        await collectControlSurface({ ...surfaceOpts(), userDir: teamUserDir }),
      ]);
      expect(dump).toContain("proxy.upstream_base_url"); // the key is named...
      expect(dump).not.toContain(SECRET_HOST); // ...its value never is
    } finally {
      spy.mockRestore();
    }
  });
});

describe("merge-per-key leaves blame the field's own layer (inference.personas)", () => {
  const localFile = () => path.join(projectDir, ".golem", "settings.local.json");
  // Built at runtime so no model id is spelled twice in the fixture.
  const model = (n: string) => ["claude", n, "x"].join("-");

  async function probe() {
    await write(path.join(userDir, "settings.json"), {
      inference: { personas: { scribe: { model: model("pinned") } } },
      "!important": ["inference.personas"],
    });
    await write(localFile(), { inference: { personas: { coder: { model: model("local") } } } });
    return setConfig(
      "project",
      "inference.personas",
      JSON.stringify({ coder: { model: model("project") } }),
      shared(),
    );
  }

  it("names the ordinary local file, not the user! pin on a neighbouring entry", async () => {
    const result = await probe();
    expect(result.overriddenBy?.key).toBe("inference.personas.coder.model");
    expect(result.overriddenBy?.layer).toBe("local");
    expect(result.overriddenBy?.locked).toBeUndefined();
    const out = renderConfigSet(result);
    expect(out).toContain(
      "a higher-precedence layer overrides it (inference.personas.coder.model)",
    );
    expect(out).not.toContain("!important");
    expect(out).not.toContain("No origin can override it");
  });

  it("names the pin when the field that lost IS the pinned one", async () => {
    await write(path.join(userDir, "settings.json"), {
      inference: { personas: { coder: { model: model("pinned") } } },
      "!important": ["inference.personas"],
    });
    const result = await setConfig(
      "project",
      "inference.personas",
      JSON.stringify({ coder: { model: model("project") } }),
      shared(),
    );
    expect(result.overriddenBy?.layer).toBe("user");
    expect(result.overriddenBy?.important).toBe(true);
    expect(renderConfigSet(result)).toContain(
      "this write has no effect (inference.personas.coder.model)",
    );
  });

  it("does not lock the whole map, only the pinned field (get / list / status)", async () => {
    await probe();
    const got = await getConfig("inference.personas", shared());
    expect(got.important).toBeUndefined();
    expect(got.locked).toBeUndefined();
    expect(Object.keys(got.pinnedFields ?? {})).toEqual(["scribe.model"]);
    const entry = (await listConfig(shared())).entries.find((e) => e.key === "inference.personas");
    expect(entry?.locked).toBeUndefined();
    expect(Object.keys(entry?.pinnedFields ?? {})).toEqual(["scribe.model"]);
    const status = await collectStatus({ ...shared(), version: "t", probeTimeoutMs: 1 });
    expect(status.config["inference.personas"]?.locked).toBeUndefined();
    expect(status.config["inference.personas.scribe.model"]?.locked).toContain("!important");
    expect(status.config["inference.personas.coder.model"]?.locked).toBeUndefined();
    expect(status.config["inference.personas.scribe.model"]?.value).toBe(model("pinned"));
  });

  it("claims nothing for an empty write or one that is already in force", async () => {
    await write(path.join(userDir, "settings.json"), {
      inference: { personas: { scribe: { model: model("pinned") } } },
      "!important": ["inference.personas"],
    });
    expect(
      (await setConfig("project", "inference.personas", "{}", shared())).overriddenBy,
    ).toBeUndefined();
    const same = await setConfig(
      "project",
      "inference.personas",
      JSON.stringify({ scribe: { model: model("pinned") } }),
      shared(),
    );
    expect(same.overriddenBy).toBeUndefined();
    expect(renderConfigSet(same)).not.toContain("note:");
  });
});

describe("one explanation per overruled write", () => {
  it("config set prints the pin once", async () => {
    await pinLevel();
    const out = renderConfigSet(await setConfig("local", "compression.level", "3", shared()));
    expect(out.match(/beats every ordinary declaration/g)).toHaveLength(1);
    expect(out).not.toContain("\nlocked:");
  });
});
