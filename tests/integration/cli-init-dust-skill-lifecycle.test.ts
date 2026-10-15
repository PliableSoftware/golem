/**
 * DUST4.2 — the /golem-dust skill through the real init / uninit lifecycle.
 * Temp project dir and a fake probe; no real `claude` binary or home touched.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { golemInit, golemUninit, type InitProbe } from "../../src/cli/init.js";
import { skillDirName, skillsOfferedPath } from "../../src/cli/init-skills.js";
import { hashManaged, managedRecordPath } from "../../src/cli/managed-files.js";
import { P0_SKILLS } from "../../src/cli/skills.js";
import { useTempDirs } from "../helpers/tmp.js";

// golemInit is ~300ms idle but slow under a saturated parallel run (see
// cli-init-retired-skills.test.ts for the measurement).
vi.setConfig({ testTimeout: 90_000 });

const COMMAND = "dust";
const KEY = `.claude/skills/golem-${COMMAND}/SKILL.md`;

const newTempDir = useTempDirs("golem-dust-skill");

const okProbe: InitProbe = {
  claudeCodeInstalled: () => Promise.resolve(true),
  headroomWrapActive: () => Promise.resolve(false),
};

let projectDir: string;
let skillPath: string;

const recordedHashes = async (): Promise<Record<string, string>> =>
  JSON.parse(await readFile(managedRecordPath(projectDir), "utf8")) as Record<string, string>;

const forDust = (actions: readonly { kind: string; path: string }[], kind: string): boolean =>
  actions.some((a) => a.kind === kind && a.path.replaceAll("\\", "/").endsWith(KEY));

beforeEach(async () => {
  projectDir = await newTempDir();
  skillPath = path.join(projectDir, ...KEY.split("/"));
});

describe("golem-dust skill lifecycle", () => {
  it("fresh init creates the skill and records its hash", async () => {
    const report = await golemInit({ projectDir, probe: okProbe });

    const shipped = P0_SKILLS[COMMAND];
    expect(shipped).toBeTruthy();
    expect(await readFile(skillPath, "utf8")).toBe(shipped);
    expect(forDust(report.actions, "create")).toBe(true);
    expect((await recordedHashes())[KEY]).toBe(hashManaged(shipped as string));
  });

  it("re-init with unchanged bytes skips", async () => {
    await golemInit({ projectDir, probe: okProbe });

    const report = await golemInit({ projectDir, probe: okProbe });

    expect(forDust(report.actions, "skip")).toBe(true);
    expect(forDust(report.actions, "create")).toBe(false);
    expect(forDust(report.actions, "modify")).toBe(false);
  });

  it("re-init after a user edit reports a conflict and leaves the file byte-identical", async () => {
    await golemInit({ projectDir, probe: okProbe });
    const edited = `${P0_SKILLS[COMMAND]}\nMy own addendum.\n`;
    await writeFile(skillPath, edited, "utf8");

    const report = await golemInit({ projectDir, probe: okProbe });

    expect(forDust(report.actions, "conflict")).toBe(true);
    expect(await readFile(skillPath, "utf8")).toBe(edited);
  });

  it("uninit removes the skill and its record", async () => {
    await golemInit({ projectDir, probe: okProbe });

    const report = await golemUninit({ projectDir, probe: okProbe });

    await expect(readFile(skillPath, "utf8")).rejects.toThrow();
    expect(
      report.actions.some(
        (a) => a.kind === "remove" && a.path.replaceAll("\\", "/").includes("golem-dust"),
      ),
    ).toBe(true);
    // uninit drops the whole record file or just this entry; neither may keep it.
    const left = await recordedHashes().catch(() => ({}) as Record<string, string>);
    expect(left[KEY]).toBeUndefined();
  });

  describe("when the registry no longer ships it", () => {
    // P0_SKILLS is a plain object at runtime; take the entry out for one init
    // and always put it back.
    const withoutDust = async <T>(run: () => Promise<T>): Promise<T> => {
      const registry = P0_SKILLS as Record<string, string>;
      const saved = registry[COMMAND] as string;
      delete registry[COMMAND];
      try {
        return await run();
      } finally {
        registry[COMMAND] = saved;
      }
    };

    it("prunes an unmodified copy", async () => {
      await golemInit({ projectDir, probe: okProbe });

      const report = await withoutDust(() => golemInit({ projectDir, probe: okProbe }));

      await expect(readFile(skillPath, "utf8")).rejects.toThrow();
      expect(forDust(report.actions, "remove")).toBe(true);
      expect((await recordedHashes())[KEY]).toBeUndefined();
    });

    it("keeps an edited copy and reports a conflict", async () => {
      await golemInit({ projectDir, probe: okProbe });
      await writeFile(skillPath, "my own dust notes\n", "utf8");

      const report = await withoutDust(() => golemInit({ projectDir, probe: okProbe }));

      expect(await readFile(skillPath, "utf8")).toBe("my own dust notes\n");
      expect(forDust(report.actions, "conflict")).toBe(true);
      expect(forDust(report.actions, "remove")).toBe(false);
    });
  });

  it("a deleted skill stays deleted on the next init, for every shipped skill", async () => {
    await golemInit({ projectDir, probe: okProbe });
    for (const name of Object.keys(P0_SKILLS)) {
      await rm(path.join(projectDir, ".claude", "skills", skillDirName(name)), {
        recursive: true,
        force: true,
      });
    }

    const report = await golemInit({ projectDir, probe: okProbe });

    for (const name of Object.keys(P0_SKILLS)) {
      const file = path.join(projectDir, ".claude", "skills", skillDirName(name), "SKILL.md");
      await expect(readFile(file, "utf8")).rejects.toThrow();
    }
    expect(report.actions.some((a) => a.kind === "create" && a.path.includes("skills"))).toBe(
      false,
    );
    const declined = report.actions.find(
      (a) => a.kind === "skip" && a.path.replaceAll("\\", "/").endsWith(KEY),
    );
    expect(declined?.detail).toContain("declined");
  });

  it("--restore-skill style opt-back-in recreates only the named skill", async () => {
    await golemInit({ projectDir, probe: okProbe });
    await rm(path.dirname(skillPath), { recursive: true, force: true });
    const otherDir = path.join(projectDir, ".claude", "skills", "golem-ship");
    await rm(otherDir, { recursive: true, force: true });

    await golemInit({ projectDir, probe: okProbe, restoreSkills: [COMMAND] });

    expect(await readFile(skillPath, "utf8")).toBe(P0_SKILLS[COMMAND]);
    await expect(readFile(path.join(otherDir, "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("a skill added in a later release is offered once, others stay declined", async () => {
    await golemInit({ projectDir, probe: okProbe });
    await rm(path.dirname(skillPath), { recursive: true, force: true });
    // Simulate an older record that predates a newly shipped skill.
    const rec = skillsOfferedPath(projectDir);
    const offered = (JSON.parse(await readFile(rec, "utf8")) as { offered: string[] }).offered;
    await writeFile(
      rec,
      JSON.stringify({
        offered: offered.filter((n) => n !== "ship" && n !== COMMAND).concat(COMMAND),
      }),
      "utf8",
    );
    const shipPath = path.join(projectDir, ".claude", "skills", "golem-ship", "SKILL.md");
    await rm(path.dirname(shipPath), { recursive: true, force: true });

    await golemInit({ projectDir, probe: okProbe });
    expect(await readFile(shipPath, "utf8")).toBe(P0_SKILLS.ship);
    await expect(readFile(skillPath, "utf8")).rejects.toThrow();

    await rm(path.dirname(shipPath), { recursive: true, force: true });
    await golemInit({ projectDir, probe: okProbe });
    await expect(readFile(shipPath, "utf8")).rejects.toThrow();
  });

  it("uninit clears the offered record so the next init offers everything again", async () => {
    await golemInit({ projectDir, probe: okProbe });
    await rm(path.dirname(skillPath), { recursive: true, force: true });
    await golemInit({ projectDir, probe: okProbe });

    await golemUninit({ projectDir, probe: okProbe });
    await expect(readFile(skillsOfferedPath(projectDir), "utf8")).rejects.toThrow();
    await golemInit({ projectDir, probe: okProbe });

    expect(await readFile(skillPath, "utf8")).toBe(P0_SKILLS[COMMAND]);
  });

  it("a hand-edited skill is kept even though the project has an offered record", async () => {
    await golemInit({ projectDir, probe: okProbe });
    const edited = `${P0_SKILLS[COMMAND]}\nMine.\n`;
    await writeFile(skillPath, edited, "utf8");

    await golemInit({ projectDir, probe: okProbe, restoreSkills: ["all"] });

    expect(await readFile(skillPath, "utf8")).toBe(edited);
  });
});
