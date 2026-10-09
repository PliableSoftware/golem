/**
 * DUST2.12 / r029 — a park records the git worktree it was in; resume shows it.
 * Uses a real temp repo: the point is what git actually reports.
 */

import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { persistSnoozeNote } from "../../../src/mcp/snooze-note.js";
import {
  captureWorktree,
  describeWorktree,
  FileTaskStore,
  worktreeDrift,
} from "../../../src/tasks/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-worktree-");

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=golem-test", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "pipe", encoding: "utf8" },
  );
}

async function repo(): Promise<string> {
  const dir = await realpath(await newTempDir());
  git(dir, "init", "-q", "-b", "main");
  await writeFile(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

describe("captureWorktree", () => {
  it("returns undefined outside a git checkout", async () => {
    expect(await captureWorktree(await newTempDir())).toBeUndefined();
  });

  it("records path, branch, HEAD and dirty files", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "a.txt"), "changed\n");
    await writeFile(path.join(dir, "new file.txt"), "x\n");
    const w = await captureWorktree(dir);
    expect(w?.path).toBe(dir);
    expect(w?.branch).toBe("main");
    expect(w?.baseCommit).toBe(git(dir, "rev-parse", "HEAD").trim());
    expect([...(w?.dirtyFiles ?? [])].sort()).toStrictEqual(["a.txt", "new file.txt"]);
  });

  it("captures a LINKED worktree's own path and branch, not the main checkout's", async () => {
    const main = await repo();
    const linked = path.join(await realpath(await newTempDir()), "wt");
    git(main, "worktree", "add", "-q", "-b", "feature/x", linked);
    const w = await captureWorktree(linked);
    expect(w?.path).toBe(linked);
    expect(w?.branch).toBe("feature/x");
  });

  it("omits the branch on a detached HEAD", async () => {
    const dir = await repo();
    git(dir, "checkout", "-q", "--detach");
    expect((await captureWorktree(dir))?.branch).toBeUndefined();
  });
});

describe("worktreeDrift", () => {
  it("is empty when nothing was captured or nothing moved", async () => {
    expect(await worktreeDrift(undefined)).toStrictEqual([]);
    const dir = await repo();
    expect(await worktreeDrift(await captureWorktree(dir))).toStrictEqual([]);
  });

  it("warns when HEAD moved", async () => {
    const dir = await repo();
    const w = await captureWorktree(dir);
    await mkdir(path.join(dir, "d"));
    await writeFile(path.join(dir, "d", "b.txt"), "b\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "two");
    const [warning] = await worktreeDrift(w);
    expect(warning).toContain("HEAD moved");
  });

  it("warns when the worktree is gone", async () => {
    const warnings = await worktreeDrift({
      path: path.join(await newTempDir(), "missing"),
      baseCommit: "abc",
      dirtyFiles: [],
    });
    expect(warnings[0]).toContain("no longer exists");
  });
});

describe("describeWorktree", () => {
  it("prints path, branch and short commit", () => {
    expect(
      describeWorktree({ path: "/w", branch: "b", baseCommit: "0123456789abcdef", dirtyFiles: [] }),
    ).toBe("/w [b] @ 0123456789");
  });
});

describe("a parked snooze note", () => {
  it("records the worktree it was parked in", async () => {
    const dir = await repo();
    const result = await persistSnoozeNote(dir, "pick up at step 3");
    expect(result.ok).toBe(true);
    const task = (await new FileTaskStore(dir).list())[0];
    expect(task?.worktree?.path).toBe(dir);
    expect(task?.worktree?.branch).toBe("main");
  });
});
