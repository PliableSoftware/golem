/**
 * `golem task resume --spawn`: a failed launch must not mark the task running,
 * and must print the OS error; a successful launch marks it running.
 */

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../../../src/cli/commands/tasks.js";
import { createTask, FileTaskStore } from "../../../src/tasks/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-task-resume-");

let dir: string;
let out: string;
let originalPath: string | undefined;

async function resume(): Promise<void> {
  const program = new Command().exitOverride();
  register(program);
  await program.parseAsync([
    "node",
    "golem",
    "task",
    "resume",
    "resume-1",
    "--spawn",
    "--dir",
    dir,
  ]);
}

beforeEach(async () => {
  dir = await newTempDir();
  out = "";
  originalPath = process.env.PATH;
  await new FileTaskStore(dir).put(
    createTask({ prompt: "continue the work" }, "2026-10-08T00:00:00.000Z", "resume-1"),
  );
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.PATH = originalPath;
});

describe("golem task resume --spawn", () => {
  it("leaves the state unchanged, counts the attempt and prints the OS error when the launch fails", async () => {
    // No `claude` can be found on an empty PATH, so the spawn fails with ENOENT.
    process.env.PATH = dir;
    const before = (await new FileTaskStore(dir).list())[0];
    await resume();
    const [after] = await new FileTaskStore(dir).list();
    expect(after?.state).toBe(before?.state);
    expect(after?.state).not.toBe("running");
    expect(after?.attempts).toBe((before?.attempts ?? 0) + 1);
    expect(out).toContain("could not spawn");
    expect(out).toMatch(/ENOENT/);
  });

  // A fake `claude` is a shell script, which spawn(bin, args) can only run on POSIX.
  it.skipIf(process.platform === "win32")(
    "marks the task running when the launch succeeds",
    async () => {
      const bin = await newTempDir();
      const fake = join(bin, "claude");
      await writeFile(fake, "#!/bin/sh\nexit 0\n");
      await chmod(fake, 0o755);
      process.env.PATH = bin;
      await resume();
      const [after] = await new FileTaskStore(dir).list();
      expect(after?.state).toBe("running");
      expect(after?.attempts).toBe(1);
      expect(out).toContain("resumed task resume-1");
    },
  );
});
