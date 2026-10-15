/**
 * DUST2.14 review — `golem mcp serve` must END when its client goes away, even with
 * the index watch daemon running. Its poll/debounce timers used to keep the event
 * loop (and so the process) alive forever, and cleanup hung off `exit`, which cannot
 * fire while timers pend. Real child process, stdin closed at once.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-orphan-");

function runServe(
  project: string,
  home: string,
  env: Record<string, string>,
  signalAfterMs?: { signal: NodeJS.Signals; ms: number },
): Promise<{ code: number | null; signal: string | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/cli/main.ts", "mcp", "serve", "--dir", project],
      {
        cwd: path.resolve(import.meta.dirname, "../.."),
        env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    const kill = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`mcp serve was still alive after the client went away\n${stderr}`));
    }, 20_000);
    child.on("exit", (code, signal) => {
      clearTimeout(kill);
      resolve({ code, signal, stderr });
    });
    if (signalAfterMs === undefined) child.stdin.end();
    else setTimeout(() => child.kill(signalAfterMs.signal), signalAfterMs.ms);
  });
}

async function project(): Promise<{ dir: string; home: string }> {
  const dir = await newTempDir();
  const home = await newTempDir();
  await mkdir(path.join(dir, "docs", "wiki"), { recursive: true });
  await writeFile(path.join(dir, "docs", "wiki", "a.md"), "# a\n");
  return { dir, home };
}

describe("mcp serve lifecycle", () => {
  it("exits 0 on stdin EOF with the watch daemon on", async () => {
    const { dir, home } = await project();
    const r = await runServe(dir, home, { GOLEM_KB_WATCH: "on" });
    expect(r.code).toBe(0);
  }, 30_000);

  it("exits on SIGTERM while serving", async () => {
    if (process.platform === "win32") return; // no POSIX signals
    const { dir, home } = await project();
    const r = await runServe(dir, home, {}, { signal: "SIGTERM", ms: 4000 });
    expect(r.code).toBe(0);
  }, 30_000);

  it("GOLEM_KB_WATCH=off does not print an unknown-setting warning", async () => {
    const { dir, home } = await project();
    const r = await runServe(dir, home, { GOLEM_KB_WATCH: "off" });
    expect(r.stderr).not.toMatch(/does not match any known setting/);
  }, 30_000);
});
