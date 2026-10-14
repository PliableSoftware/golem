/**
 * DUST2.11 review fix — `golem plugin` with a stage that never settles.
 *
 * Must run in a CHILD process: vitest keeps its own event loop alive, which hid
 * the real bug (an unref'd probe timer let the CLI exit silently with code 0).
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = path.join(repoRoot, "src", "cli", "main.ts");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "golem-plugin-hang-"));
  await mkdir(path.join(dir, ".golem"), { recursive: true });
  await writeFile(
    path.join(dir, ".golem", "settings.json"),
    JSON.stringify({ plugins: { enabled: true, load: ["./hang.mjs"] } }),
    "utf8",
  );
  await writeFile(
    path.join(dir, "hang.mjs"),
    `export default { name: "hanger", setup(api) {
      api.addPipelineStage({ name: "never", description: "never settles", transform() { return new Promise(() => {}); } });
    } };`,
    "utf8",
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("golem plugin with a never-settling stage (child process)", () => {
  it("prints the report including the timeout problem and exits nonzero under --check", async () => {
    let stdout = "";
    let code: number | string | undefined;
    try {
      const r = await run(
        process.execPath,
        ["--import", "tsx", main, "plugin", "--dir", dir, "--check"],
        { cwd: repoRoot, timeout: 60_000 },
      );
      stdout = r.stdout;
      code = 0;
    } catch (err) {
      const e = err as { stdout?: string; code?: number | string };
      stdout = e.stdout ?? "";
      code = e.code;
    }
    expect(stdout).toContain("hanger");
    expect(stdout).toContain("stage-probe-failed");
    expect(stdout).toContain("timed out");
    expect(code).toBe(1);
  }, 90_000);
});
