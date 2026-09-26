/**
 * WS-E E2 — golem init / uninit against a temp project dir with a fake probe.
 * No real `claude` binary or home directory is touched.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { golemInit, golemUninit, type InitProbe } from "../../src/cli/init.js";
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
const CLAUDE_TARGET = ".claude/settings.local.json";
const _CLAUDE_COMMITTED = ".claude/settings.json";

async function readJson(rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(projectDir, rel), "utf8")) as Record<string, unknown>;
}

/** Recursive file listing + contents, for whole-tree idempotence checks. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out.set(path.relative(dir, abs), await readFile(abs, "utf8"));
  }
  return out;
}

describe("golem uninit", () => {
  it("removes exactly what init added, keeping foreign entries and .golem/", async () => {
    await mkdir(path.join(projectDir, ".claude"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".claude", "settings.json"),
      JSON.stringify({ env: { FOO: "bar" } }),
      "utf8",
    );
    await writeFile(
      path.join(projectDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { type: "http", url: "http://x/mcp" } } }),
      "utf8",
    );
    await golemInit({ projectDir, probe: okProbe });

    await golemUninit({ projectDir, probe: okProbe });

    const settings = await readJson(".claude/settings.json");
    expect(settings.env).toStrictEqual({ FOO: "bar" });
    const mcp = await readJson(".mcp.json");
    expect(mcp.mcpServers).toStrictEqual({ other: { type: "http", url: "http://x/mcp" } });
    const files = await snapshot(projectDir);
    expect([...files.keys()].some((f) => f.includes(path.join("skills", "golem-")))).toBe(false);
    expect(files.has(path.join(".golem", "settings.json"))).toBe(true);
  });

  it("does not remove a user-customized base URL", async () => {
    await golemInit({ projectDir, probe: okProbe });
    // User later pointed Claude Code somewhere else; uninit must not delete it.
    const settingsPath = path.join(projectDir, CLAUDE_TARGET);
    const settings = await readJson(CLAUDE_TARGET);
    (settings.env as Record<string, unknown>).ANTHROPIC_BASE_URL = "http://localhost:7777";
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");

    await golemUninit({ projectDir, probe: okProbe });
    const after = await readJson(CLAUDE_TARGET);
    expect((after.env as Record<string, unknown>).ANTHROPIC_BASE_URL).toBe("http://localhost:7777");
  });

  it("dry-run removes nothing", async () => {
    await golemInit({ projectDir, probe: okProbe });
    const before = await snapshot(projectDir);
    const report = await golemUninit({ projectDir, dryRun: true, probe: okProbe });
    expect(report.dryRun).toBe(true);
    expect(await snapshot(projectDir)).toStrictEqual(before);
  });

  it("is a no-op on an unconfigured project", async () => {
    const report = await golemUninit({ projectDir, probe: okProbe });
    expect(report.actions).toStrictEqual([
      { kind: "skip", path: ".", detail: "nothing to remove" },
    ]);
  });
});
