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
});
