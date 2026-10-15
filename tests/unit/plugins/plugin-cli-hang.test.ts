/**
 * DUST2.11 — `golem plugin` must finish, and say what happened, however badly a
 * plugin behaves.
 *
 * Child processes on purpose: vitest keeps its own event loop alive, which hid
 * the real bugs (an unref'd probe timer, and open handles keeping the CLI alive).
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const main = path.join(repoRoot, "src", "cli", "main.ts");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "golem-plugin-hang-"));
  await mkdir(path.join(dir, ".golem"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixture(file: string, source: string): Promise<void> {
  await writeFile(
    path.join(dir, ".golem", "settings.json"),
    JSON.stringify({ plugins: { enabled: true, load: [`./${file}`] } }),
    "utf8",
  );
  await writeFile(path.join(dir, file), source, "utf8");
}

function golemPlugin(args: string[]): Promise<{ stdout: string; code: number | string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", main, "plugin", "--dir", dir, ...args],
      { cwd: repoRoot, timeout: 60_000 },
      (err, stdout) => {
        const code = err === null ? 0 : ((err as { code?: number | string }).code ?? "killed");
        resolve({ stdout, code });
      },
    );
  });
}

describe("golem plugin with misbehaving plugins (child process)", () => {
  it("never-settling stage: prints the report with the timeout and exits 1 under --check", async () => {
    await fixture(
      "hang.mjs",
      `export default { name: "hanger", setup(api) {
        api.addPipelineStage({ name: "never", description: "d", transform() { return new Promise(() => {}); } });
      } };`,
    );
    const { stdout, code } = await golemPlugin(["--check"]);
    expect(stdout).toContain("hanger");
    expect(stdout).toContain("stage-probe-failed");
    expect(stdout).toContain("timed out");
    expect(code).toBe(1);
  }, 90_000);

  it("stage that also leaves a timer open: still prints and exits 1 under --check", async () => {
    await fixture(
      "handle.mjs",
      `export default { name: "leaky", setup(api) {
        api.addPipelineStage({ name: "tick", description: "d", transform() {
          setInterval(() => {}, 1000);
          return new Promise(() => {});
        } });
      } };`,
    );
    const { stdout, code } = await golemPlugin(["--check"]);
    expect(stdout).toContain("leaky");
    expect(stdout).toContain("stage-probe-failed");
    expect(code).toBe(1);
  }, 90_000);

  it("never-settling setup(): reports setup-timeout, contributes nothing, exits 1 under --check", async () => {
    await fixture(
      "setup.mjs",
      `export default { name: "stuck", setup() { return new Promise(() => {}); } };`,
    );
    const { stdout, code } = await golemPlugin(["--check", "--setup-timeout", "500"]);
    expect(stdout).toContain("setup-timeout");
    expect(stdout).toContain("0 loaded");
    expect(code).toBe(1);
  }, 90_000);

  it("overall deadline: prints what it has plus command-deadline, and exits even with a live timer", async () => {
    await fixture(
      "tla.mjs",
      `setInterval(() => {}, 1000);
       await new Promise(() => {});
       export default { name: "never-imported", setup() {} };`,
    );
    const { stdout, code } = await golemPlugin(["--check", "--deadline", "1500"]);
    expect(stdout).toContain("command-deadline");
    expect(stdout).toContain("plugin command deadline exceeded");
    expect(code).toBe(1);
  }, 90_000);
});
