/**
 * DUST2.12 — an unparseable plan-task doc must never vanish silently.
 * Drives the real CLI against a temp tree holding one good doc and one broken one.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PLAN_INDEX_BEGIN, PLAN_INDEX_END } from "../../src/cli/plan-index.js";
import { useTempDirs } from "../helpers/tmp.js";

const run = promisify(execFile);
const REPO = path.resolve(import.meta.dirname, "..", "..");
const MAIN = path.join(REPO, "src", "cli", "main.ts");
const newTempDir = useTempDirs("golem-plan-unparseable-");

const GOOD = `---
task: G1
title: Good one
state: queued
owner: agent
size: S
gate: it works
created: 2026-10-01
---

## Goal

Do the good thing.
`;

const USER_OWNED = GOOD.replace("task: G1", "task: U1").replace("owner: agent", "owner: user");

async function tree(): Promise<string> {
  const dir = await newTempDir();
  const tasks = path.join(dir, "docs", "plan", "tasks");
  await mkdir(tasks, { recursive: true });
  await writeFile(path.join(tasks, "G1.md"), GOOD);
  await writeFile(path.join(tasks, "U1.md"), USER_OWNED);
  await writeFile(path.join(tasks, "broken.md"), "title: no frontmatter at all\n");
  await writeFile(
    path.join(dir, "docs", "plan", "ROADMAP.md"),
    `# Roadmap\n\n${PLAN_INDEX_BEGIN}\n${PLAN_INDEX_END}\n`,
  );
  return dir;
}

interface Out {
  code: number;
  stdout: string;
  stderr: string;
}

async function golem(dir: string, ...args: string[]): Promise<Out> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", MAIN, "task", ...args, "--dir", dir],
      { cwd: REPO, timeout: 60_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("golem task with an unparseable plan doc", () => {
  it("`list` names the file and the reason, and still lists the good task", async () => {
    const dir = await tree();
    const out = await golem(dir, "list");
    expect(out.stdout).toContain("G1");
    expect(out.stdout).toContain("UNPARSEABLE");
    expect(out.stdout).toContain(path.join("tasks", "broken.md"));
    expect(out.stdout).toContain("leading --- frontmatter delimiter");
  });

  it("`list --json` keeps the array shape and reports on stderr", async () => {
    const out = await golem(await tree(), "list", "--json");
    expect(Array.isArray(JSON.parse(out.stdout))).toBe(true);
    expect(out.stderr).toContain("broken.md");
  });

  it("`index --summary` reports it and exits non-zero", async () => {
    const out = await golem(await tree(), "index", "--summary");
    expect(out.code).toBe(1);
    expect(out.stdout).toContain("UNPARSEABLE (1)");
    expect(out.stdout).toContain("broken.md");
  });

  it("`index --json` carries an `unparseable` array and exits non-zero", async () => {
    const out = await golem(await tree(), "index", "--json");
    expect(out.code).toBe(1);
    expect(JSON.parse(out.stdout).unparseable).toHaveLength(1);
  });

  it("`index --write` flags it inside the generated ROADMAP region and exits non-zero", async () => {
    const dir = await tree();
    const out = await golem(dir, "index", "--write");
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("broken.md");
    const roadmap = await readFile(path.join(dir, "docs", "plan", "ROADMAP.md"), "utf8");
    expect(roadmap).toContain("Unparseable task documents");
    expect(roadmap).toContain("[broken.md](tasks/broken.md)");
    expect(roadmap).toContain("G1");
  });

  it("`index --write` on a clean tree exits zero", async () => {
    const dir = await tree();
    await writeFile(path.join(dir, "docs", "plan", "tasks", "broken.md"), GOOD.replace("G1", "G2"));
    expect((await golem(dir, "index", "--write")).code).toBe(0);
  });

  it("`resume` of the unparseable doc says why, not 'no task matching'", async () => {
    const out = await golem(await tree(), "resume", "broken");
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("unparseable");
  });
});

describe("golem task resume <plan-id>", () => {
  it("prints a fresh headless command from the brief (no --continue / --resume)", async () => {
    const out = await golem(await tree(), "resume", "G1");
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("resume command");
    expect(out.stdout).toContain("Do the good thing.");
    expect(out.stdout).not.toContain("--continue");
    expect(out.stdout).not.toContain("--resume");
  });

  it("refuses an owner: user task", async () => {
    const out = await golem(await tree(), "resume", "U1");
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("owner: user");
  });

  it("never rewrites the committed document", async () => {
    const dir = await tree();
    const file = path.join(dir, "docs", "plan", "tasks", "G1.md");
    const before = await readFile(file, "utf8");
    await golem(dir, "resume", "G1");
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
