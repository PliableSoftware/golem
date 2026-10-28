/**
 * `--dir` defaults to the project root, not the raw cwd. A command run from a
 * subdirectory otherwise reads and writes `.golem/` there — the stray nested
 * state directories this guards against. `init` is the deliberate exception: it
 * creates a project, so it starts from wherever it is run.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ANCHORED = ["target", "gateway", "vibe", "personas", "proxy", "verify"] as const;

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "golem-dir-default-")));
  await mkdir(path.join(root, ".golem"), { recursive: true });
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await writeFile(path.join(root, ".golem", "settings.json"), "{}\n");
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

function dirDefaults(cmd: Command): unknown[] {
  const own = cmd.options.filter((o) => o.long === "--dir").map((o) => o.defaultValue);
  return [...own, ...cmd.commands.flatMap(dirDefaults)];
}

describe("--dir default", () => {
  for (const name of ANCHORED) {
    it(`${name}: resolves to the project root from a subdirectory`, async () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.join(root, "src", "deep"));
      vi.resetModules();
      const mod = (await import(`../../../src/cli/commands/${name}.ts`)) as {
        default: (p: Command) => void;
      };
      const program = new Command();
      mod.default(program);
      const defaults = dirDefaults(program);
      expect(defaults.length).toBeGreaterThan(0);
      for (const d of defaults) expect(d).toBe(root);
    });
  }
});
