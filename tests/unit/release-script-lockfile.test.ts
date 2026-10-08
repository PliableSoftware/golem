/**
 * DUST3.17 — scripts/release.mjs bumps package-lock.json together with the two
 * package.json files and the compiled-in VERSION. Runs the real script against a
 * sandbox copy of the repo layout, so nothing in the working tree moves.
 */

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useTempDirs } from "../helpers/tmp.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const newTempDir = useTempDirs("golem-release");

describe("scripts/release.mjs", () => {
  it("moves package-lock.json (root and packages[''] versions) with the other versions", async () => {
    const sandbox = await newTempDir();
    await mkdir(path.join(sandbox, "scripts"), { recursive: true });
    await mkdir(path.join(sandbox, "src"), { recursive: true });
    await mkdir(path.join(sandbox, "vscode-extension"), { recursive: true });
    for (const script of ["release.mjs", "sync-version.mjs"]) {
      await copyFile(path.join(repoRoot, "scripts", script), path.join(sandbox, "scripts", script));
    }
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(
      path.join(sandbox, "package.json"),
      json({ name: "@pliable/golem", version: "1.2.3" }),
    );
    await writeFile(
      path.join(sandbox, "vscode-extension", "package.json"),
      json({ name: "ext", version: "1.2.3" }),
    );
    await writeFile(
      path.join(sandbox, "package-lock.json"),
      json({
        name: "@pliable/golem",
        version: "1.2.3",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "@pliable/golem", version: "1.2.3", license: "Apache-2.0" },
          "node_modules/dep": { version: "9.9.9" },
        },
      }),
    );

    execFileSync(process.execPath, [path.join(sandbox, "scripts", "release.mjs"), "patch"], {
      stdio: "pipe",
    });

    const read = async (rel: string) => JSON.parse(await readFile(path.join(sandbox, rel), "utf8"));
    expect((await read("package.json")).version).toBe("1.2.4");
    expect((await read(path.join("vscode-extension", "package.json"))).version).toBe("1.2.4");
    expect(await readFile(path.join(sandbox, "src", "version.ts"), "utf8")).toContain('"1.2.4"');
    const lock = await read("package-lock.json");
    expect(lock.version).toBe("1.2.4");
    expect(lock.packages[""].version).toBe("1.2.4");
    expect(lock.packages["node_modules/dep"].version).toBe("9.9.9"); // untouched
  });
});
