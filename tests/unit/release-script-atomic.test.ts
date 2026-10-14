/**
 * DUST2.21 — scripts/release.mjs moves every version surface or none.
 * Drives the exported logic against temp copies of the layout (never the real
 * tree) with failures injected into the write path.
 */

import {
  mkdir,
  readdir,
  readFile,
  rename as realRename,
  writeFile as realWriteFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useTempDirs } from "../helpers/tmp.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseUrl = path.join(repoRoot, "scripts", "release.mjs");
const release = (await import(/* @vite-ignore */ releaseUrl)) as {
  bumpVersions: (root: string, bump: string, io?: unknown) => Promise<{ target: string }>;
  planBump: (root: string, bump: string) => Promise<unknown>;
};
const newTempDir = useTempDirs("golem-release-atomic");

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const FILES = [
  "package.json",
  path.join("vscode-extension", "package.json"),
  "package-lock.json",
  path.join("src", "version.ts"),
];

async function sandbox(): Promise<string> {
  const dir = await newTempDir();
  await mkdir(path.join(dir, "vscode-extension"), { recursive: true });
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    json({ name: "@pliable/golem", version: "1.2.3" }),
  );
  await writeFile(
    path.join(dir, "vscode-extension", "package.json"),
    json({ name: "e", version: "1.2.3" }),
  );
  await writeFile(
    path.join(dir, "package-lock.json"),
    json({ version: "1.2.3", packages: { "": { version: "1.2.3" } } }),
  );
  await writeFile(path.join(dir, "src", "version.ts"), 'export const VERSION = "1.2.3";\n');
  return dir;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of FILES) out[rel] = await readFile(path.join(dir, rel), "utf8");
  return out;
}

async function noStrays(dir: string): Promise<void> {
  for (const d of [dir, path.join(dir, "vscode-extension"), path.join(dir, "src")]) {
    expect((await readdir(d)).filter((n) => n.includes(".release-"))).toEqual([]);
  }
}

describe("release.mjs atomic bump", () => {
  it("moves all surfaces on success", async () => {
    const dir = await sandbox();
    const r = await release.bumpVersions(dir, "minor");
    expect(r.target).toBe("1.3.0");
    const after = await snapshot(dir);
    expect(after["package.json"]).toContain('"1.3.0"');
    expect(after[path.join("vscode-extension", "package.json")]).toContain('"1.3.0"');
    expect(after["package-lock.json"]).not.toContain("1.2.3");
    expect(after[path.join("src", "version.ts")]).toContain('VERSION = "1.3.0"');
    await noStrays(dir);
  });

  it("changes nothing when a rename fails part-way (restores the ones already replaced)", async () => {
    const dir = await sandbox();
    const before = await snapshot(dir);
    let renames = 0;
    const io = {
      writeFile: realWriteFile,
      rename: async (a: string, b: string) => {
        renames += 1;
        if (renames === 3) throw new Error("injected rename failure");
        await realRename(a, b);
      },
      rm: async () => {},
    };
    await expect(release.bumpVersions(dir, "patch", io)).rejects.toThrow(/injected rename failure/);
    expect(renames).toBe(3);
    expect(await snapshot(dir)).toEqual(before);
    await noStrays(dir);
  });

  it("changes nothing when a temp write fails (no target touched)", async () => {
    const dir = await sandbox();
    const before = await snapshot(dir);
    let writes = 0;
    const io = {
      writeFile: async (p: string, c: string, e: "utf8") => {
        writes += 1;
        if (writes === 4) throw new Error("injected write failure");
        await realWriteFile(p, c, e);
      },
      rename: realRename,
      rm: async () => {},
    };
    await expect(release.bumpVersions(dir, "patch", io)).rejects.toThrow(/injected write failure/);
    expect(await snapshot(dir)).toEqual(before);
    await noStrays(dir);
  });

  it("removes a version.ts that did not exist before when a later step fails", async () => {
    const dir = await sandbox();
    const { rm } = await import("node:fs/promises");
    await rm(path.join(dir, "src", "version.ts"));
    // version.ts is renamed last; fail the 4th rename is impossible (it IS the last), so
    // fail via a rename wrapper that throws AFTER performing the last rename.
    let renames = 0;
    const io = {
      writeFile: realWriteFile,
      rename: async (a: string, b: string) => {
        renames += 1;
        await realRename(a, b);
        if (renames === 4) throw new Error("injected post-rename failure");
      },
      rm: async () => {},
    };
    await expect(release.bumpVersions(dir, "patch", io)).rejects.toThrow(/post-rename/);
    await expect(readFile(path.join(dir, "src", "version.ts"), "utf8")).rejects.toThrow(/ENOENT/);
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).version).toBe(
      "1.2.3",
    );
  });

  it("validates everything before writing: a corrupt vscode package.json changes nothing", async () => {
    const dir = await sandbox();
    await writeFile(path.join(dir, "vscode-extension", "package.json"), "{ not json");
    const before = await snapshot(dir);
    await expect(release.bumpVersions(dir, "patch")).rejects.toThrow(/vscode-extension/);
    expect(await snapshot(dir)).toEqual(before);
    await noStrays(dir);
  });

  it("rejects a malformed explicit version before writing", async () => {
    const dir = await sandbox();
    const before = await snapshot(dir);
    await expect(release.bumpVersions(dir, "1.2.3 oops")).rejects.toThrow(/semver/);
    await expect(release.bumpVersions(dir, "1.2")).rejects.toThrow();
    expect(await snapshot(dir)).toEqual(before);
  });
});

describe("release.yml required-asset assertion", () => {
  it("lists SHA256SUMS and the npm tarball under its @pliable/golem name", async () => {
    const yml = await readFile(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
    const start = yml.indexOf("for required in");
    const loop = yml.slice(start, yml.indexOf("do\n", start));
    expect(loop).toContain("SHA256SUMS");
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      name: string;
    };
    const packed = `${pkg.name.replace(/^@/, "").replace("/", "-")}-\${VERSION}.tgz`;
    expect(pkg.name).toBe("@pliable/golem");
    expect(loop).toContain(packed);
    expect(yml).toContain(`VERSION: $${"{{"} needs.resolve.outputs.version }}`);
  });
});
