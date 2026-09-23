/**
 * WS-E E2 — golem init / uninit against a temp project dir with a fake probe.
 * No real `claude` binary or home directory is touched.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { golemInit, type InitProbe } from "../../src/cli/init.js";
import { skillDirName } from "../../src/cli/init-skills.js";
import { isUnmodifiedManaged, rememberManaged } from "../../src/cli/managed-files.js";
import { P0_SKILLS } from "../../src/cli/skills.js";
import { useTempDirs } from "../helpers/tmp.js";

// R10.2: this file makes 36 golemInit() calls, each writing ~20 files. It was
// paying a retry-prone recursive delete per test; now it pays one per file.

// R10.2 — a LOCAL ceiling, with the measurement that justifies it.
//
// `golemInit` costs 298ms on an idle machine (measured 2026-08-13: 10 calls in
// 2981ms). A test here does one or two of them. When one of these tests trips
// the 20s budget under a full parallel run, that is a 66x slowdown of work that
// is small and real — not a hung test and not a slow code path. The cause is
// environmental: ~15 vitest workers doing filesystem work on Windows, where
// every file creation is a virus-scanner event.
//
// The structural fixes are already applied (R10.2: one temp-tree delete per
// file rather than per test; atomic settings writes). This raises the ceiling
// only for the two init-heaviest files rather than globally, so the 20s default
// still guards everything else — the same targeted approach, and the same
// reasoning, as checkpoint-ledger.test.ts.
vi.setConfig({ testTimeout: 90_000 });

const newTempDir = useTempDirs("golem-init");

const okProbe: InitProbe = {
  claudeCodeInstalled: () => Promise.resolve(true),
  headroomWrapActive: () => Promise.resolve(false),
};

let projectDir: string;

beforeEach(async () => {
  projectDir = await newTempDir();
});

/**
 * Where `golem init` writes Claude Code's wiring by default since
 * `claude.settings_scope`: the gitignored local file. `.claude/settings.json`
 * is only read below where the point is that Golem did NOT write there.
 */
const _CLAUDE_TARGET = ".claude/settings.local.json";
const _CLAUDE_COMMITTED = ".claude/settings.json";

describe("golem init — retired skills are pruned (R11.1 leftover)", () => {
  const retiredPath = (dir: string): string =>
    path.join(dir, ".claude", "skills", "golem-slider", "SKILL.md");

  it("removes a retired skill Golem itself wrote, and forgets its record", async () => {
    await golemInit({ projectDir, probe: okProbe });
    // Simulate a skill Golem shipped in an earlier release and has since dropped
    // from the table: write it AND record it as Golem-written, which is exactly
    // the state `/golem-slider` was in after R11.1 retired the slider.
    const retired = retiredPath(projectDir);
    await mkdir(path.dirname(retired), { recursive: true });
    await writeFile(retired, "run `golem slider 3`\n", "utf8");
    await rememberManaged(projectDir, retired, "run `golem slider 3`\n");

    const report = await golemInit({ projectDir, probe: okProbe });

    await expect(readFile(retired, "utf8")).rejects.toThrow();
    expect(report.actions.some((a) => a.kind === "remove" && a.path.includes("golem-slider"))).toBe(
      true,
    );
    // The provenance record goes with it, so a later re-install is a clean create.
    expect(await isUnmodifiedManaged(projectDir, retired, "run `golem slider 3`\n")).toBe(false);
    // The skills Golem still ships are untouched.
    for (const name of Object.keys(P0_SKILLS)) {
      await expect(
        readFile(
          path.join(projectDir, ".claude", "skills", skillDirName(name), "SKILL.md"),
          "utf8",
        ),
      ).resolves.toContain("");
    }
  });

  it("keeps a retired skill the user edited, and reports it as a conflict", async () => {
    await golemInit({ projectDir, probe: okProbe });
    const retired = retiredPath(projectDir);
    await mkdir(path.dirname(retired), { recursive: true });
    await rememberManaged(projectDir, retired, "what golem wrote\n");
    // ...and then the user edited it. The bytes no longer match the record.
    await writeFile(retired, "my own notes\n", "utf8");

    const report = await golemInit({ projectDir, probe: okProbe });

    expect(await readFile(retired, "utf8")).toBe("my own notes\n");
    expect(
      report.actions.some((a) => a.kind === "conflict" && a.path.includes("golem-slider")),
    ).toBe(true);
  });

  it("leaves a skill Golem has no record of writing (the user's own)", async () => {
    await golemInit({ projectDir, probe: okProbe });
    const mine = path.join(projectDir, ".claude", "skills", "golem-mine", "SKILL.md");
    await mkdir(path.dirname(mine), { recursive: true });
    await writeFile(mine, "my own skill\n", "utf8");

    const report = await golemInit({ projectDir, probe: okProbe });

    expect(await readFile(mine, "utf8")).toBe("my own skill\n");
    expect(report.actions.some((a) => a.kind === "remove" && a.path.includes("golem-mine"))).toBe(
      false,
    );
  });

  it("does not prune in a dry run", async () => {
    await golemInit({ projectDir, probe: okProbe });
    const retired = retiredPath(projectDir);
    await mkdir(path.dirname(retired), { recursive: true });
    await writeFile(retired, "stale\n", "utf8");
    await rememberManaged(projectDir, retired, "stale\n");

    const report = await golemInit({ projectDir, probe: okProbe, dryRun: true });

    expect(await readFile(retired, "utf8")).toBe("stale\n");
    expect(report.actions.some((a) => a.kind === "remove" && a.path.includes("golem-slider"))).toBe(
      true,
    );
  });
});
