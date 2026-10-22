/** `writeSettings`: several keys in one scope, validated first and written once. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeSettings } from "../../../src/config/write-setting.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-write-settings");

describe("writeSettings", () => {
  it("writes every key in one go and preserves indentation, order and trailing newline", async () => {
    const projectDir = await newTempDir();
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    const file = path.join(projectDir, ".golem", "settings.json");
    await writeFile(
      file,
      `${JSON.stringify({ knowledge: { wiki_dir: "w" }, team: { org_id: "old", project: "x" } }, null, 4)}\n`,
    );
    await writeSettings(
      "project",
      { "team.org_id": "new", "team.project": undefined, "team.portal_url": "https://p.test" },
      { projectDir },
    );
    const text = await readFile(file, "utf8");
    expect(JSON.parse(text)).toEqual({
      knowledge: { wiki_dir: "w" },
      team: { org_id: "new", portal_url: "https://p.test" },
    });
    expect(text.startsWith('{\n    "knowledge"')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("a later invalid value leaves the file untouched: no org_id/slug mismatch", async () => {
    const projectDir = await newTempDir();
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    const file = path.join(projectDir, ".golem", "settings.json");
    const before = JSON.stringify({ team: { org_id: "old", project: "x" } });
    await writeFile(file, before);
    await expect(
      writeSettings("project", { "team.org_id": "new", "team.project": 42 }, { projectDir }),
    ).rejects.toThrow(/team\.project/);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("a retired key and its live replacement in one call write one deterministic value", async () => {
    for (const changes of [
      { "proxy.default_target": "old-model", "inference.model": "new-model" },
      { "inference.model": "new-model", "proxy.default_target": "old-model" },
    ]) {
      const projectDir = await newTempDir();
      await writeSettings("project", changes, { projectDir });
      const text = await readFile(path.join(projectDir, ".golem", "settings.json"), "utf8");
      // The live key wins whatever the object order, and the retired key never lands.
      expect(JSON.parse(text)).toEqual({ inference: { model: "new-model" } });
    }
  });

  it("empty changes neither create nor rewrite the file", async () => {
    const fresh = await newTempDir();
    await writeSettings("project", {}, { projectDir: fresh });
    await expect(readFile(path.join(fresh, ".golem", "settings.json"), "utf8")).rejects.toThrow(
      /ENOENT/,
    );

    const projectDir = await newTempDir();
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    const file = path.join(projectDir, ".golem", "settings.json");
    const odd = '{"team":   {"org_id":"x"}}'; // would be reformatted by a rewrite
    await writeFile(file, odd);
    await writeSettings("project", {}, { projectDir });
    expect(await readFile(file, "utf8")).toBe(odd);
  });

  it("reports the losing key through onShadowed as (dropped, kept)", async () => {
    const projectDir = await newTempDir();
    const seen: [string, string][] = [];
    await writeSettings(
      "project",
      { "proxy.default_target": "old-model", "inference.model": "new-model" },
      { projectDir, onShadowed: (dropped, kept) => seen.push([dropped, kept]) },
    );
    expect(seen).toEqual([["proxy.default_target", "inference.model"]]);
  });
});
