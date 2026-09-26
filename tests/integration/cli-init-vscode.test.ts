/**
 * WS-E E2 — golem init / uninit against a temp project dir with a fake probe.
 * No real `claude` binary or home directory is touched.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
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
const _CLAUDE_TARGET = ".claude/settings.local.json";
const _CLAUDE_COMMITTED = ".claude/settings.json";

async function _readJson(rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(projectDir, rel), "utf8")) as Record<string, unknown>;
}

/** Recursive file listing + contents, for whole-tree idempotence checks. */
async function _snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out.set(path.relative(dir, abs), await readFile(abs, "utf8"));
  }
  return out;
}

describe("golem init — VS Code extension install", () => {
  let extDir: string;
  let sourceDir: string;
  let vscodeProbe: InitProbe;

  beforeEach(async () => {
    extDir = await newTempDir();
    sourceDir = await newTempDir();
    vscodeProbe = { ...okProbe, vscodeExtensionsDir: () => Promise.resolve(extDir) };
    await writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ publisher: "golem-run", name: "golem-vscode", version: "9.9.9" }),
      "utf8",
    );
    await writeFile(path.join(sourceDir, "extension.js"), "// ext", "utf8");
  });

  it("installs the extension by copying into the VS Code dir, idempotently", async () => {
    const id = "golem-run.golem-vscode-9.9.9";
    const r1 = await golemInit({ projectDir, probe: vscodeProbe, vscodeSourceDir: sourceDir });
    expect(r1.actions.some((a) => a.kind === "create" && a.path.includes(id))).toBe(true);
    expect(await readFile(path.join(extDir, id, "extension.js"), "utf8")).toBe("// ext");

    const projectDir2 = await newTempDir();
    const r2 = await golemInit({
      projectDir: projectDir2,
      probe: vscodeProbe,
      vscodeSourceDir: sourceDir,
    });
    expect(r2.actions.some((a) => a.kind === "skip" && a.path.includes(id))).toBe(true);
  });

  it("REFRESHES a stale deployment instead of skipping it (R9.16)", async () => {
    const id = "golem-run.golem-vscode-9.9.9";
    await golemInit({ projectDir, probe: vscodeProbe, vscodeSourceDir: sourceDir });

    // Ship a newer renderer WITHOUT bumping the version — the exact shape that
    // left a three-release-old render.js on the user's machine naming the wrong
    // model, because init keyed on the directory existing.
    await writeFile(path.join(sourceDir, "render.js"), "// fixed renderer", "utf8");

    const projectDir2 = await newTempDir();
    const report = await golemInit({
      projectDir: projectDir2,
      probe: vscodeProbe,
      vscodeSourceDir: sourceDir,
    });

    const action = report.actions.find((a) => a.path.includes(id));
    expect(action?.kind).toBe("modify");
    expect(action?.detail).toContain("render.js");
    expect(await readFile(path.join(extDir, id, "render.js"), "utf8")).toBe("// fixed renderer");
  });

  it("uninit removes the installed extension", async () => {
    await golemInit({ projectDir, probe: vscodeProbe, vscodeSourceDir: sourceDir });
    expect(await readdir(extDir)).toContain("golem-run.golem-vscode-9.9.9");
    await golemUninit({ projectDir, probe: vscodeProbe });
    expect(await readdir(extDir)).not.toContain("golem-run.golem-vscode-9.9.9");
  });
});
