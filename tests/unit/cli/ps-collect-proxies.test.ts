import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProxies } from "../../../src/cli/commands/ps.js";

/**
 * Pins what `golem ps` reports for proxies: the current project's pid file
 * only. The `~/.golem/<name>/.golem/proxy.pid` scan was removed as dead —
 * nothing registers a project there — and this test is the proof the visible
 * output did not change for a real project.
 */
describe("collectProxies", () => {
  let root: string;
  let projectDir: string;
  let home: string;
  const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "golem-ps-"));
    projectDir = path.join(root, "project");
    home = path.join(root, "home");
    mkdirSync(path.join(projectDir, ".golem"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(projectDir, ".golem", "settings.json"), "{}\n");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.spyOn(process, "cwd").mockReturnValue(projectDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const writePid = (dir: string): void => {
    mkdirSync(path.join(dir, ".golem"), { recursive: true });
    writeFileSync(
      path.join(dir, ".golem", "proxy.pid"),
      `${JSON.stringify({ pid: process.pid, port: 4000, ts: "2026-10-09T00:00:00.000Z" })}\n`,
    );
  };

  it("reports the current project's proxy pid file", async () => {
    writePid(projectDir);
    const procs = await collectProxies();
    expect(procs).toHaveLength(1);
    expect(procs[0]).toMatchObject({
      pid: process.pid,
      kind: "proxy",
      projectDir,
      pidfileMatches: true,
    });
  });

  it("reports nothing when the current project has no pid file", async () => {
    expect(await collectProxies()).toStrictEqual([]);
  });

  it("does not scan ~/.golem subdirectories for proxy pid files", async () => {
    writePid(projectDir);
    writePid(path.join(home, ".golem", "elsewhere"));
    const procs = await collectProxies();
    expect(procs.map((p) => p.projectDir)).toStrictEqual([projectDir]);
  });
});
